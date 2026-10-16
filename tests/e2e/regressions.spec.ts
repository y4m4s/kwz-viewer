import { test, expect } from '@playwright/test';
import type { KwzNote, LibraryStatus } from '../../packages/shared/src/types';

const ready: LibraryStatus = { directoryConfigured: true, directory: 'C:/old', scanStatus: 'ready', total: 1, indexed: 1, failed: 0, lastScannedAt: '2026-10-16T00:00:00Z' };
const note: KwzNote = { id: 'a'.repeat(64), fileName: 'test.kwz', relativePath: 'test.kwz', status: 'ready', author: 'Test', createdAt: null, editedAt: null, fileModifiedAt: '2026-10-16T00:00:00Z', frameCount: 1, durationSeconds: 1, loop: false, byteSize: 1, thumbnailUrl: null };

test('root-level notes remain reachable alongside subfolders', async ({ page }) => {
  const nested = { ...note, id: 'b'.repeat(64), relativePath: '000/nested.kwz', fileName: 'nested.kwz' };
  await page.route('**/api/health', route => route.fulfill({ json: { ...ready, total: 2, indexed: 2 } }));
  await page.route('**/api/folders', route => route.fulfill({ json: [{ path: '000', count: 1 }] }));
  await page.route('**/api/notes?**', route => {
    const folder = new URL(route.request().url()).searchParams.get('folder');
    const items = folder ? [nested] : [note, nested];
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 6 } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ホームフォルダー', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'test.kwzを開く' })).toHaveCount(0);
  await page.getByRole('button', { name: 'すべてフォルダー', exact: true }).click();
  await expect(page.getByRole('button', { name: 'test.kwzを開く' })).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(2);
});

test('unconfigured state never loads a stale server list', async ({ page }) => {
  let listRequests = 0;
  await page.route('**/api/health', route => route.fulfill({ json: { ...ready, directoryConfigured: false, directory: undefined } }));
  await page.route('**/api/notes?**', route => { listRequests++; return route.fulfill({ json: { items: [note], page: 1, pageSize: 6, total: 99 } }); });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'フォルダが選択されていません' })).toBeVisible();
  await expect(page.getByRole('button', { name: '次の作品ページ' })).not.toBeVisible();
  expect(listRequests).toBe(0);
});

test('a health response started before folder selection cannot overwrite the new folder', async ({ page }) => {
  let healthCalls = 0;
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = new Promise<void>(resolve => { started = resolve; });
  const next = { ...ready, directory: 'C:/new', total: 0, indexed: 0 };
  await page.route('**/api/health', async route => {
    healthCalls++;
    if (healthCalls === 2) { started(); await gate; return route.fulfill({ json: ready }); }
    return route.fulfill({ json: healthCalls === 1 ? ready : next });
  });
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [], page: 1, pageSize: 6, total: 0 } }));
  await page.route('**/api/library/select', route => route.fulfill({ json: { cancelled: false, status: next } }));
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await delayed;
  const selector = page.getByRole('button', { name: 'フォルダ選択', exact: true });
  await selector.click(); await expect(selector).toHaveText('選択中：C:/new');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/health'));
  release(); await oldResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(selector).toHaveText('選択中：C:/new');
});

test('temporary metadata failures keep the player open; only a missing note closes it', async ({ page }) => {
  let missing = false; let checked!: () => void;
  const checkedOnce = new Promise<void>(resolve => { checked = resolve; });
  let status = ready;
  await page.route('**/api/health', route => route.fulfill({ json: status }));
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [note], page: 1, pageSize: 6, total: 1 } }));
  await page.route(`**/api/notes/${note.id}/file`, route => route.fulfill({ status: 503, body: '' }));
  await page.route(`**/api/notes/${note.id}`, async route => {
    await route.fulfill({ status: missing ? 404 : 503, json: { error: { code: 'UNAVAILABLE', message: '一時エラー' } } });
    checked();
  });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await page.getByRole('button', { name: 'test.kwzを開く' }).click();
  await checkedOnce;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('開いていた作品が削除されました。')).toHaveCount(0);
  missing = true; status = { ...ready, lastScannedAt: '2026-10-16T00:01:00Z' };
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('開いていた作品が削除されました。')).toBeVisible();
});

test('an updated open note reloads its metadata and playback data', async ({ page }) => {
  let current = note; let status = ready; let fileLoads = 0;
  await page.route('**/api/health', route => route.fulfill({ json: status }));
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/notes?**', route => route.fulfill({ json: { items: [current], page: 1, pageSize: 6, total: 1 } }));
  await page.route(`**/api/notes/${note.id}`, route => route.fulfill({ json: current }));
  await page.route(`**/api/notes/${note.id}/file`, route => { fileLoads++; return route.fulfill({ status: 503, body: '' }); });
  await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
  await page.getByRole('button', { name: 'test.kwzを開く' }).click();
  await expect.poll(() => fileLoads).toBe(1);
  current = { ...note, author: 'Updated Author', fileModifiedAt: '2026-10-16T00:01:00Z' };
  status = { ...ready, lastScannedAt: current.fileModifiedAt };
  await expect(page.getByRole('dialog').getByText('Updated Author', { exact: true })).toBeVisible();
  await expect.poll(() => fileLoads).toBe(2);
});
