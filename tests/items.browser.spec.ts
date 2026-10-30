import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { BATTLE_LIMIT_MS, ITEMS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

async function equip(page: Page, ids: string[]) {
  await page.locator('#catalog-tabs [data-category="pets"]').click();
  await page.locator('[data-candidate="chengzhiquan"]').click(); await page.locator('#equip-candidate').click();
  await page.locator('#catalog-tabs [data-category="items"]').click();
  await expect(page.locator('#catalog-grid [data-candidate]')).toHaveCount(ITEMS.length);
  for (const [index, id] of ids.entries()) {
    await page.locator(`[data-candidate="${id}"]`).click();
    await page.locator('#equip-candidate').click();
    await expect(page.locator('#equipped-count')).toHaveText(`${index + 1} / 3`);
  }
}

test('three-item loadouts equip on desktop/mobile and synchronize field objects, bombs, debt, reload, results and rematch', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(), guest = await mobile.newPage();
  let viewer: Room | undefined;
  const states: RoomSnapshot[] = [], events = new Map<number, BattleEvent>(), errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('快递甲');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    const firstItems = ['bomb-parcel', 'pain-installment', 'banana-peel'];
    const secondItems = ['bomb-parcel', 'wall-punch', 'pearl-cup'];
    await equip(host, firstItems);
    await expect(host.locator('#equipped-page')).toHaveText('1 / 1');
    await host.locator('[data-candidate="wall-punch"]').click(); await expect(host.locator('#equip-candidate')).toBeDisabled();
    await host.locator('[data-candidate="banana-peel"]').click(); await expect(host.locator('#detail-description')).toContainText('20 秒');
    await host.locator('[data-candidate="bomb-parcel"]').click();
    await expect(host.locator('#detail-description')).toContainText('20 秒'); await expect(host.locator('#detail-description')).toContainText('30 点');
    await host.screenshot({ path: testInfo.outputPath('items-preparation-desktop.png'), fullPage: true });
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill('快递乙');
    await guest.getByRole('button', { name: '加入', exact: true }).click();
    await expect(guest.locator('#room')).toBeVisible(); await equip(guest, secondItems);
    await guest.locator('[data-candidate="pearl-cup"]').click(); await expect(guest.locator('#detail-description')).toContainText('15%');
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.screenshot({ path: testInfo.outputPath('items-preparation-mobile.png'), fullPage: true });
    viewer = await new Client(baseURL!).joinById(roomId, { name: '道具观众' });
    viewer.onMessage('snapshot', (state: RoomSnapshot) => { states.push(state); for (const event of state.events) events.set(event.seq, event); });
    viewer.onMessage('clock', () => {}); viewer.onMessage('error', value => errors.push(JSON.stringify(value))); viewer.send('sync');
    await expect.poll(() => states.at(-1)?.players.map(player => player.loadout.items.length)).toEqual([3, 3]);
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await expect.poll(() => states.at(-1)?.battle?.field.bombs.length).toBe(2);
    const firstBattle = states.at(-1)!;
    const bombs = firstBattle.battle!.field.bombs.map(bomb => [bomb.id, bomb.ownerId, bomb.explodesAtMs]);
    expect(bombs.every(bomb => bomb[2] === 20_000)).toBe(true);
    await expect(host.locator('#player-0 .fighter-items')).toContainText('道具 3/3');
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-1 .fighter-items')).toContainText('道具 3/3');
    expect(states.at(-1)!.battle!.field.bombs.map(bomb => [bomb.id, bomb.ownerId, bomb.explodesAtMs])).toEqual(bombs);
    await expect.poll(() => states.at(-1)?.battle?.elapsedMs ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(20_000);
    expect([...events.values()].filter(event => event.effect === 'bomb' && event.kind === 'item-damage')).toHaveLength(2);
    expect([...events.values()].filter(event => event.effect === 'pearl' && event.kind === 'item').length).toBeGreaterThanOrEqual(2);
    expect(states.some(state => state.battle?.field.bananas.length)).toBe(true);
    expect(states.some(state => state.battle?.field.punches.length)).toBe(true);
    expect(states.some(state => state.battle?.fighters.some(f => f.items.debts.length))).toBe(true);
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('items-battle-desktop.png') });
    await guest.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('items-battle-mobile.png') });
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.dice-overlay, .dice-card')).toHaveCount(0);
    }
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'finished', { timeout: BATTLE_LIMIT_MS });
    await expect(guest.locator('#room')).toHaveAttribute('data-phase', 'finished');
    await expect.poll(() => states.at(-1)?.phase).toBe('finished');
    expect(await guest.locator('#result-stats').textContent()).toBe(await host.locator('#result-stats').textContent());
    expect(await guest.locator('#battle-log li').allTextContents()).toEqual(await host.locator('#battle-log li').allTextContents());
    const result = states.at(-1)!;
    expect(result.battle!.field).toEqual({ bananas: [], punches: [], pearls: [], bombs: [] });
    for (const fighter of result.battle!.fighters) {
      expect(fighter.items.debts).toHaveLength(0);
      const damage = [...events.values()].filter(e => e.sourceId === fighter.id && e.targetId !== fighter.id && ['attack', 'slap', 'drain', 'item-damage', 'installment', 'refund'].includes(e.kind)).reduce((sum, e) => sum + e.amount, 0);
      const healing = [...events.values()].filter(e => e.targetId === fighter.id && (e.kind === 'heal' || (e.kind === 'rewind' && e.amount > 0))).reduce((sum, e) => sum + e.amount, 0);
      expect(fighter.damageDealt).toBe(damage); expect(fighter.healing).toBe(healing);
    }
    await testInfo.attach('item-authoritative-result', { body: JSON.stringify({ battle: result.battle, events: [...events.values()] }, null, 2), contentType: 'application/json' });
    await host.locator('#rematch').click(); await guest.locator('#rematch').click();
    await expect(host.locator('#preparation')).toBeVisible();
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect.poll(() => states.at(-1)?.battle?.field.bombs.length).toBe(2);
    expect(states.at(-1)!.matchId).not.toBe(result.matchId);
    // By the time the UI is visible the new round can already have collided.
    // Audit reset state in the first authoritative snapshot of this match.
    const restarted = states.find(state => state.phase === 'battle' && state.matchId !== result.matchId)!;
    expect(restarted.battle!.fighters.every(f => !f.items.rewindUsed && f.items.debts.length === 0)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await viewer?.leave().catch(() => {}); await desktop.close(); await mobile.close(); }
});

type Point = { x: number; y: number };
type ItemFrame = { balls: Point[]; parcels: Point[]; punches: Point[]; pearls: Point[]; labels: { text: string; x: number; y: number; width: number }[] };
type ItemWindow = Window & { itemFixture: { frame: ItemFrame; renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void } } };

test('item art tracks interpolated owners, keeps ground objects fixed, snaps teleports, respects corners and reduced motion', async ({ page, baseURL }, testInfo) => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected renderer bundle');
  await page.route('**/items-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: output.output.find(chunk => chunk.type === 'chunk')!.code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), items: (id === 'a' ? ['bomb-parcel', 'emergency-toilet', 'refund-code'] : ['overinflator', 'wall-punch', 'pearl-cup']) } }));
  const battle = new BattleSimulator(players, 3).snapshot(); battle.elapsedMs = 20_000;
  const [a, b] = battle.fighters;
  Object.assign(a, { x: 100, y: 160, hp: 70, vx: 0, vy: 0 });
  Object.assign(b, { x: 300, y: 300, radius: 48, hp: 60, vx: 0, vy: 0 });
  Object.assign(a.items, { refundAmount: 5, refundExpiresAtMs: 24_000, teleportStartedAtMs: 19_900, slipUntilMs: 24_000 });
  b.items.pumpedUntilMs = 24_000;
  battle.field = {
    bombs: [{ id: 1, ownerId: 'a', holderId: 'a', explodesAtMs: 24_000 }],
    bananas: [{ id: 2, ownerId: 'a', x: 80, y: 65, expiresAtMs: 40_000, armed: true }],
    pearls: [{ id: 3, ownerId: 'a', x: 205, y: 90, expiresAtMs: 30_000 }, { id: 4, ownerId: 'b', x: 200, y: 300, expiresAtMs: 30_000 }],
    punches: [{ id: 5, ownerId: 'a', x: 100, y: 250, originX: 14, originY: 250, dx: 1, dy: 0, launchAtMs: 19_000 }],
  };
  const snapshot: RoomSnapshot = { roomId: 'items', matchId: 'items', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  await page.evaluate(async () => {
    const url = '/items-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'items-fixture';
    canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:min(420px,calc(100vw - 20px));height:min(420px,calc(100vw - 20px));z-index:100'; document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const empty = (): ItemFrame => ({ balls: [], parcels: [], punches: [], pearls: [], labels: [] });
    const fixture: ItemWindow['itemFixture'] = { frame: empty(), renderer: new ArenaRenderer(canvas) };
    (window as unknown as ItemWindow).itemFixture = fixture;
    const fillRect = ctx.fillRect.bind(ctx); ctx.fillRect = (x, y, w, h) => { if (x === 0 && y === 0 && w === 420 && h === 420) fixture.frame = empty(); fillRect(x, y, w, h); };
    const arc = ctx.arc.bind(ctx); ctx.arc = (x, y, r, start, end, ccw) => { if (r === 32 || r === 48) fixture.frame.balls.push({ x, y }); if (r === 9) fixture.frame.pearls.push({ x, y }); arc(x, y, r, start, end, ccw); };
    const fill = ctx.fill.bind(ctx); ctx.fill = ((...args: unknown[]) => {
      const transform = ctx.getTransform(), scale = canvas.width / 420;
      const point = { x: transform.e / scale, y: transform.f / scale };
      if (ctx.fillStyle === '#bd8a54' || ctx.fillStyle === '#a9443c') fixture.frame.parcels.push(point);
      if (ctx.fillStyle === '#df695c') fixture.frame.punches.push(point);
      Reflect.apply(fill, ctx, args);
    }) as CanvasRenderingContext2D['fill'];
    const fillText = ctx.fillText.bind(ctx); ctx.fillText = (text, x, y, width) => { fixture.frame.labels.push({ text, x, y, width: ctx.measureText(text).width }); if (width === undefined) fillText(text, x, y); else fillText(text, x, y, width); };
  });
  const update = async (events: BattleEvent[] = [], reset = false) => page.evaluate(({ state, events, reset }) => (window as unknown as ItemWindow).itemFixture.renderer.update(state, events, reset), { state: snapshot, events, reset });
  const frame = () => page.evaluate(() => (window as unknown as ItemWindow).itemFixture.frame);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await update([], true); await page.clock.runFor(40); const before = await frame();
  expect(before.parcels).toHaveLength(1); expect(before.pearls).toHaveLength(2); expect(before.punches).toHaveLength(1);
  a.x = 240; battle.field.punches[0].x = 180; battle.elapsedMs += 200;
  await update(); await page.clock.runFor(100); const after = await frame();
  const delta = after.balls[0].x - before.balls[0].x;
  expect(delta).toBeGreaterThan(0); expect(after.balls[0].x).toBeLessThan(240);
  expect(after.parcels[0].x - before.parcels[0].x).toBeCloseTo(delta, 4);
  expect(after.pearls).toEqual(before.pearls);
  expect(after.punches[0].x).toBeGreaterThan(100); expect(after.punches[0].x).toBeLessThan(180);
  a.x = 350; a.items.positionRevision++; battle.elapsedMs += 200;
  await update(); await page.clock.runFor(20); expect((await frame()).balls[0].x).toBe(350);
  for (const motion of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const [x, y] of [[32, 32], [388, 32], [32, 388], [388, 388]]) {
      Object.assign(a, { x, y }); battle.elapsedMs += 100;
      const event: BattleEvent = { seq: 1, timeMs: battle.elapsedMs, kind: 'item-damage', effect: 'punch', sourceId: 'b', targetId: 'a', amount: 12, x, y, text: '墙里一拳' };
      await update([event], true); await page.clock.runFor(120);
      for (const label of (await frame()).labels) {
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420);
        expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412);
      }
    }
  }
  Object.assign(a, { x: 130, y: 160 }); battle.elapsedMs = 20_000;
  const simultaneous: BattleEvent[] = [
    { seq: 1, timeMs: 20_000, kind: 'item-damage', effect: 'bomb', sourceId: 'b', targetId: 'a', amount: 15, x: 130, y: 160, text: '炸弹扣血' },
    { seq: 2, timeMs: 20_000, kind: 'heal', effect: 'pearl', sourceId: 'a', targetId: 'a', amount: 18, x: 130, y: 160, text: '珍珠回血' },
    { seq: 3, timeMs: 20_000, kind: 'item', effect: 'bomb', sourceId: 'b', targetId: 'a', amount: 0, x: 130, y: 160, text: '签收炸弹快递，爆炸！' },
    { seq: 4, timeMs: 20_000, kind: 'item', effect: 'installment', sourceId: 'b', targetId: 'a', amount: 15, x: 130, y: 160, text: '伤害分期' },
    { seq: 5, timeMs: 20_000, kind: 'installment', effect: 'installment', sourceId: 'b', targetId: 'a', amount: 3, x: 130, y: 160, text: '本期扣款' },
  ];
  await update(simultaneous, true); await page.clock.runFor(120);
  const labels = (await frame()).labels.filter(label => ['−18', '+18', '签收爆炸！'].includes(label.text));
  expect(labels).toHaveLength(3);
  expect((await frame()).labels.some(label => label.text === '−15' || label.text === '−3')).toBe(false);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(Math.abs(labels[i].y - labels[j].y)).toBeGreaterThanOrEqual(20);
  await page.locator('#items-fixture').screenshot({ path: testInfo.outputPath('item-art-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(120); await page.locator('#items-fixture').screenshot({ path: testInfo.outputPath('item-art-mobile.png') });
  await update([], true); await page.clock.runFor(120);
  const still = await page.locator('#items-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.clock.runFor(80); expect(await page.locator('#items-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(still);
  snapshot.phase = 'finished'; battle.finished = true; battle.field = { bananas: [], punches: [], pearls: [], bombs: [] };
  a.items.teleportStartedAtMs = null; a.items.refundAmount = 0; a.items.slipUntilMs = b.items.pumpedUntilMs = 0; b.radius = 32;
  await update([], true); await page.clock.runFor(120);
  const ended = await frame(); expect(ended.parcels).toHaveLength(0); expect(ended.pearls).toHaveLength(0); expect(ended.punches).toHaveLength(0);
  expect(ended.labels.some(label => /退 |\ds|倒带/.test(label.text))).toBe(false);
  await page.evaluate(() => (window as unknown as ItemWindow).itemFixture.renderer.destroy());
});
