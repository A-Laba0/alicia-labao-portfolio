import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Portfolio QA suite.
 * Target: process.env.PORTFOLIO_URL, else the local site.
 * Produces tests/qa-report.md with pass/fail per check + screenshot paths.
 *
 * Capstone rule: the portfolio is intentionally CONTACT-FREE. This suite
 * ASSERTS the absence of mailto:/tel:/social-profile links (presence = fail).
 */
const BASE = process.env.PORTFOLIO_URL || 'http://127.0.0.1:8123';

const EXPECTED_TITLE = 'Alicia A. Labao | Portfolio';
const EXPECTED_DESC = 'I turn complex processes into streamlined, AI-powered workflows.';

const SHOTS_DIR = path.join('tests', 'screenshots');
const REPORT_PATH = path.join('tests', 'qa-report.md');

type Result = { name: string; pass: boolean; detail: string };

test.describe('Portfolio QA', () => {
  // Run the report suite once (on chromium) to avoid 4x report races.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'QA report runs once on chromium');
    test.setTimeout(120_000);
  });

  test('full portfolio QA pass', async ({ page, request }) => {
    const results: Result[] = [];
    const shots: { label: string; rel: string }[] = [];

    const check = async (name: string, fn: () => Promise<string | void>) => {
      try {
        const detail = (await fn()) || 'OK';
        results.push({ name, pass: true, detail });
      } catch (e: any) {
        results.push({ name, pass: false, detail: (e?.message || String(e)).split('\n')[0] });
      }
    };

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // 1. Title + meta description
    await check('Page title is correct', async () => {
      await expect(page).toHaveTitle(EXPECTED_TITLE);
      return `title = "${EXPECTED_TITLE}"`;
    });
    await check('Meta description is correct', async () => {
      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      expect(desc).toBe(EXPECTED_DESC);
      return `description = "${desc}"`;
    });

    // 2. Profile photo loads (visible + real, decoded image source)
    await check('Profile photo loads', async () => {
      const photo = page.locator('img.photo');
      await expect(photo).toBeVisible();
      const info = await photo.evaluate((el: HTMLImageElement) => ({
        src: el.currentSrc || el.src,
        natural: el.naturalWidth,
        complete: el.complete,
      }));
      if (!info.complete || info.natural === 0) throw new Error(`image not decoded (naturalWidth=${info.natural})`);
      if (!info.src || /^data:/.test(info.src)) throw new Error(`no real image source (${info.src})`);
      return `loaded ${info.src.split('/').pop()} (naturalWidth=${info.natural})`;
    });

    // 3. Download Resume -> /resume.pdf (opens/downloads a PDF)
    await check('Download Resume points to /resume.pdf', async () => {
      const cta = page.getByRole('link', { name: 'Download Resume' });
      await expect(cta).toHaveCount(1);
      const href = await cta.getAttribute('href');
      if (href !== '/resume.pdf') throw new Error(`href is "${href}", expected "/resume.pdf"`);

      // Confirm the resource is a real PDF (200 + %PDF / pdf content-type).
      const res = await request.get(new URL('/resume.pdf', BASE).toString());
      if (res.status() !== 200) throw new Error(`/resume.pdf returned ${res.status()}`);
      const ct = res.headers()['content-type'] || '';
      const body = await res.body();
      const isPdf = ct.includes('pdf') || body.subarray(0, 5).toString('latin1').startsWith('%PDF');
      if (!isPdf) throw new Error(`not a PDF (content-type "${ct}")`);

      // Best-effort: actually click and capture the download.
      let downloaded = '';
      const dlPromise = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
      await cta.click();
      const dl = await dlPromise;
      if (dl) downloaded = `, click downloaded "${dl.suggestedFilename()}"`;

      return `href=/resume.pdf -> 200 ${ct}, ${body.length} bytes${downloaded}`;
    });

    // 4. Every "View live" link returns 200
    await check('All "View live" links return 200', async () => {
      const liveCards = page.locator('a.work-card', {
        has: page.locator('.work-link', { hasText: 'View live' }),
      });
      const count = await liveCards.count();
      if (count === 0) throw new Error('found no "View live" links');
      const lines: string[] = [];
      for (let i = 0; i < count; i++) {
        const href = await liveCards.nth(i).getAttribute('href');
        if (!href) throw new Error(`card ${i} has no href`);
        const res = await request.get(href, { maxRedirects: 10 });
        if (res.status() !== 200) throw new Error(`${href} -> ${res.status()}`);
        lines.push(`200 ${href}`);
      }
      return `${count} links OK — ${lines.join('; ')}`;
    });

    // 5. Contact-free: zero mailto:, tel:, or social-profile links
    await check('Contact-free (no mailto/tel/social links)', async () => {
      const hrefs = await page.locator('a[href]').evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || '')
      );
      const mailto = hrefs.filter((h) => /^mailto:/i.test(h));
      const tel = hrefs.filter((h) => /^tel:/i.test(h));
      const social = hrefs.filter((h) =>
        /(linkedin\.com|github\.com|github\.io|twitter\.com|x\.com|instagram\.com|facebook\.com|fb\.com|t\.me|mastodon|bsky\.app|threads\.net)/i.test(h)
      );
      if (mailto.length || tel.length || social.length) {
        throw new Error(
          `found mailto=${JSON.stringify(mailto)} tel=${JSON.stringify(tel)} social=${JSON.stringify(social)}`
        );
      }
      return `0 mailto, 0 tel, 0 social links (scanned ${hrefs.length} links)`;
    });

    // 6. Footer Arca attribution
    await check('Footer Arca attribution links to arca.ph', async () => {
      const arca = page.locator('a.made-for');
      await expect(arca).toHaveAttribute('href', 'https://arca.ph');
      await expect(arca).toContainText('Made for Arca.ph');
      const logo = arca.locator('img');
      await expect(logo).toBeVisible();
      const natural = await logo.evaluate((el: HTMLImageElement) => el.naturalWidth);
      if (natural === 0) throw new Error('Arca logo did not load');
      return 'logo + "Made for Arca.ph" -> https://arca.ph';
    });

    // 7. Screenshots at desktop / tablet / mobile
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const viewports = [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'tablet', width: 768, height: 1024 },
      { label: 'mobile', width: 375, height: 667 },
    ];
    for (const v of viewports) {
      await check(`Screenshot — ${v.label} (${v.width}x${v.height})`, async () => {
        await page.setViewportSize({ width: v.width, height: v.height });
        await page.waitForTimeout(250); // let layout settle after resize
        const file = path.join(SHOTS_DIR, `qa-${v.label}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shots.push({ label: v.label, rel: `screenshots/qa-${v.label}.png` });
        return file.replace(/\\/g, '/');
      });
    }

    // 8. No horizontal scroll on mobile (375px) — viewport already 375 from above
    await check('No horizontal scroll on mobile (375px)', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (m.scrollW > m.clientW + 1) {
        throw new Error(`horizontal overflow: scrollWidth=${m.scrollW} > clientWidth=${m.clientW}`);
      }
      return `scrollWidth=${m.scrollW} <= clientWidth=${m.clientW}`;
    });

    // ---- Write the markdown report ----
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    const stamp = new Date().toISOString();

    const lines: string[] = [];
    lines.push('# Portfolio QA Report');
    lines.push('');
    lines.push(`- **URL tested:** ${BASE}`);
    lines.push(`- **Run at:** ${stamp}`);
    lines.push(`- **Result:** ${failed === 0 ? '✅ All checks passed' : `❌ ${failed} failed`} (${passed}/${results.length})`);
    lines.push('');
    lines.push('| # | Check | Status | Details |');
    lines.push('| - | ----- | ------ | ------- |');
    results.forEach((r, i) => {
      const detail = r.detail.replace(/\|/g, '\\|');
      lines.push(`| ${i + 1} | ${r.name} | ${r.pass ? '✅ Pass' : '❌ Fail'} | ${detail} |`);
    });
    lines.push('');
    lines.push('## Screenshots');
    lines.push('');
    for (const s of shots) {
      lines.push(`### ${s.label}`);
      lines.push('');
      lines.push(`![${s.label}](${s.rel})`);
      lines.push('');
    }
    fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

    // Fail the test if any check failed (report is already written).
    const failures = results.filter((r) => !r.pass).map((r) => r.name);
    expect(failures, `Failed checks: ${failures.join(', ')}`).toEqual([]);
  });
});
