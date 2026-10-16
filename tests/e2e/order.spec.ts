import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
test('drag order persists across reload, supports other pages and never opens the player', async ({ page, request }) => {
  test.skip(!existsSync(process.env.KWZ_TEST_DIRECTORY || path.resolve('data')), '実KWZフォルダが必要です');
  await expect.poll(async () => (await request.get('/api/health')).json().then(s => s.scanStatus)).toBe('ready');
  const initial = (await (await request.get('/api/notes?folder=000&pageSize=100')).json()).items as { id: string }[];
  test.skip(initial.length < 7, 'ページをまたぐ検証には7作品以上必要です');
  const [source, target] = initial;
  const ids = () => page.locator('.gallery .note-card:not(.drag-carrier)').evaluateAll(cards => cards.map(card => card.getAttribute('data-note-id')));
  const card = (id: string) => page.locator(`.note-card[data-note-id="${id}"]:not(.drag-carrier)`);
  const move = async (sourceId: string, targetId: string, placement: string) => {
    const response = await request.post('/api/notes/order', { data: { folder: '000', sourceId, targetId, placement } }); expect(response.ok()).toBe(true);
  };
  try {
    await page.goto('/'); await page.getByRole('button', { name: 'みる', exact: true }).click();
    await expect(card(source.id)).toHaveAttribute('draggable', 'true');
    const targetBox = await card(target.id).boundingBox();
    await card(source.id).dragTo(card(target.id), { targetPosition: { x: targetBox!.width - 8, y: targetBox!.height / 2 } });
    await expect(page.locator('.header-note')).toHaveText('並び順を保存しました');
    await expect(page.locator('.header-note')).toHaveClass(/is-fading/);
    await expect.poll(() => page.locator('.header-note').evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(.95);
    await expect(page.locator('.header-note')).toHaveText('');
    await expect.poll(ids).toEqual([target.id, source.id, ...initial.slice(2, 6).map(n => n.id)]);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.reload(); await page.getByRole('button', { name: 'みる', exact: true }).click();
    await expect.poll(ids).toEqual([target.id, source.id, ...initial.slice(2, 6).map(n => n.id)]);
    // Restore the starting order, then drag the first note to page two using the arrow hover.
    await move(source.id, target.id, 'before');
    await page.reload(); await page.getByRole('button', { name: 'みる', exact: true }).click();
    await expect(card(source.id)).toHaveAttribute('draggable', 'true');
    const box = await card(source.id).boundingBox(); const arrow = await page.getByRole('button', { name: '次の作品ページ' }).boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2, { steps: 5 });
    await expect(card(source.id)).toHaveClass(/is-dragging/);
    // Hold beside the visible arrow, inside the relaxed drag-only hit area.
    await page.mouse.move(arrow!.x - 10, arrow!.y + arrow!.height / 2, { steps: 8 });
    await page.mouse.move(arrow!.x - 10, arrow!.y + arrow!.height / 2);
    await expect(page.locator('.gallery-page-status')).toHaveAttribute('data-page', '2');
    await expect(card(initial[6].id)).toBeVisible();
    const nextBox = await card(initial[6].id).boundingBox();
    await page.mouse.move(nextBox!.x + nextBox!.width - 8, nextBox!.y + nextBox!.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.header-note')).toHaveText('並び順を保存しました');
    await expect.poll(ids).toEqual([source.id, ...initial.slice(7, 12).map(n => n.id)]);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.gallery .note-card').first()).toHaveAttribute('draggable', 'true');
  } finally {
    await page.mouse.up(); await move(source.id, target.id, 'before');
  }
});
