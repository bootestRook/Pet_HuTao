import { test, expect, type Page } from '@playwright/test';
import { HUTAO_QUOTES } from '../shared/hutao.js';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { createDefaultLoadout } from '../shared/catalog.js';
import type { RoomSnapshot } from '../shared/types.js';

async function chooseHutao(page: Page) {
  await page.locator('#catalog-tabs [data-category="pets"]').click();
  await page.locator('[data-candidate="hutao"]').click();
  await expect(page.locator('#detail-description')).toContainText('每 10 秒掷骰');
  await expect(page.locator('#detail-description')).toContainText('1 点：回复 12 生命');
  await expect(page.locator('#detail-description')).toContainText('造成 8 伤害');
  await expect(page.locator('#detail-description')).toContainText('自损 4 生命');
  await expect(page.locator('#detail-description')).toContainText('回复 25 生命');
  await expect(page.locator('#detail-stats dd')).toHaveText(['100', '14', '330 / 秒']);
  if (await page.locator('#equip-candidate').isEnabled()) await page.locator('#equip-candidate').click();
  await expect(page.locator('#selected-pet-name')).toHaveText('胡涛');
  await expect(page.locator('#pet-stats dd')).toHaveText(['固有效果自动生效', '100', '14', '330 / 秒']);
}

test('single-die mirror rolls share authoritative results without central panels on desktop and mobile', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(); const guest = await mobile.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('嘴强教练');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    await chooseHutao(host);
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill('怀旧教练');
    await guest.getByRole('button', { name: '加入', exact: true }).click();
    await expect(guest.locator('#room')).toBeVisible();
    await chooseHutao(guest);
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await expect(host.locator('#battle-log li[data-kind="roll"]')).toHaveCount(2, { timeout: 15_000 });
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('single-die-rolling.png') });
    const results = (page: Page) => page.locator('#battle-log li').filter({ hasText: /上嘴脸 \[[1-6]点\]/ });
    await expect(results(host)).toHaveCount(2); await expect(results(guest)).toHaveCount(2);
    expect(await results(guest).allTextContents()).toEqual(await results(host).allTextContents());
    for (const line of await results(host).allTextContents()) {
      const match = line.match(/上嘴脸 \[([1-6])点\]「([^」]+)」/)!;
      expect(HUTAO_QUOTES.some(quote => quote === match[2])).toBe(true);
      if (match[1] === '1') expect(line).toContain('恢复');
      else if (match[1] === '6') expect(line).toContain('远程巴掌');
      else expect(line).toContain('自损 4');
    }
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('single-die-desktop.png') });
    await guest.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('single-die-mobile.png') });
    for (const page of [host, guest]) {
      await expect(page.locator('.dice-overlay, .dice-card')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-0 .fighter-pet')).toHaveText('胡涛');
    await expect(guest.locator('.dice-overlay, .dice-card')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await desktop.close(); await mobile.close(); }
});

test('world-space die follows its moving owner, stays inside corners and expires after a decisive roll', async ({ page, baseURL }, testInfo) => {
  // Exercise the real renderer in an isolated browser fixture, without product debug endpoints.
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected a renderer build');
  const code = output.output.find(chunk => chunk.type === 'chunk')!.code;
  await page.route('**/hutao-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: code }));
  await page.goto(baseURL!); await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), petId: 'hutao' as const } }));
  const battle = new BattleSimulator(players, 3).snapshot(); battle.elapsedMs = 10_000;
  Object.assign(battle.fighters[0], { x: 100, y: 150, vx: 0, vy: 0, diceRoll: { startedAtMs: 10_000, value: 1, outcome: 'heal', quote: '666', resolved: false } });
  Object.assign(battle.fighters[1], { x: 340, y: 350, vx: 0, vy: 0 });
  const snapshot: RoomSnapshot = { roomId: 'fixture', matchId: 'fixture', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  await page.evaluate(async state => {
    const url = '/hutao-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:10px;top:10px;width:420px;height:420px;z-index:100';
    const canvas = document.createElement('canvas'); canvas.id = 'die-fixture'; canvas.style.cssText = 'width:420px;height:420px';
    wrap.append(canvas); document.body.append(wrap);
    const renderer = new ArenaRenderer(canvas);
    (window as unknown as { dieFixture: typeof renderer }).dieFixture = renderer;
    renderer.update(state, [], true);
  }, snapshot);
  const update = async () => {
    await page.evaluate(state => (window as unknown as { dieFixture: { update(state: RoomSnapshot, events: never[]): void } }).dieFixture.update(state, []), snapshot);
    await page.clock.runFor(120);
  };
  const brightPixels = (x: number, y: number) => page.locator('#die-fixture').evaluate((canvas: HTMLCanvasElement, point) => {
    const data = canvas.getContext('2d')!.getImageData(point.x - 10, point.y - 10, 20, 20).data;
    let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 150) count++;
    return count;
  }, { x, y });
  await page.clock.runFor(50);
  const canvas = page.locator('#die-fixture');
  const staticFrame = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.clock.runFor(40);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(staticFrame);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.runFor(16);
  const movingFrame = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.clock.runFor(40);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(movingFrame);
  battle.elapsedMs = 10_800; battle.fighters[0].diceRoll!.resolved = true;
  await page.emulateMedia({ reducedMotion: 'reduce' }); await update();
  expect(await brightPixels(123, 96)).toBeGreaterThan(100);
  Object.assign(battle.fighters[0], { x: 260, y: 270 }); battle.elapsedMs += 100;
  await update();
  expect(await brightPixels(123, 96)).toBe(0);
  expect(await brightPixels(283, 216)).toBeGreaterThan(100);
  for (const [x, y, dieX, dieY] of [[32, 32, 55, 86], [388, 32, 396, 86], [32, 388, 55, 334], [388, 388, 396, 334]]) {
    Object.assign(battle.fighters[0], { x, y }); battle.elapsedMs += 100; await update();
    expect(await brightPixels(dieX, dieY)).toBeGreaterThan(100);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  battle.elapsedMs = 10_800; Object.assign(battle.fighters[0], { x: 260, y: 270 });
  snapshot.phase = 'finished'; battle.finished = true; battle.winnerId = 'a';
  await update();
  expect(await brightPixels(283, 216)).toBeGreaterThan(100);
  await page.locator('#die-fixture').screenshot({ path: testInfo.outputPath('following-die-fixture.png') });
  await page.clock.runFor(1601);
  expect(await brightPixels(283, 216)).toBe(0);
  battle.fighters[0].diceRoll!.resolved = false; await update();
  expect(await brightPixels(283, 216)).toBe(0);
  await expect(page.locator('.dice-overlay, .dice-card')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { dieFixture: { destroy(): void } }).dieFixture.destroy());
});
