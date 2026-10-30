import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { BATTLE_LIMIT_MS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

async function choose(page: Page) {
  await page.locator('#catalog-tabs [data-category="pets"]').click();
  await page.locator('[data-candidate="liangchushuo"]').click();
  for (const phrase of ['礼尚往来', '减少 4', '增加 6', '每次碰撞交替']) await expect(page.locator('#detail-description')).toContainText(phrase);
  await expect(page.locator('#detail-stats dd')).toHaveText(['100', '10', '300 / 秒']);
  await page.locator('#equip-candidate').click();
  await expect(page.locator('#selected-pet-name')).toHaveText('梁楚烁');
}

for (const mirror of [false, true]) test(`Liang production ${mirror ? 'mirror' : 'Hutao matchup'} synchronizes desktop, mobile, spectator and reload through settlement`, async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(), guest = await mobile.newPage();
  const errors: string[] = [], snapshots: RoomSnapshot[] = [], events = new Map<number, BattleEvent>();
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  let viewer: Room | undefined;
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('梁楚烁');
    await host.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!;
    await choose(host);
    await host.screenshot({ path: testInfo.outputPath('liang-selection-desktop.png'), fullPage: true });
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill(mirror ? '梁楚烁乙' : '回礼对象');
    await guest.getByRole('button', { name: '加入', exact: true }).click(); await expect(guest.locator('#room')).toBeVisible();
    if (mirror) await choose(guest);
    viewer = await new Client(baseURL!).joinById(roomId, { name: '礼数观众' });
    viewer.onMessage('snapshot', (state: RoomSnapshot) => { snapshots.push(state); for (const event of state.events) events.set(event.seq, event); });
    viewer.onMessage('clock', () => {}); viewer.onMessage('error', value => errors.push(JSON.stringify(value))); viewer.send('sync');
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'battle');
    await expect.poll(() => [...events.values()].some(e => e.kind === 'courtesy' && e.effect === 'liang-return'), { timeout: BATTLE_LIMIT_MS }).toBe(true);
    await host.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('liang-battle-desktop.png') });
    await guest.locator('.canvas-wrap').screenshot({ path: testInfo.outputPath('liang-battle-mobile.png') });
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-0 .fighter-pet')).toHaveText('梁楚烁');
    await expect(guest.locator('#player-0 .fighter-loadout')).toContainText('礼尚往来');
    await expect(host.locator('#room')).toHaveAttribute('data-phase', 'finished', { timeout: BATTLE_LIMIT_MS });
    await expect(guest.locator('#room')).toHaveAttribute('data-phase', 'finished');
    await expect.poll(() => snapshots.at(-1)?.phase).toBe('finished');
    expect(await host.locator('#result-stats').textContent()).toBe(await guest.locator('#result-stats').textContent());
    expect(await host.locator('#battle-log li').allTextContents()).toEqual(await guest.locator('#battle-log li').allTextContents());
    const result = snapshots.at(-1)!.battle!, all = [...events.values()];
    for (const fighter of result.fighters) {
      if (!fighter.liang) continue;
      const contacts = all.filter(e => e.kind === 'courtesy' && e.amount === 0 && e.sourceId === fighter.id);
      expect(contacts.length).toBeGreaterThanOrEqual(2);
      expect(fighter.hits).toBe(contacts.length);
      contacts.forEach((event, i) => {
        expect(event.effect).toBe(i % 2 ? 'liang-return' : 'liang-yield');
        expect(event.text).toMatch(i % 2 ? /必须的/ : /没毛|那确实/);
      });
      expect(fighter.liang.phase).toBe(contacts.length % 2 ? 'return' : 'yield');
      expect(fighter.damageDealt).toBe(all.filter(e => e.kind === 'attack' && e.sourceId === fighter.id).reduce((sum, e) => sum + e.amount, 0));
    }
    for (const state of snapshots) for (const fighter of state.battle?.fighters ?? []) {
      if (!fighter.liang?.contact) continue;
      expect(fighter.liang.phase).not.toBe(fighter.liang.contact.phase);
      expect(fighter.liang.contact.timeMs).toBeLessThanOrEqual(state.battle!.elapsedMs);
    }
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.dice-overlay, .dice-card')).toHaveCount(0);
    }
    await testInfo.attach('authoritative-result', { body: JSON.stringify({ battle: result, events: all }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await viewer?.leave().catch(() => {}); await desktop.close(); await mobile.close(); }
});

type Point = { x: number; y: number };
type Frame = { balls: Point[]; arcs: Point[]; labels: { text: string; x: number; y: number; width: number }[] };
type FixtureWindow = Window & { liangFixture: { frame: Frame; renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void } } };

test('Liang actual canvas follows interpolated balls, shows all quotes, handles corners, reduced motion and reconnect expiry', async ({ page, baseURL }, testInfo) => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected renderer build');
  await page.route('**/liang-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: output.output.find(chunk => chunk.type === 'chunk')!.code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), petId: 'liangchushuo' as const } }));
  const battle = new BattleSimulator(players, 3).snapshot(); battle.elapsedMs = 1000;
  const [a, b] = battle.fighters;
  Object.assign(a, { hp: 94, x: 100, y: 180, vx: 0, vy: 0 }); Object.assign(b, { hp: 84, x: 300, y: 300, vx: 0, vy: 0 });
  a.liang = { phase: 'return', contact: { phase: 'yield', timeMs: 1000, quote: '没毛' } };
  b.liang = { phase: 'yield', contact: { phase: 'return', timeMs: 1000, quote: '必须的' } };
  const snapshot: RoomSnapshot = { roomId: 'liang', matchId: 'liang', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  const events: BattleEvent[] = [
    { seq: 1, timeMs: 1000, sourceId: 'b', targetId: 'a', amount: 12, text: '回礼', kind: 'attack', effect: 'liang-return', x: a.x, y: a.y },
    { seq: 2, timeMs: 1000, sourceId: 'a', targetId: 'a', amount: 4, text: '礼让减免', kind: 'courtesy', effect: 'liang-yield', x: a.x, y: a.y },
    { seq: 3, timeMs: 1000, sourceId: 'b', targetId: 'a', amount: 3, text: '独立道具伤害', kind: 'combo', effect: 'staff', x: a.x, y: a.y },
  ];
  await page.evaluate(async () => {
    const url = '/liang-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'liang-fixture';
    canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:min(420px,calc(100vw - 20px));height:min(420px,calc(100vw - 20px));z-index:100'; document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const fixture: FixtureWindow['liangFixture'] = { frame: { balls: [], arcs: [], labels: [] }, renderer: new ArenaRenderer(canvas) };
    (window as unknown as FixtureWindow).liangFixture = fixture;
    const fillRect = ctx.fillRect.bind(ctx); ctx.fillRect = (x, y, w, h) => { if (x === 0 && y === 0 && w === 420 && h === 420) fixture.frame = { balls: [], arcs: [], labels: [] }; fillRect(x, y, w, h); };
    const arc = ctx.arc.bind(ctx); ctx.arc = (x, y, r, start, end, ccw) => {
      if (r === 32) fixture.frame.balls.push({ x, y });
      if (r === 36) { const t = ctx.getTransform(), scale = canvas.width / 420; fixture.frame.arcs.push({ x: t.e / scale, y: t.f / scale }); }
      arc(x, y, r, start, end, ccw);
    };
    const fillText = ctx.fillText.bind(ctx); ctx.fillText = (text, x, y, width) => { fixture.frame.labels.push({ text, x, y, width: ctx.measureText(text).width }); if (width === undefined) fillText(text, x, y); else fillText(text, x, y, width); };
  });
  const update = (ev: BattleEvent[] = [], reset = false) => page.evaluate(({ state, ev, reset }) => (window as unknown as FixtureWindow).liangFixture.renderer.update(state, ev, reset), { state: snapshot, ev, reset });
  const frame = () => page.evaluate(() => (window as unknown as FixtureWindow).liangFixture.frame);
  for (const motion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    Object.assign(a, { x: 100, y: 180 }); Object.assign(b, { x: 300, y: 300 }); battle.elapsedMs = 1000;
    a.liang!.contact!.timeMs = b.liang!.contact!.timeMs = 1000;
    a.liang!.contact!.quote = '没毛';
    await update(events, true); await page.clock.runFor(40);
    const before = await frame(); expect(before.arcs).toHaveLength(1);
    expect(before.labels.map(l => l.text)).toEqual(expect.arrayContaining(['没毛', '必须的', '礼让 −4', '回礼 −12', '−3']));
    Object.assign(a, { x: 240, y: 130 }); battle.elapsedMs += 200;
    await update(); await page.clock.runFor(80);
    const after = await frame();
    expect(after.balls[0].x).not.toBe(240); expect(after.balls[0].x).not.toBe(before.balls[0].x);
    expect(after.arcs[0].x).toBeCloseTo(after.balls[0].x, 4);
    for (const label of ['没毛', '礼让 −4', '回礼 −12']) expect(after.labels.find(l => l.text === label)!.x).toBeCloseTo(after.balls[0].x, 4);
    for (const [x, y, targetX] of [[32, 32, 98], [388, 32, 322], [32, 388, 98], [388, 388, 322]]) {
      Object.assign(a, { x, y }); Object.assign(b, { x: targetX, y }); battle.elapsedMs += 100;
      a.liang!.contact!.timeMs = b.liang!.contact!.timeMs = battle.elapsedMs;
      a.liang!.contact!.quote = '那确实';
      await update(events, true); await page.clock.runFor(40);
      const corner = await frame(); expect(corner.labels.some(l => l.text === '那确实')).toBe(true);
      for (const label of corner.labels) { expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420); expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412); }
    }
  }
  Object.assign(a, { x: 140, y: 185 }); Object.assign(b, { x: 280, y: 235 });
  a.liang!.contact!.quote = '没毛'; a.liang!.contact!.timeMs = b.liang!.contact!.timeMs = battle.elapsedMs;
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await update(events, true); await page.clock.runFor(40);
  await page.locator('#liang-fixture').screenshot({ path: testInfo.outputPath('liang-art-effects-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(40);
  await page.locator('#liang-fixture').screenshot({ path: testInfo.outputPath('liang-art-effects-mobile.png') });
  // A refresh 700ms after impact keeps only 100ms of speech, without damage replay.
  battle.elapsedMs = a.liang!.contact!.timeMs + 700;
  await update([], true); await page.clock.runFor(40);
  expect((await frame()).labels.some(l => l.text === '没毛')).toBe(true);
  battle.elapsedMs += 120; await update([], true); await page.clock.runFor(40);
  expect((await frame()).labels.some(l => /没毛|那确实|必须的|礼让|回礼/.test(l.text))).toBe(false);
  expect((await frame()).arcs).toHaveLength(0);
  snapshot.phase = 'finished'; battle.finished = true; await update([], true); await page.clock.runFor(900);
  const staticImage = await page.locator('#liang-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.clock.runFor(100); expect(await page.locator('#liang-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(staticImage);
  await page.evaluate(() => (window as unknown as FixtureWindow).liangFixture.renderer.destroy());
});
