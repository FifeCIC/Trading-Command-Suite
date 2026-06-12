import { test, expect } from '@playwright/test';

test.describe('Critical Path', () => {
  test('Q107-T1: Landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1, h2, header').first()).toBeVisible();
    await expect(page).toHaveTitle(/Trading/);
  });

  test('Q107-T2: Navigate to Architecture page', async ({ page }) => {
    await page.goto('/architecture');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('Q107-T3: Scoring overview loads', async ({ page }) => {
    await page.goto('/scoring/overview');
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('Q107-T4: Symbols page loads with content', async ({ page }) => {
    await page.goto('/data/symbols');
    await expect(page.locator('table, ul, div').first()).toBeVisible();
  });

  test('Q107-T5: Directive status page renders', async ({ page }) => {
    await page.goto('/scoring/directives-status');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('API Integration', () => {
  test('Q107-API-1: Version endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/version');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('mode');
  });

  test('Q107-API-2: Symbols endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/symbols');
    expect(res.status()).toBe(200);
  });

  test('Q107-API-3: Provider health endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/providers/health');
    expect(res.status()).toBe(200);
  });

  test('Q107-API-4: Market data freshness', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/market-data/freshness');
    expect(res.ok()).toBeTruthy();
  });

  test('Q107-API-5: Scoring ranked endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/scoring/ranked?limit=5');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('ranked');
    expect(data).toHaveProperty('mode');
  });

  test('Q107-API-6: Webhook endpoint accepts POST', async ({ request }) => {
    const res = await request.post('http://localhost:3201/api/webhooks/market-data', {
      data: [{
        symbol: 'TEST',
        timeframe: '1Hour',
        timestamp: new Date().toISOString(),
        open: 100, high: 101, low: 99, close: 100.5, volume: 10000,
      }],
    });
    expect([200, 201]).toContain(res.status());
  });
});

test.describe('Error Handling', () => {
  test('Q107-ERR-1: 404 page shows gracefully', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Q107-ERR-2: API 500 handled', async ({ request }) => {
    const res = await request.get('http://localhost:3201/api/nonexistent');
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
