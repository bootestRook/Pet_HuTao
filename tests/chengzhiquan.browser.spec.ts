import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { BATTLE_LIMIT_MS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

async function choose(page: Page, id: string) {
  await page.locator(`#catalog-tabs [data-category="pets"]`).click();
  await page.locator(`[data-candidate="${id}"]`).click();
  if (id === 'chengzhiquan') {
    for (const phrase of ['一天八顿', '那我不玩了', '我跟你爆了', '双方定身 3 秒', '汲取 2 生命']) await expect(page.locator('#detail-description')).toContainText(phrase);
    await expect(page.locator('#detail-stats dd')).toHaveText(['120', '7', '240 / 秒']);
  }
  await page.locator('#equip-candidate').click();
  if (id === 'chengzhiquan') await expect(page.locator('#pet-stats dd')).toHaveText(['固有效果自动生效', '120', '7', '240 / 秒']);
}

test('Cheng runs on production with synchronized mobile, spectator, bilateral binding and refresh recovery', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(), guest = await mobile.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  let viewer: Room | undefined;
  const snapshots: RoomSnapshot[] = [];
  const events = new Map<number, BattleEvent>();
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('程执权');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    await choose(host, 'chengzhiquan');
    await expect(host.locator('#selected-pet-name')).toHaveText('程执权');
    await host.screenshot({ path: testInfo.outputPath('cheng-selection-desktop.png'), fullPage: true });
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill('兄弟');
    await guest.getByRole('button', { name: '加入', exact: true }).click();
    await expect(guest.locator('#room')).toBeVisible();
    // The guest keeps the default Hutao ball, making this a full character matchup.
    viewer = await new Client(baseURL!).joinById(roomId, { name: '验证观众' });
    viewer.onMessage('snapshot', (state: RoomSnapshot) => { snapshots.push(state); for (const event of state.events) events.set(event.seq, event); });
    viewer.onMessage('clock', () => {}); viewer.onMessage('error', value => errors.push(JSON.stringify(value))); viewer.send('sync');
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await expect.poll(() => snapshots.find(state => state.battle)?.battle?.fighters.find(fighter => fighter.petId === 'chengzhiquan')?.maxHp).toBe(120);
    await expect.poll(() => [...events.values()].some(e => e.kind === 'bind'), { timeout: BATTLE_LIMIT_MS }).toBe(true);
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('cheng-bound-desktop.png') });
    await guest.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('cheng-bound-mobile.png') });
    const first = snapshots.find(state => state.battle?.fighters.every(fighter => fighter.boundUntilMs > state.battle!.elapsedMs))!;
    expect(first).toBeTruthy();
    const until = first.battle!.fighters[0].boundUntilMs;
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-0 .fighter-pet')).toHaveText('程执权');
    await expect.poll(() => (snapshots.at(-1)?.battle?.elapsedMs ?? 0) >= until).toBe(true);
    const bound = snapshots.filter(state => state.battle && state.battle.elapsedMs >= first.battle!.elapsedMs && state.battle.elapsedMs < until);
    expect(bound.length).toBeGreaterThan(3);
    for (const state of bound) expect(state.battle!.fighters.map(f => [f.x, f.y])).toEqual(first.battle!.fighters.map(f => [f.x, f.y]));
    const firstTicks = [...events.values()].filter(e => e.kind === 'drain' && e.timeMs <= until);
    expect(firstTicks).toHaveLength(3);
    expect(firstTicks.map(e => e.timeMs)).toEqual([until - 2000, until - 1000, until]);
    expect(firstTicks.every(e => e.amount >= 0 && e.amount <= 7)).toBe(true); // Jackpot can add damage or grant immunity.
    expect([...events.values()].some(e => e.kind === 'heal' && e.effect === 'meal')).toBe(true);
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.dice-overlay, .dice-card')).toHaveCount(0);
    }
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'finished', { timeout: BATTLE_LIMIT_MS });
    await expect(guest.locator('#room')).toHaveAttribute('data-phase', 'finished');
    await expect.poll(() => snapshots.at(-1)?.phase).toBe('finished');
    expect(await guest.locator('#result-stats').textContent()).toBe(await host.locator('#result-stats').textContent());
    expect(await guest.locator('#battle-log li').allTextContents()).toEqual(await host.locator('#battle-log li').allTextContents());
    const result = snapshots.at(-1)!.battle!;
    expect(result.fighters.every(f => f.boundUntilMs === 0 && !f.cheng?.grapple && !f.cheng?.dash)).toBe(true);
    for (const fighter of result.fighters) {
      const all = [...events.values()];
      expect(fighter.damageDealt).toBe(all.filter(e => e.sourceId === fighter.id && ['attack', 'slap', 'drain'].includes(e.kind)).reduce((sum, e) => sum + e.amount, 0));
      expect(fighter.healing).toBe(all.filter(e => e.sourceId === fighter.id && e.kind === 'heal').reduce((sum, e) => sum + e.amount, 0));
    }
    await testInfo.attach('authoritative-result', { body: JSON.stringify({ battle: result, events: [...events.values()] }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await viewer?.leave().catch(() => {}); await desktop.close(); await mobile.close(); }
});

type Point = { x: number; y: number };
type Frame = { balls: Point[]; bowls: Point[]; shields: Point[]; labels: { text: string; x: number; y: number; width: number }[]; links: Point[] };
type FixtureWindow = Window & { chengFixture: { frame: Frame; renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void } } };

test('mirror Cheng players keep independent skill states through world effects and a mobile reload', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(), guest = await mobile.newPage();
  let viewer: Room | undefined;
  const snapshots: RoomSnapshot[] = [], events = new Map<number, BattleEvent>();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('程执权甲');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    await choose(host, 'chengzhiquan');
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill('程执权乙');
    await guest.getByRole('button', { name: '加入', exact: true }).click();
    await expect(guest.locator('#room')).toBeVisible(); await choose(guest, 'chengzhiquan');
    viewer = await new Client(baseURL!).joinById(roomId, { name: '镜像观众' });
    viewer.onMessage('snapshot', (state: RoomSnapshot) => { snapshots.push(state); for (const event of state.events) events.set(event.seq, event); });
    viewer.onMessage('clock', () => {}); viewer.onMessage('error', value => errors.push(JSON.stringify(value))); viewer.send('sync');
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect.poll(() => [...events.values()].some(e => e.kind === 'bind'), { timeout: BATTLE_LIMIT_MS }).toBe(true);
    const first = snapshots.find(state => state.battle?.fighters.some(f => f.cheng?.grapple))!;
    expect(first).toBeTruthy();
    const grapplers = first.battle!.fighters.filter(f => f.cheng?.grapple);
    for (const fighter of grapplers) expect(fighter.cheng!.grapple!.targetId).toBe(first.battle!.fighters.find(other => other.id !== fighter.id)!.id);
    const until = first.battle!.fighters[0].boundUntilMs;
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-0 .fighter-pet')).toHaveText('程执权');
    await expect(guest.locator('#player-1 .fighter-pet')).toHaveText('程执权');
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('cheng-mirror-desktop.png') });
    await guest.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('cheng-mirror-mobile.png') });
    await expect.poll(() => (snapshots.at(-1)?.battle?.elapsedMs ?? 0) >= until).toBe(true);
    const ticks = [...events.values()].filter(e => e.kind === 'drain' && e.timeMs <= until);
    expect(ticks).toHaveLength(grapplers.length * 3);
    for (const fighter of grapplers) {
      const own = ticks.filter(e => e.sourceId === fighter.id);
      expect(own).toHaveLength(3);
      expect(own.map(e => e.timeMs)).toEqual([until - 2000, until - 1000, until]);
      expect(own.every(e => e.amount >= 0 && e.amount <= 7)).toBe(true);
      expect(own.every(e => e.targetId !== fighter.id)).toBe(true);
    }
    for (const state of snapshots.filter(state => state.battle && state.battle.elapsedMs >= first.battle!.elapsedMs && state.battle.elapsedMs < until)) expect(state.battle!.fighters.map(f => [f.x, f.y])).toEqual(first.battle!.fighters.map(f => [f.x, f.y]));
    await expect.poll(() => [...events.values()].some(event => event.kind === 'world'), { timeout: 70_000 }).toBe(true);
    const ruleId = first.battle!.world.id;
    expect(snapshots.filter(state => state.battle).every(state => state.battle!.world.id === ruleId)).toBe(true);
    await expect(guest.locator('#world-rule-name')).toHaveText((await host.locator('#world-rule-name').textContent())!);
    await host.locator('.arena-panel').screenshot({ path: testInfo.outputPath('world-rule-desktop.png') });
    await guest.locator('.arena-panel').screenshot({ path: testInfo.outputPath('world-rule-mobile.png') });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach('mirror-binding', { body: JSON.stringify({ first: first.battle, ticks }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await viewer?.leave().catch(() => {}); await desktop.close(); await mobile.close(); }
});

test('Cheng art and effects follow interpolation, stay readable at corners, respect reduced motion and expire', async ({ page, baseURL }, testInfo) => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected renderer build');
  await page.route('**/cheng-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: output.output.find(chunk => chunk.type === 'chunk')!.code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), petId: 'chengzhiquan' as const } }));
  const battle = new BattleSimulator(players, 3).snapshot(); battle.elapsedMs = 10_000;
  const [a, b] = battle.fighters;
  Object.assign(a, { hp: 26, x: 100, y: 160, vx: 0, vy: 0, boundUntilMs: 13_000 });
  Object.assign(b, { hp: 70, x: 166, y: 160, vx: 0, vy: 0, boundUntilMs: 13_000 });
  Object.assign(a.cheng!, { survivalUsed: true, invulnerableUntilMs: 15_000, mealStartedAtMs: 10_000, grappleUnlocked: true, grapple: { targetId: 'b', startedAtMs: 10_000, ticks: 0 } });
  const snapshot: RoomSnapshot = { roomId: 'cheng', matchId: 'cheng', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  const event = (kind: BattleEvent['kind'], amount = 0): BattleEvent => ({ seq: 1, timeMs: battle.elapsedMs, kind, sourceId: 'a', targetId: kind === 'drain' || kind === 'bind' || kind === 'dash' ? 'b' : 'a', amount, x: 100, y: 160, text: kind });
  await page.evaluate(async () => {
    const url = '/cheng-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'cheng-fixture';
    canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:min(420px,calc(100vw - 20px));height:min(420px,calc(100vw - 20px));z-index:100'; document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const fixture: FixtureWindow['chengFixture'] = { frame: { balls: [], bowls: [], shields: [], labels: [], links: [] }, renderer: new ArenaRenderer(canvas) };
    (window as unknown as FixtureWindow).chengFixture = fixture;
    const fillRect = ctx.fillRect.bind(ctx); ctx.fillRect = (x, y, w, h) => { if (x === 0 && y === 0 && w === 420 && h === 420) fixture.frame = { balls: [], bowls: [], shields: [], labels: [], links: [] }; fillRect(x, y, w, h); };
    const arc = ctx.arc.bind(ctx); ctx.arc = (x, y, r, start, end, ccw) => { if (r === 32) fixture.frame.balls.push({ x, y }); if (r === 37) fixture.frame.shields.push({ x, y }); arc(x, y, r, start, end, ccw); };
    const fillText = ctx.fillText.bind(ctx); ctx.fillText = (text, x, y, width) => { fixture.frame.labels.push({ text, x, y, width: ctx.measureText(text).width }); if (width === undefined) fillText(text, x, y); else fillText(text, x, y, width); };
    const fill = ctx.fill.bind(ctx); ctx.fill = ((...args: unknown[]) => { if (ctx.fillStyle === '#e78354') { const transform = ctx.getTransform(), scale = canvas.width / 420; fixture.frame.bowls.push({ x: transform.e / scale, y: transform.f / scale }); } Reflect.apply(fill, ctx, args); }) as CanvasRenderingContext2D['fill'];
    const curve = ctx.quadraticCurveTo.bind(ctx); ctx.quadraticCurveTo = (cx, cy, x, y) => { if (ctx.strokeStyle === '#62412d') fixture.frame.links.push({ x, y }); curve(cx, cy, x, y); };
  });
  const update = async (events: BattleEvent[] = [], reset = false) => page.evaluate(({ state, events, reset }) => (window as unknown as FixtureWindow).chengFixture.renderer.update(state, events, reset), { state: snapshot, events, reset });
  const frame = () => page.evaluate(() => (window as unknown as FixtureWindow).chengFixture.frame);
  for (const motion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    Object.assign(a, { x: 100, y: 160 }); Object.assign(b, { x: 166, y: 160 }); battle.elapsedMs = 10_000;
    await update([event('bind'), event('survive'), event('drain', 2), event('heal', 2)], true); await page.clock.runFor(40);
    const before = await frame(); expect(before.bowls).toHaveLength(1); expect(before.shields.length).toBeGreaterThan(0);
    Object.assign(a, { x: 240, y: 260 }); Object.assign(b, { x: 306, y: 260 }); battle.elapsedMs += 200;
    await update(); await page.clock.runFor(100);
    const after = await frame();
    expect(after.balls[0].x).not.toBe(240); expect(after.balls[0].x).not.toBe(before.balls[0].x);
    expect(after.bowls[0].x - before.bowls[0].x).toBeCloseTo(after.balls[0].x - before.balls[0].x, 4);
    expect(after.shields[0].x).toBeCloseTo(after.balls[0].x, 4);
    expect(after.links).toHaveLength(2);
    expect(after.links[0].x).toBeCloseTo(after.balls[1].x, 4);
    for (const [x, y, targetX] of [[32, 32, 98], [388, 32, 322], [32, 388, 98], [388, 388, 322]]) {
      Object.assign(a, { x, y }); Object.assign(b, { x: targetX, y }); battle.elapsedMs += 100;
      await update([event('bind'), event('survive'), event('dash'), event('immune')], true); await page.clock.runFor(120);
      const corner = await frame();
      for (const label of corner.labels) { expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420); expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412); }
      expect(corner.bowls[0].x).toBeGreaterThanOrEqual(22); expect(corner.bowls[0].x).toBeLessThanOrEqual(398);
    }
  }
  Object.assign(a, { x: 160, y: 220 }); Object.assign(b, { x: 226, y: 220 }); battle.elapsedMs = 10_000;
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await update([event('bind')], true); await page.clock.runFor(120);
  await page.locator('#cheng-fixture').screenshot({ path: testInfo.outputPath('cheng-all-effects-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(120); await page.locator('#cheng-fixture').screenshot({ path: testInfo.outputPath('cheng-all-effects-mobile.png') });
  await update([], true); await page.clock.runFor(120);
  const staticFrame = await page.locator('#cheng-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.clock.runFor(80); expect(await page.locator('#cheng-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()) === staticFrame).toBe(true);
  // Current snapshot after expiry / reconnect has no phantom bowl, shield or link.
  battle.elapsedMs = 16_000; a.boundUntilMs = b.boundUntilMs = 0;
  Object.assign(a.cheng!, { invulnerableUntilMs: 0, mealStartedAtMs: null, grapple: null, dash: null });
  await update([], true); await page.clock.runFor(120);
  const expired = await frame(); expect(expired.bowls).toHaveLength(0); expect(expired.shields).toHaveLength(0); expect(expired.links).toHaveLength(0);
  expect(expired.labels.some(label => /束缚|无敌|兄弟|不玩了/.test(label.text))).toBe(false);
  await page.evaluate(() => (window as unknown as FixtureWindow).chengFixture.renderer.destroy());
});
