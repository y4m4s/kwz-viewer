import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
test('notebook menu slides, six-note pages and actual folder navigation', async ({ page, request }) => {
  test.skip(!existsSync(process.env.KWZ_TEST_DIRECTORY || path.resolve('data')), '実KWZフォルダが必要です');
  await expect.poll(async () => (await request.get('/api/health')).json().then(s => s.scanStatus)).toBe('ready');
  await mkdir('.app-data/validation', { recursive: true });
  await page.goto('/');
  await expect(page).toHaveTitle('kwz viewer');
  for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const title = page.getByRole('button', { name: 'kwz viewer ホーム', exact: true });
    const homeTitle = (await title.boundingBox())!;
    await page.getByRole('button', { name: 'みる', exact: true }).click();
    await expect(page.locator('.folder-button').first()).toBeVisible();
    const viewTitle = (await title.boundingBox())!;
    expect(homeTitle.x).toBeCloseTo(viewTitle.x, 1);
    expect(homeTitle.y).toBeCloseTo(viewTitle.y, 1);
    await page.getByRole('button', { name: 'トップに戻る', exact: true }).click();
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const panel = await page.locator('.paper-app').boundingBox();
    const menu = await page.locator('.menu-carousel').boundingBox();
    expect(Math.abs(panel!.y - (viewport.height - panel!.height) / 2)).toBeLessThan(1);
    expect(Math.abs(menu!.y + menu!.height / 2 - viewport.height / 2)).toBeLessThan(12);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('button', { name: 'kwz viewer ホーム', exact: true })).toHaveText('kwz viewer');
  for (const asset of ['miru', 'kaku']) {
    await expect(page.locator(`.reference-tile img[src="/images/${asset}.svg"]`)).toBeVisible();
  }
  const favicon = await request.get('/favicon.ico');
  expect(favicon.ok()).toBe(true);
  const ico = await favicon.body();
  expect(ico.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
  expect(sizes).toEqual(expect.arrayContaining([16, 32, 48, 64, 128, 256]));
  for (let i = 0; i < sizes.length; i++) {
    const frame = 6 + i * 16;
    const offset = ico.readUInt32LE(frame + 12);
    expect(offset + ico.readUInt32LE(frame + 8)).toBeLessThanOrEqual(ico.length);
    expect(ico.subarray(offset, offset + 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  await expect(page.getByRole('button', { name: 'みる', exact: true })).toBeVisible();
  await page.screenshot({ path: '.app-data/validation/home1.png' });
  await page.getByRole('button', { name: '次のトップ画面' }).click();
  await expect(page.getByRole('region', { name: 'トップ画面 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ワールド kwzギャラリー インターネットコミュニティ', exact: true })).toBeVisible();
  await page.screenshot({ path: '.app-data/validation/home2.png', animations: 'disabled' });
  await page.getByRole('button', { name: '次のトップ画面' }).click();
  await expect(page.getByRole('button', { name: '設定', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '次のトップ画面', includeHidden: true })).toBeDisabled();
  await page.screenshot({ path: '.app-data/validation/home3.png', animations: 'disabled' });
  await page.getByRole('button', { name: '前のトップ画面' }).click();
  await page.getByRole('button', { name: '前のトップ画面' }).click();
  await page.getByRole('button', { name: 'みる', exact: true }).click();
  const firstFolder = page.locator('.folder-button').first();
  await expect(firstFolder).toBeVisible();
  await firstFolder.hover();
  await expect(firstFolder.locator('.folder-shape')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -3)');
  await page.screenshot({ path: '.app-data/validation/folder-hover.png' });
  await page.mouse.move(0, 0);
  await expect(page.locator('.note-card')).toHaveCount(6);
  await expect(page.locator('.header-note')).toHaveText('');
  await expect(page.getByRole('button', { name: 'トップに戻る' })).toHaveCSS('border-right-width', '1px');
  await expect(page.getByRole('button', { name: 'ホームフォルダー', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'ホームフォルダー', exact: true }).locator('img')).toHaveAttribute('src', '/images/kawazu.svg');
  const ids = await page.locator('.note-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-note-id')));
  await page.getByRole('button', { name: '次の作品ページ' }).click();
  await expect.poll(() => page.locator('.note-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-note-id')))).not.toEqual(ids);
  const folders = await (await request.get('/api/folders')).json() as { path: string; count: number }[];
  expect(folders.length).toBeGreaterThan(0);
  const folder = folders.find(f => f.path !== '000') ?? folders[0];
  const label = folder.path === '000' ? 'ホーム' : folder.path;
  await page.getByRole('button', { name: `${label}フォルダー`, exact: true }).click();
  await expect.poll(() => page.locator('.note-card').evaluateAll((cards, prefix) => cards.length > 0 && cards.every(card => card.getAttribute('data-relative-path')?.startsWith(prefix)), `${folder.path}/`)).toBe(true);
  await expect(page.getByRole('button', { name: `${label}フォルダー`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.thumbnail img').evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth === 320))).toBe(true);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 900, height: 480 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await expect(page.getByRole('button', { name: 'トップに戻る' })).toBeInViewport();
    await expect(page.locator('.folder-strip')).toHaveCSS('scrollbar-width', 'none');
    expect(await page.locator('.folder-strip').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'ホームフォルダー', exact: true }).click();
  await expect.poll(() => page.locator('.note-card').evaluateAll(cards => cards.length > 0 && cards.every(card => card.getAttribute('data-relative-path')?.startsWith('000/')))).toBe(true);
  const home = folders.find(f => f.path === '000')!;
  const fullPageBottom = await page.locator('.view-bottom').boundingBox();
  const lastPage = Math.ceil(home.count / 6);
  for (let i = 1; i < lastPage; i++) {
    await page.getByRole('button', { name: '次の作品ページ' }).click();
    await expect(page.locator('.gallery-page-status')).toHaveAttribute('data-page', String(i + 1));
    await expect(page.locator('.gallery-page-status')).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.locator('.note-card')).toHaveCount(home.count % 6 || 6);
  const lastPageBottom = await page.locator('.view-bottom').boundingBox();
  expect(Math.abs(lastPageBottom!.y - fullPageBottom!.y)).toBeLessThan(1);
  const layout = await page.locator('.paper-app').boundingBox();
  expect(Math.abs(layout!.y - (720 - layout!.height) / 2)).toBeLessThan(1);
  await page.screenshot({ path: '.app-data/validation/folder.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.gallery')).toHaveCSS('grid-template-columns', /\S+ \S+ \S+/);
  await page.screenshot({ path: '.app-data/validation/mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'トップに戻る' }).click();
  await expect(page.getByRole('button', { name: 'みる', exact: true })).toBeVisible();
});
