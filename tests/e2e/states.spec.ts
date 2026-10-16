import { test, expect } from '@playwright/test';
import type { LibraryStatus, KwzNote } from '../../packages/shared/src/types';
const ready: LibraryStatus = { scanStatus: 'ready', total: 0, indexed: 0, failed: 0, lastScannedAt: '2026-10-13T00:00:00Z', directoryConfigured: true };

test('folder selection shows a spinning loading arrow until scanning and listing finish', async ({ page }) => {
  let status: LibraryStatus = { ...ready, directoryConfigured: false };
  let releaseList!: () => void;
  const listGate = new Promise<void>(resolve => { releaseList = resolve; });
  let listRequested!: () => void;
  const listStarted = new Promise<void>(resolve => { listRequested = resolve; });
  await page.route('**/api/health', route => route.fulfill({ json: status }));
  await page.route('**/api/folders', route => route.fulfill({ json: status.directoryConfigured && status.scanStatus === 'ready' ? [{ path: '000', count: 0 }] : [] }));
  await page.route('**/api/notes?**', async route => {
    if (status.directoryConfigured) { listRequested(); await listGate; }
    await route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 6 } });
  });
  await page.route('**/api/library/select', route => {
    status = { ...ready, directory: 'C:/作品', scanStatus: 'scanning' };
    return route.fulfill({ json: { cancelled: false, status } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await page.getByRole('button', { name: 'フォルダを開く', exact: true }).click();
  const heading = page.getByRole('heading', { name: '読み込み中……', exact: true });
  await expect(heading).toBeVisible();
  const loadingStrip = (await page.locator('.folder-strip').boundingBox())!;
  const loadingGallery = (await page.locator('.gallery-pager').boundingBox())!;
  await expect(page.getByText('作品がありません', { exact: true })).toHaveCount(0);
  const arrow = page.locator('.loading-arrow');
  await expect(arrow).toBeVisible();
  const first = await arrow.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => arrow.evaluate(element => getComputedStyle(element).transform)).not.toBe(first);
  await page.screenshot({ path: '.app-data/validation/folder-loading.png' });
  status = { ...status, scanStatus: 'ready', lastScannedAt: '2026-10-16T00:00:00Z' };
  await listStarted;
  await expect(heading).toBeVisible();
  releaseList();
  await expect(page.getByRole('heading', { name: '作品がありません', exact: true })).toBeVisible();
  await expect(arrow).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ホームフォルダー', exact: true })).toBeVisible();
  const readyStrip = (await page.locator('.folder-strip').boundingBox())!;
  const readyGallery = (await page.locator('.gallery-pager').boundingBox())!;
  expect(loadingStrip.height).toBeCloseTo(readyStrip.height, 1);
  expect(loadingStrip.y).toBeCloseTo(readyStrip.y, 1);
  expect(loadingGallery.y).toBeCloseTo(readyGallery.y, 1);
});

test('both bottom buttons react to hover across their full orange height', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { ...ready, directoryConfigured: false } }));
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  const bar = page.locator('.view-bottom');
  const barBox = (await bar.boundingBox())!;
  for (const name of ['フォルダ選択', 'トップに戻る']) {
    const button = page.getByRole('button', { name, exact: true });
    const box = (await button.boundingBox())!;
    expect(box.y).toBeCloseTo(barBox.y, 1);
    expect(box.height).toBeCloseTo(barBox.height, 1);
    await page.mouse.move(0, 0);
    await expect(button).toHaveCSS('background-color', 'rgb(247, 166, 35)');
    for (const y of [box.y + 1, box.y + box.height - 1]) {
      await page.mouse.move(box.x + box.width / 2, y);
      await expect(button).toHaveCSS('background-color', 'rgb(255, 184, 62)');
      await expect(button).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
      expect(await button.evaluate(element => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(235, 160, 44)');
    }
  }
  await page.screenshot({ path: '.app-data/validation/bottom-button-hover.png' });
});
test('folder selection: cancel, error, retry and successful loading', async ({ page }) => {
  let configured = false; let attempts = 0;
  const selectedStatus = { ...ready, directory: 'C:/作品/Flipnotes' };
  await page.route('**/api/health', route => route.fulfill({ json: configured ? selectedStatus : { ...ready, directoryConfigured: false } }));
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 6 } }));
  await page.route('**/api/library/select', async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ json: { cancelled: true } });
    if (attempts === 2) return route.fulfill({ status: 503, json: { error: { code: 'FAILED', message: 'フォルダを開けませんでした。' } } });
    if (attempts === 4) return route.fulfill({ json: { cancelled: true } });
    configured = true; return route.fulfill({ json: { cancelled: false, status: selectedStatus } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  const button = page.getByRole('button', { name: 'フォルダを開く', exact: true });
  await button.click(); await expect(button).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'フォルダが選択されていません' })).toBeVisible();
  await button.click(); await expect(page.getByRole('alert')).toHaveText('フォルダを開けませんでした。');
  await button.click(); await expect(page.getByRole('heading', { name: '作品がありません', exact: true })).toBeVisible();
  await expect(button).toHaveCount(0);
  const selector = page.getByRole('button', { name: 'フォルダ選択', exact: true });
  await expect(selector).toHaveText('選択中：C:/作品/Flipnotes');
  await selector.click(); await expect(selector).toBeEnabled();
  await expect(selector).toHaveText('選択中：C:/作品/Flipnotes');
  await page.reload(); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await expect(selector).toHaveText('選択中：C:/作品/Flipnotes');
  expect(attempts).toBe(4);
});
for (const scenario of [
  { title: 'フォルダが選択されていません', status: { ...ready, scanStatus: 'error' as const, directoryConfigured: false } },
  { title: 'フォルダを確認してください', status: { ...ready, scanStatus: 'error' as const, message: '対象フォルダを読み取れません。' } },
  { title: '作品がありません', status: ready },
]) {
  test(`UI states (API stubs): ${scenario.title}`, async ({ page }) => {
    await page.route('**/api/health', route => route.fulfill({ json: scenario.status }));
    await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 6 } }));
    await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click(); await expect(page.getByRole('heading', { name: scenario.title })).toBeVisible();
    await expect(page.locator('.empty-kawazu')).toBeVisible();
    await expect(page.locator('.empty-kawazu')).toHaveAttribute('src', '/images/kawazu.svg');
    if (!scenario.status.directoryConfigured) {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 800, height: 600 }]) {
        await page.setViewportSize(viewport);
        const button = page.getByRole('button', { name: 'フォルダを開く', exact: true });
        await expect(button).toBeInViewport();
        await page.screenshot({ path: `.app-data/validation/folder-selection-${viewport.width}.png` });
      }
    }
  });
}
test('UI states (API stubs): corrupt card, playback error and close recovery', async ({ page }) => {
  const note: KwzNote = { id: 'a'.repeat(64), fileName: 'broken.kwz', relativePath: 'broken.kwz', status: 'error', author: null,
    createdAt: null, editedAt: null, fileModifiedAt: '2026-10-13T00:00:00Z', frameCount: null, durationSeconds: null,
    loop: null, byteSize: 1, thumbnailUrl: null, errorCode: 'INVALID_KWZ' };
  await page.route('**/api/health', route => route.fulfill({ json: { ...ready, total: 1, failed: 1 } }));
  await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [note], total: 1, page: 1, pageSize: 6 } }));
  await page.route(`**/api/notes/${note.id}`, route => route.fulfill({ json: note }));
  await page.route(`**/api/notes/${note.id}/file`, route => route.fulfill({ body: 'broken', contentType: 'application/octet-stream' }));
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click(); await expect(page.getByText('解析できません')).toBeVisible();
  await page.getByRole('button', { name: 'broken.kwzを開く' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'トップに戻る' })).toBeEnabled();
});
