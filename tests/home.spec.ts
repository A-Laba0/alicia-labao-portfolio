import { test, expect } from '@playwright/test';

test('home page loads with the correct title', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Alicia A. Labao | Portfolio');
});

test('hero shows name, tagline, and the single Download Resume CTA', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.hero-title')).toHaveText('Alicia A. Labao');
  await expect(page.getByText('I turn complex processes into streamlined, AI-powered workflows.')).toBeVisible();

  const cta = page.getByRole('link', { name: 'Download Resume' });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute('href', '/resume.pdf');
});

test('footer Arca attribution links to arca.ph and is the last element', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const arca = page.locator('a.made-for');
  await expect(arca).toHaveAttribute('href', 'https://arca.ph');
  await expect(arca).toContainText('Made for Arca.ph');
});
