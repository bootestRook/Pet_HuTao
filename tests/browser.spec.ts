import { test, expect, type Page } from '@playwright/test';
import { BATTLE_LIMIT_MS, HEAL_ON_CONTACT } from '../shared/catalog.js';
import type { CategoryId, PetId } from '../shared/types.js';

async function catalog(page: Page, category: CategoryId) {
  await page.locator(`#catalog-tabs [data-category="${category}"]`).click();
  await page.locator('#catalog-search').fill('');
}
async function chooseBall(page: Page, id: PetId) {
  await catalog(page, 'pets');
  await page.locator(`[data-candidate="${id}"]`).click();
  const button = page.locator('#equip-candidate');
  if (await button.isEnabled()) await button.click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function movingSquare(page: Page) {
  const canvas = page.locator('#arena-canvas');
  await expect(canvas).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  const first = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(first);
}
async function arenaInViewport(page: Page) {
  await expect.poll(() => page.locator('.arena-panel').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= -1 && bounds.bottom <= innerHeight + 1;
  })).toBe(true);
}
async function join(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByLabel('你的昵称').fill(name);
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await expect(page.locator('#preparation')).toBeVisible();
}

test('two balls, empty expansion systems and synchronized desktop/mobile collision battle', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Reduced motion removes decorative effects, never essential simulation motion.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage();
  const guest = await mobile.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!);
    await expect(host).toHaveTitle('小球斗场 · 好友对战');
    await host.getByLabel('你的昵称').fill('蓄力玩家');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    await expect(host.locator('#catalog-tabs [role="tab"]')).toHaveCount(4);
    await expect(host.locator('[data-category="weapons"]')).toHaveCount(0);
    await catalog(host, 'pets');
    await expect(host.locator('#catalog-grid [data-candidate]')).toHaveCount(2);
    await expect(host.locator('#battle-view')).toBeHidden();
    await host.locator('#catalog-search').fill('回血');
    await expect(host.locator('#catalog-grid [data-candidate]')).toHaveCount(1);
    await expect(host.locator('[data-candidate="renew"]')).toBeVisible();
    await host.locator('[data-candidate="renew"]').click();
    await expect(host.locator('#detail-description')).toContainText(`恢复 ${HEAL_ON_CONTACT} 点生命`);
    await expect(host.locator('#selected-pet-name')).toHaveText('蓄力球');
    for (const [category, label, limit] of [['items', '道具', 8], ['skills', '技能', 4], ['traits', '特性', 1]] as [CategoryId, string, number][]) {
      await catalog(host, category);
      await expect(host.locator('#catalog-grid [data-candidate]')).toHaveCount(0);
      await expect(host.locator('#catalog-empty')).toContainText(`暂无${label}`);
      await expect(host.locator('#equip-candidate')).toBeDisabled();
      await host.locator(`#equipped-tabs [data-category="${category}"]`).click();
      await expect(host.locator('#equipped-count')).toHaveText(`0 / ${limit}`);
      await expect(host.locator('#equipped-slots [data-equipped-id]')).toHaveCount(0);
      await expect(host.locator('#ready')).toBeEnabled();
    }
    await host.locator('#catalog-tabs [data-category="items"]').focus();
    await host.keyboard.press('ArrowRight');
    await expect(host.locator('#catalog-tabs [data-category="skills"]')).toBeFocused();
    await expect(host.locator('#catalog-tabs [data-category="skills"]')).toHaveAttribute('aria-selected', 'true');
    await chooseBall(host, 'charge');
    await noOverflow(host);
    await host.screenshot({ path: testInfo.outputPath('desktop-preparation.png'), fullPage: true });
    await join(guest, `${baseURL}/?room=${roomId}`, '回春玩家');
    await chooseBall(guest, 'renew');
    await expect(guest.locator('#selected-pet-name')).toHaveText('回春球');
    await expect(host.locator('#seat-1')).toContainText('回春球');
    await noOverflow(guest);
    await guest.screenshot({ path: testInfo.outputPath('mobile-preparation.png'), fullPage: true });
    await host.locator('#ready').click();
    await guest.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'countdown');
    await expect(host.locator('#battle-view')).toBeHidden();
    await expect(guest.locator('#ready')).toBeDisabled();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await expect(guest.locator('#preparation')).toBeHidden();
    await movingSquare(host);
    await movingSquare(guest);
    await arenaInViewport(host);
    await arenaInViewport(guest);
    await expect(host.locator('#player-0 .fighter-name')).toContainText('P1');
    await expect(host.locator('#player-1 .fighter-name')).toContainText('P2');
    await expect(host.locator('#battle-log li[data-kind="charge"]')).not.toHaveCount(0);
    await expect(host.locator('.battle-journal')).not.toHaveAttribute('open', '');
    await host.screenshot({ path: testInfo.outputPath('desktop-battle.png'), fullPage: true });
    await guest.screenshot({ path: testInfo.outputPath('mobile-battle.png'), fullPage: true });
    await mobile.setOffline(true);
    await expect(guest.locator('#connection')).toContainText('正在重连');
    await mobile.setOffline(false);
    await expect(guest.locator('#connection')).toContainText('已连接');
    await guest.reload();
    await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#battle-view')).toBeVisible();
    await expect(host.locator('#result')).toBeVisible({ timeout: BATTLE_LIMIT_MS + 10_000 });
    await expect(guest.locator('#result')).toBeVisible();
    expect(await guest.locator('#result-stats').textContent()).toBe(await host.locator('#result-stats').textContent());
    expect(await guest.locator('#battle-clock').textContent()).toBe(await host.locator('#battle-clock').textContent());
    expect(await guest.locator('.health-label').allTextContents()).toEqual(await host.locator('.health-label').allTextContents());
    await expect(host.locator('#battle-log li[data-kind="attack"]')).not.toHaveCount(0);
    await expect(host.locator('#battle-log li[data-kind="heal"]')).not.toHaveCount(0);
    await host.locator('.battle-journal summary').click();
    await expect(host.locator('#battle-log')).toBeVisible();
    await noOverflow(guest);
    await host.screenshot({ path: testInfo.outputPath('desktop-result.png'), fullPage: true });
    await guest.screenshot({ path: testInfo.outputPath('mobile-result.png'), fullPage: true });
    await host.locator('#rematch').click();
    await expect(host.locator('#rematch')).toBeDisabled();
    await guest.locator('#rematch').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'waiting');
    await expect(host.locator('#battle-view')).toBeHidden();
    await expect(guest.locator('#selected-pet-name')).toHaveText('回春球');
    await expect(host.locator('#ready')).toBeEnabled();
    await guest.locator('#leave').click();
    await expect(guest.locator('#entry')).toBeVisible();
    await expect(host.locator('#seat-1')).toContainText('空位');
    expect(errors).toEqual([]);
  } finally {
    await desktop.close(); await mobile.close();
  }
});

test('spectator reconnects and watches two matching balls and their shared result', async ({ browser, baseURL }, testInfo) => {
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await hostContext.newPage();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const errors: string[] = [];
  for (const page of [host, first, second]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!);
    await host.locator('#mode-player').focus();
    await host.keyboard.press('ArrowRight');
    await expect(host.locator('#mode-spectator')).toBeFocused();
    await host.getByLabel('你的昵称').fill('观战主持人');
    await host.getByRole('button', { name: '创建观战房间', exact: true }).click();
    await expect(host.locator('#room')).toHaveAttribute('data-role', 'spectator');
    await expect(host.locator('#loadout-panel')).toBeHidden();
    await expect(host.locator('#ready')).toBeHidden();
    const roomId = (await host.locator('#room-id').textContent())!;
    await host.reload();
    await expect(host.locator('#room')).toHaveAttribute('data-role', 'spectator');
    await join(first, `${baseURL}/?room=${roomId}`, '一号球');
    await join(second, `${baseURL}/?room=${roomId}`, '二号球');
    await expect(host.locator('#seat-0')).toContainText('蓄力球');
    await expect(host.locator('#seat-1')).toContainText('蓄力球');
    await host.setViewportSize({ width: 390, height: 844 });
    await noOverflow(host);
    await host.screenshot({ path: testInfo.outputPath('spectator-mobile-waiting.png'), fullPage: true });
    await host.setViewportSize({ width: 1440, height: 1000 });
    await first.locator('#ready').click();
    await second.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'countdown');
    await hostContext.setOffline(true);
    await expect(host.locator('#connection')).toContainText('正在重连');
    await expect(first.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await hostContext.setOffline(false);
    await expect(host.locator('#connection')).toContainText('已连接');
    await host.reload();
    await expect(host.locator('#room')).toHaveAttribute('data-role', 'spectator');
    await movingSquare(host);
    await expect(host.locator('#player-0 .fighter-name')).toContainText('P1');
    await expect(host.locator('#player-1 .fighter-name')).toContainText('P2');
    await host.screenshot({ path: testInfo.outputPath('spectator-battle.png'), fullPage: true });
    for (const page of [host, first, second]) await expect(page.locator('#result')).toBeVisible({ timeout: BATTLE_LIMIT_MS + 10_000 });
    const result = await first.locator('#result-stats').textContent();
    expect(await host.locator('#result-stats').textContent()).toBe(result);
    expect(await second.locator('#result-stats').textContent()).toBe(result);
    await expect(host.locator('#rematch')).toBeHidden();
    await first.locator('#rematch').click();
    await second.locator('#rematch').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'waiting');
    await expect(host.locator('#spectator-waiting')).toBeVisible();
    await first.locator('#leave').click();
    await second.locator('#leave').click();
    await expect(host.locator('#seat-0')).toContainText('空位');
    await expect(host.locator('#seat-1')).toContainText('空位');
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close(); await firstContext.close(); await secondContext.close();
  }
});
