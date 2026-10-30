import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { createDefaultLoadout } from '../shared/catalog.js';
import { WORLD_EFFECTS } from '../shared/world-effects.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

type Frame = { balls: { x: number; y: number }[]; labels: { text: string; x: number; y: number; width: number }[] };
type FixtureWindow = Window & { worldFixture: { frame: Frame; renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void } } };

test('world animations, falling markers, healing, prizes and status rings remain readable on desktop/mobile and reduced motion', async ({ page, baseURL }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected renderer build');
  await page.route('**/world-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: output.output.find(chunk => chunk.type === 'chunk')!.code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: createDefaultLoadout() }));
  const battle = new BattleSimulator(players, 3).snapshot();
  const snapshot: RoomSnapshot = { roomId: 'world', matchId: 'world', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  const [a, b] = battle.fighters;
  Object.assign(a, { x: 100, y: 145, vx: 0, vy: 0, hp: 20 }); Object.assign(b, { x: 320, y: 300, vx: 0, vy: 0, hp: 80 });
  await page.evaluate(async () => {
    const url = '/world-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'world-fixture';
    canvas.style.cssText = 'position:fixed;left:12px;top:12px;width:min(420px,calc(100vw - 24px));aspect-ratio:1;z-index:100'; document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const fixture: FixtureWindow['worldFixture'] = { frame: { balls: [], labels: [] }, renderer: new ArenaRenderer(canvas) };
    (window as unknown as FixtureWindow).worldFixture = fixture;
    const fillRect = ctx.fillRect.bind(ctx); ctx.fillRect = (x, y, w, h) => { if (x === 0 && y === 0 && w === 420 && h === 420) fixture.frame = { balls: [], labels: [] }; fillRect(x, y, w, h); };
    const arc = ctx.arc.bind(ctx); ctx.arc = (x, y, r, start, end, ccw) => { if (r === 32) fixture.frame.balls.push({ x, y }); arc(x, y, r, start, end, ccw); };
    const fillText = ctx.fillText.bind(ctx); ctx.fillText = (text, x, y, width) => { fixture.frame.labels.push({ text, x, y, width: ctx.measureText(text).width }); if (width === undefined) fillText(text, x, y); else fillText(text, x, y, width); };
  });
  const update = (events: BattleEvent[] = [], reset = false) => page.evaluate(({ state, events, reset }) => (window as unknown as FixtureWindow).worldFixture.renderer.update(state, events, reset), { state: snapshot, events, reset });
  const frame = () => page.evaluate(() => (window as unknown as FixtureWindow).worldFixture.frame);
  const pixels = () => page.locator('#world-fixture').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  for (const [width, height, motion] of [[1440, 1000, 'no-preference'], [390, 844, 'reduce']] as const) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: motion });
    for (const effect of WORLD_EFFECTS) {
      Object.assign(battle.world, { id: effect.id, nextAtMs: 70_000, scaleRemainingMs: 0, debris: [], prize: null, pulseAtMs: null });
      a.world = { stunnedUntilMs: 0, invulnerableUntilMs: 0, damageBonus: 0 }; battle.elapsedMs = 35_000;
      if (effect.id === 'divine-scale') battle.world.scaleRemainingMs = 2000;
      if (effect.id === 'falling-junk') battle.world.debris = [[40, 40], [380, 40], [210, 210], [40, 380], [380, 380]].map(([x, y], index) => ({ id: index, x, y, landsAtMs: 35_700 }));
      if (effect.id === 'green-meadow') battle.world.pulseAtMs = 35_000;
      if (effect.id === 'lucky-jackpot') battle.world.prize = { x: 210, y: 210, spawnedAtMs: 35_000, expiresAtMs: 40_000 };
      await update([], true); await page.clock.runFor(40);
      if (effect.id === 'divine-scale') {
        const before = await frame(), first = await pixels(); await page.clock.runFor(80);
        expect((await frame()).balls).toEqual(before.balls);
        if (motion === 'no-preference') expect(await pixels()).not.toBe(first);
        expect((await frame()).labels.some(label => label.text.includes('神之天平'))).toBe(true);
      }
      if (effect.id === 'falling-junk') expect((await frame()).labels.filter(label => label.text === '落点')).toHaveLength(5);
      if (effect.id === 'lucky-jackpot') expect((await frame()).labels.some(label => label.text.includes('大奖 5s'))).toBe(true);
      for (const label of (await frame()).labels) {
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420);
        expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412);
      }
      await page.locator('#world-fixture').screenshot({ path: testInfo.outputPath(`${effect.id}-${width}.png`) });
    }
    battle.world.prize = null; a.world = { stunnedUntilMs: 40_000, invulnerableUntilMs: 55_000, damageBonus: 0 };
    await update([], true); await page.clock.runFor(40); const before = await frame();
    expect(before.labels.some(label => label.text.includes('眩晕'))).toBe(true); expect(before.labels.some(label => label.text.includes('无敌'))).toBe(true);
    a.x = 230; battle.elapsedMs += 200;
    await update(); await page.clock.runFor(100); const after = await frame();
    const ball = after.balls[0]; expect(ball.x).toBeGreaterThan(100); expect(ball.x).toBeLessThan(230);
    for (const label of after.labels.filter(label => /眩晕|无敌/.test(label.text))) expect(label.x).toBeCloseTo(ball.x, 6);
    for (const [x, y] of [[32, 32], [388, 32], [32, 388], [388, 388]]) {
      Object.assign(a, { x, y }); battle.elapsedMs += 100;
      const event: BattleEvent = { seq: 1, timeMs: battle.elapsedMs, kind: 'reward', effect: 'lucky-jackpot', sourceId: 'a', targetId: 'a', amount: 0, text: 'a：b 领取幸运大奖：所有伤害+5，持续至本局结束', x, y };
      await update([event], true); await page.clock.runFor(120);
      const labels = (await frame()).labels;
      expect(labels.some(label => label.text === '所有伤害+5')).toBe(true);
      for (const label of labels) {
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420);
        expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412);
      }
    }
    a.world = { stunnedUntilMs: 0, invulnerableUntilMs: 0, damageBonus: 5 }; battle.world.prize = null;
    await update([], true); await page.clock.runFor(120); expect((await frame()).labels.some(label => label.text === '伤害 +5')).toBe(true);
    snapshot.phase = 'finished'; battle.finished = true;
    await update([], true); await page.clock.runFor(120);
    expect((await frame()).labels.some(label => /无敌|眩晕|伤害|大奖/.test(label.text))).toBe(false);
    snapshot.phase = 'battle'; battle.finished = false; Object.assign(a, { x: 100, y: 145 });
  }
  expect(errors).toEqual([]); await page.evaluate(() => (window as unknown as FixtureWindow).worldFixture.renderer.destroy());
});
