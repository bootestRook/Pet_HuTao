import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { readConfig, originAllowed } from '../server/config.js';
import { createDefaultLoadout, ARENA_SIZE, BATTLE_LIMIT_MS, ITEMS } from '../shared/catalog.js';
import type { RoomSnapshot } from '../shared/types.js';

let server: ChildProcess;
let endpoint: string;
let logs = '';
const clients: Room[] = [];
async function waitFor<T>(read: () => T | undefined | false, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for state. Server: ${logs.slice(-2000)}`);
}
function observe(room: Room) {
  clients.push(room);
  const observed = { state: undefined as RoomSnapshot | undefined, errors: [] as string[], snapshots: [] as RoomSnapshot[] };
  room.onMessage('snapshot', (value: RoomSnapshot) => { observed.state = value; observed.snapshots.push(value); });
  room.onMessage('error', (value: {message: string}) => observed.errors.push(value.message));
  room.onMessage('clock', () => {});
  room.send('sync');
  return observed;
}
before(async () => {
  const probe = createServer();
  await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as {port: number}).port;
  await new Promise<void>((r, reject) => probe.close(e => e ? reject(e) : r()));
  endpoint = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--dev'], { cwd: process.cwd(), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: '', ALLOWED_ORIGINS: '' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  server.stdout?.on('data', c => { logs += c.toString(); });
  server.stderr?.on('data', c => { logs += c.toString(); });
  await waitFor(() => logs.includes('Pet Arena ready'), 15000);
});
after(async () => {
  for (const client of clients) await client.leave().catch(() => {});
  server?.kill();
});

test('same server exposes health, runtime addresses and rejects cross-origin matchmaking', async () => {
  const health = await fetch(`${endpoint}/api/health`).then(r => r.json());
  assert.equal(health.app, 'pet-arena');
  assert.equal(health.ok, true);
  const config = await fetch(`${endpoint}/api/config`).then(r => r.json());
  assert.ok(Array.isArray(config.localUrls));
  const blocked = await fetch(`${endpoint}/matchmake/create/duel`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '外部来源' }) });
  assert.equal(blocked.status, 403);
});

test('disconnect before the room JOIN acknowledgement leaves the server healthy', { timeout: 10000 }, async () => {
  const response = await fetch(`${endpoint}/matchmake/create/duel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '握手中断测试' })
  });
  assert.equal(response.status, 200);
  const seat = await response.json() as { processId: string; roomId: string; sessionId: string };
  assert.ok(seat.roomId && seat.sessionId && seat.processId);
  // A browser may disappear after receiving the server handshake but before
  // sending Colyseus's JOIN acknowledgement. Use a raw socket, not the SDK,
  // which would automatically acknowledge the room.
  const socket = new WebSocket(`${endpoint.replace('http:', 'ws:')}/${seat.processId}/${seat.roomId}?sessionId=${encodeURIComponent(seat.sessionId)}`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Handshake probe did not close')); }, 5000);
    socket.addEventListener('message', () => socket.close(), { once: true });
    socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Handshake probe connection failed')); }, { once: true });
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(server.exitCode, null, `early disconnect must not terminate the server: ${logs.slice(-2000)}`);
  const health = await fetch(`${endpoint}/api/health`).then(r => r.json());
  assert.equal(health.ok, true);
  const newRoom = await new Client(endpoint).create('duel', { name: '后续正常玩家' });
  const observed = observe(newRoom);
  await waitFor(() => observed.state?.players.length === 1);
  await newRoom.leave();
});

test('LAN/public configuration and origin policy', () => {
  const config = readConfig({ PORT: '3100', PUBLIC_URL: 'https://pets.example', ALLOWED_ORIGINS: 'https://play.example' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.publicUrl, 'https://pets.example');
  assert.ok(originAllowed('https://pets.example', 'backend:3000', config));
  assert.ok(originAllowed('http://192.168.1.202:3100', '192.168.1.202:3100', config));
  assert.ok(!originAllowed('https://unknown.example', 'backend:3000', config));
  assert.throws(() => readConfig({ PORT: '0' }));
  assert.throws(() => readConfig({ PUBLIC_URL: 'https://pets.example/subpath' }));
});

test('server accepts three playable items, rejects over-limit, duplicate and removed content without losing ready state', { timeout: 15000 }, async () => {
  const room = await new Client(endpoint).create('duel', { name: '搭配校验' });
  const observed = observe(room);
  await waitFor(() => observed.state?.players.length === 1);
  const build = { ...createDefaultLoadout(), petId: 'liangchushuo', items: ITEMS.slice(0, 3).map(item => item.id) };
  room.send('loadout', build);
  await waitFor(() => observed.state?.players[0].loadout.petId === 'liangchushuo');
  assert.deepEqual(observed.state?.players[0].loadout, build);
  room.send('ready', { ready: true });
  await waitFor(() => observed.state?.players[0].ready);
  const invalid = [
    { ...build, items: ITEMS.slice(0, 4).map(item => item.id) },
    { ...build, petId: 'charge' },
    { ...build, petId: 'renew' },
    { ...build, items: ['banana-peel', 'banana-peel'] },
    { ...build, items: ['last-fireworks'] },
    { ...build, items: Array.from({ length: 9 }, () => 'shield') },
    { ...build, items: ['shield', 'shield'] },
    { ...build, items: ['shield'] },
    { ...build, skills: Array.from({ length: 5 }, () => 'removed-skill') },
    { ...build, skills: ['cat-scratch', 'cat-scratch'] },
    { ...build, skills: ['fox-spark'] },
    { ...build, traitId: 'fox-critical' },
    { ...build, traitId: '' },
    { ...build, traitId: ['cat-combo', 'cat-agile'] },
    { ...build, petId: 'cat' },
    { ...build, petId: 'invented-pet' },
    { ...build, weaponId: 'invented-weapon' },
  ];
  for (const [index, payload] of invalid.entries()) {
    room.send('loadout', payload);
    await waitFor(() => observed.errors.length === index + 1);
    assert.deepEqual(observed.state?.players[0].loadout, build);
    assert.equal(observed.state?.players[0].ready, true);
  }
  room.send('loadout', createDefaultLoadout());
  await waitFor(() => observed.state?.players[0].loadout.petId === 'hutao');
  assert.equal(observed.state?.players[0].ready, false);
  await room.leave();
});

test('two clients: choices, validation, ready, timed combat, refresh recovery, same result and rematch after departure', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  const sdkA = new Client(endpoint);
  const a = await sdkA.create('duel', { name: '玩家甲' });
  const obsA = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '玩家乙' });
  const obsB = observe(b);
  await waitFor(() => obsA.state?.players.length === 2 && obsB.state?.players.length === 2);
  const spectator = await new Client(endpoint).joinById(a.roomId, { name: '第三人' });
  const spectatorState = observe(spectator);
  await waitFor(() => spectatorState.state?.spectators.some(p => p.id === spectator.sessionId));
  const build = { ...createDefaultLoadout(), petId: 'liangchushuo' };
  a.send('loadout', build);
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.loadout.petId === 'liangchushuo');
  a.send('ready', { ready: true });
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.ready);
  a.send('loadout', build);
  await waitFor(() => obsA.state && !obsA.state.players.find(p => p.id === a.sessionId)?.ready);
  a.send('loadout', { ...build, items: ['fang','fang'] });
  await waitFor(() => obsA.errors.length === 1);
  a.send('loadout', { ...build, attack: 999999 });
  await waitFor(() => obsA.errors.length === 2);
  a.send('ready', { ready: true });
  b.send('ready', { ready: true });
  const countdown = await waitFor(() => obsA.state?.phase === 'countdown' && obsA.state);
  assert.equal(countdown.battle, null, 'battle is not computed before the countdown');
  a.send('loadout', createDefaultLoadout());
  await waitFor(() => obsA.errors.length === 3);
  const start = await waitFor(() => obsA.state?.phase === 'battle' && obsA.state, 6000);
  assert.equal(start.battle?.finished, false);
  const matchId = start.matchId;
  await waitFor(() => (obsB.state?.battle?.elapsedMs ?? 0) > 1400);
  const moving = obsB.state!.battle!;
  assert.ok(moving.fighters.some(fighter => {
    const initial = start.battle!.fighters.find(entry => entry.id === fighter.id)!;
    return fighter.x !== initial.x || fighter.y !== initial.y;
  }), 'clients receive actual changing ball positions');
  for (const fighter of moving.fighters) {
    assert.ok(fighter.x >= fighter.radius && fighter.x <= ARENA_SIZE - fighter.radius);
    assert.ok(fighter.y >= fighter.radius && fighter.y <= ARENA_SIZE - fighter.radius);
    assert.ok(Number.isFinite(fighter.vx) && Number.isFinite(fighter.vy));
  }
  // Simulate a page reload: dispose the old transport and reconnect with the stored token.
  const token = b.reconnectionToken;
  b.reconnection.enabled = false;
  b.connection.close();
  await waitFor(() => obsA.state?.players.some(p => p.id === b.sessionId && !p.connected));
  await new Promise(r => setTimeout(r, 300));
  const restored = await new Client(endpoint).reconnect(token);
  const obsRestored = observe(restored);
  await waitFor(() => obsRestored.state?.matchId === matchId && (obsRestored.state.battle?.elapsedMs ?? 0) > 1400);
  assert.equal(restored.sessionId, b.sessionId);
  const resultA = await waitFor(() => obsA.state?.phase === 'finished' && obsA.state, BATTLE_LIMIT_MS + 5000);
  const resultB = await waitFor(() => obsRestored.state?.phase === 'finished' && obsRestored.state);
  assert.equal(resultA.matchId, resultB.matchId);
  assert.deepEqual(resultA.battle, resultB.battle);
  assert.deepEqual(resultA.events, resultB.events);
  assert.ok((resultA.battle?.elapsedMs ?? 0) > 2000);
  const hp = resultA.battle?.fighters.map(f => f.hp);
  a.send('ready', { ready: true });
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(obsA.state?.battle?.fighters.map(f => f.hp), hp);
  a.send('rematch');
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.rematch);
  assert.equal(obsA.state?.phase, 'finished');
  // A has already requested another round; if B leaves instead of agreeing,
  // the survivor must return to the lobby without an impossible second click.
  await restored.leave();
  await waitFor(() => obsA.state?.phase === 'waiting' && obsA.state.players.length === 1);
  assert.equal(obsA.state?.battle, null);
  assert.ok(obsA.state?.players.every(p => !p.ready && !p.rematch));
  const replacement = await new Client(endpoint).joinById(a.roomId, { name: '替补玩家' });
  const obsReplacement = observe(replacement);
  await waitFor(() => obsA.state?.players.length === 2 && obsReplacement.state?.phase === 'waiting');
  assert.ok(!obsA.state?.players.some(p => p.id === b.sessionId));
  await a.leave(); await replacement.leave(); await spectator.leave();
});

test('disconnect during countdown cancels start; freed waiting seat admits another player', { timeout: 10000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '房主' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '访客' });
  observe(b);
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  await waitFor(() => oa.state?.phase === 'countdown');
  await b.leave();
  await waitFor(() => oa.state?.phase === 'waiting' && oa.state.players.length === 1);
  assert.equal(oa.state?.players[0].ready, false);
  const c = await new Client(endpoint).joinById(a.roomId, { name: '新访客' });
  observe(c);
  await waitFor(() => oa.state?.players.length === 2);
  await a.leave(); await c.leave();
});

test('join order fills two combat seats then eight spectator seats; concurrent joins and seat claims never overfill', { timeout: 15000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '先到玩家' });
  const oa = observe(a);
  await waitFor(() => oa.state?.players[0]?.id === a.sessionId);
  const others = await Promise.all(Array.from({ length: 9 }, async (_, i) => {
    const room = await new Client(endpoint).joinById(a.roomId, { name: `访客${i}` });
    return { room, observed: observe(room) };
  }));
  await waitFor(() => oa.state?.players.length === 2 && oa.state.spectators.length === 8);
  assert.equal(oa.state?.availablePlayerSeats, 0);
  await assert.rejects(() => new Client(endpoint).joinById(a.roomId, { name: '第十一人' }));
  a.send('ready', { ready: true });
  await waitFor(() => oa.state?.players[0].ready);
  a.send('switch-seat', { role: 'spectator' });
  await waitFor(() => oa.errors.length === 1);
  assert.match(oa.errors[0], /观众席已满/);
  assert.equal(oa.state?.players[0].ready, true, 'rejected moves preserve ready state');
  const viewers = others.filter(({ room }) => oa.state!.spectators.some(p => p.id === room.sessionId));
  viewers[0].room.send('loadout', createDefaultLoadout());
  viewers[0].room.send('ready', { ready: true });
  viewers[0].room.send('rematch');
  viewers[0].room.send('switch-seat', { role: 'player' });
  viewers[0].room.send('switch-seat', { role: 'invented' });
  await waitFor(() => viewers[0].observed.errors.length === 5);
  assert.match(viewers[0].observed.errors[3], /对战位已满/);
  await viewers[7].room.leave();
  await waitFor(() => oa.state?.spectators.length === 7);
  a.send('switch-seat', { role: 'spectator' });
  await waitFor(() => oa.state?.players.length === 1 && oa.state.spectators.length === 8);
  assert.ok(oa.state?.players.every(p => !p.ready));
  assert.equal(oa.state?.availablePlayerSeats, 1);
  viewers[0].room.send('switch-seat', { role: 'player' });
  viewers[1].room.send('switch-seat', { role: 'player' });
  await waitFor(() => oa.state?.players.length === 2 && oa.state.spectators.length === 7);
  await waitFor(() => viewers[0].observed.errors.length + viewers[1].observed.errors.length === 6);
  assert.equal(oa.state?.players.filter(p => viewers.slice(0, 2).some(v => v.room.sessionId === p.id)).length, 1);
  for (const { room } of others) await room.leave();
  await a.leave();
});

test('players can spectate and return with their loadout; a spectators-only room admits new combatants first', async () => {
  const a = await new Client(endpoint).create('duel', { name: '创建者' });
  const oa = observe(a);
  a.send('loadout', { ...createDefaultLoadout(), petId: 'liangchushuo' });
  a.send('ready', { ready: true });
  await waitFor(() => oa.state?.players[0]?.ready && oa.state.players[0].loadout.petId === 'liangchushuo');
  const b = await new Client(endpoint).joinById(a.roomId, { name: '对手' });
  observe(b);
  await waitFor(() => oa.state?.players.length === 2);
  assert.equal(oa.state?.players[0].ready, true, 'new arrivals do not cancel an existing player’s preparation');
  a.send('switch-seat', { role: 'spectator' });
  await waitFor(() => oa.state?.spectators[0]?.id === a.sessionId);
  assert.ok(oa.state?.players.every(p => !p.ready && !p.rematch));
  b.send('switch-seat', { role: 'spectator' });
  await waitFor(() => oa.state?.players.length === 0 && oa.state.spectators.length === 2);
  const c = await new Client(endpoint).joinById(a.roomId, { name: '新玩家' });
  observe(c);
  await waitFor(() => oa.state?.players[0]?.id === c.sessionId);
  assert.equal(oa.state?.spectators.length, 2, 'spectators never get promoted automatically');
  a.send('switch-seat', { role: 'player' });
  await waitFor(() => oa.state?.players.some(p => p.id === a.sessionId));
  assert.equal(oa.state?.players.find(p => p.id === a.sessionId)?.loadout.petId, 'liangchushuo');
  assert.ok(oa.state?.players.every(p => !p.ready && !p.rematch));
  await a.leave(); await c.leave();
  await b.leave();
  await assert.rejects(() => new Client(endpoint).joinById(a.roomId, { name: '房间已关闭' }));
});

test('disconnected combatants and spectators retain their actual seats when reconnecting', { timeout: 10000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '玩家' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '掉线玩家' });
  observe(b);
  const bToken = b.reconnectionToken;
  b.reconnection.enabled = false; b.connection.close();
  await waitFor(() => oa.state?.players.some(p => p.id === b.sessionId && !p.connected));
  const viewer = await new Client(endpoint).joinById(a.roomId, { name: '后来观众' });
  const ov = observe(viewer);
  await waitFor(() => ov.state?.spectators.some(p => p.id === viewer.sessionId));
  assert.equal(ov.state?.availablePlayerSeats, 0);
  viewer.send('switch-seat', { role: 'player' });
  await waitFor(() => ov.errors.length === 1);
  const restoredB = await new Client(endpoint).reconnect(bToken);
  observe(restoredB);
  await waitFor(() => oa.state?.players.some(p => p.id === b.sessionId && p.connected));
  const token = viewer.reconnectionToken;
  viewer.reconnection.enabled = false; viewer.connection.close();
  await waitFor(() => oa.state?.spectators.some(p => p.id === viewer.sessionId && !p.connected));
  await restoredB.leave();
  await waitFor(() => oa.state?.availablePlayerSeats === 1);
  const restoredViewer = await new Client(endpoint).reconnect(token);
  const restoredState = observe(restoredViewer);
  await waitFor(() => restoredState.state?.spectators.some(p => p.id === viewer.sessionId && p.connected));
  assert.equal(restoredViewer.sessionId, viewer.sessionId);
  assert.equal(restoredState.state?.availablePlayerSeats, 1, 'reconnection does not change spectator role');
  restoredViewer.send('switch-seat', { role: 'player' });
  await waitFor(() => oa.state?.players.some(p => p.id === viewer.sessionId));
  await a.leave(); await restoredViewer.leave();
});

test('spectators join during countdown and combat, reconnect and share results; finished players can move to the audience', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '红方' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '蓝方' });
  const ob = observe(b);
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  await waitFor(() => oa.state?.phase === 'countdown');
  const viewer = await new Client(endpoint).joinById(a.roomId, { name: '倒计时观众' });
  const ov = observe(viewer);
  await waitFor(() => ov.state?.phase === 'countdown');
  a.send('switch-seat', { role: 'spectator' });
  viewer.send('switch-seat', { role: 'player' });
  await waitFor(() => oa.errors.length === 1 && ov.errors.length === 1);
  const token = viewer.reconnectionToken;
  viewer.reconnection.enabled = false; viewer.connection.close();
  await waitFor(() => oa.state?.spectators[0]?.connected === false);
  assert.equal(oa.state?.phase, 'countdown', 'audience disconnection must not cancel countdown');
  const restored = await new Client(endpoint).reconnect(token);
  const or = observe(restored);
  const underway = await waitFor(() => oa.state?.phase === 'battle' && oa.state, 6000);
  const late = await new Client(endpoint).joinById(a.roomId, { name: '中途观众' });
  const ol = observe(late);
  await waitFor(() => ol.state?.matchId === underway.matchId && ol.state.phase === 'battle');
  assert.equal(ol.state?.spectators.length, 2);
  assert.deepEqual(ol.state?.battle?.fighters.map(p => p.id), underway.battle?.fighters.map(p => p.id));
  assert.equal(ol.state?.battle?.world.id, underway.battle?.world.id, 'late spectators receive the same per-match rule');
  assert.equal(or.state?.battle?.world.id, underway.battle?.world.id, 'reconnecting spectators do not reroll the rule');
  a.send('switch-seat', { role: 'spectator' });
  late.send('switch-seat', { role: 'player' });
  await waitFor(() => oa.errors.length === 2 && ol.errors.length === 1);
  const result = await waitFor(() => or.state?.phase === 'finished' && or.state, BATTLE_LIMIT_MS + 5000);
  await waitFor(() => oa.state?.phase === 'finished' && ob.state?.phase === 'finished' && ol.state?.phase === 'finished');
  assert.deepEqual(result.battle, oa.state?.battle);
  assert.deepEqual(result.battle, ob.state?.battle);
  assert.deepEqual(result.events, ol.state?.events);
  late.send('rematch');
  await waitFor(() => ol.errors.length === 2);
  assert.ok(ol.state?.players.every(p => !p.rematch));
  a.send('switch-seat', { role: 'spectator' });
  await waitFor(() => ol.state?.phase === 'waiting' && ol.state.spectators.length === 3);
  assert.equal(ol.state?.battle, null);
  restored.send('switch-seat', { role: 'player' });
  await waitFor(() => ol.state?.players.some(p => p.id === restored.sessionId));
  assert.ok(ol.state?.players.every(p => !p.ready && !p.rematch));
  await a.leave(); await b.leave(); await restored.leave(); await late.leave();
});

test('spectators keep the final result after both fighters leave, then claim a vacant finished seat', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '离场红方' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '离场蓝方' });
  observe(b);
  const viewer = await new Client(endpoint).joinById(a.roomId, { name: '留守观众' });
  const observed = observe(viewer);
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  const battle = await waitFor(() => oa.state?.phase === 'battle' && oa.state, 6000);
  await a.leave(); await b.leave();
  const late = await new Client(endpoint).joinById(viewer.roomId, { name: '迟到观众' });
  observe(late);
  await waitFor(() => observed.state?.spectators.length === 2);
  assert.equal(observed.state?.phase, 'battle', 'vacant battle seats remain locked until the result');
  const result = await waitFor(() => observed.state?.phase === 'finished' && observed.state, BATTLE_LIMIT_MS + 5000);
  assert.equal(result.matchId, battle.matchId);
  assert.equal(result.battle?.finished, true);
  assert.equal(result.events.at(-1)?.kind, 'end');
  assert.equal(result.availablePlayerSeats, 2);
  viewer.send('switch-seat', { role: 'player' });
  await waitFor(() => observed.state?.phase === 'waiting' && observed.state.players.length === 1);
  assert.equal(observed.state?.players[0].id, viewer.sessionId);
  assert.equal(observed.state?.battle, null);
  const next = await new Client(endpoint).joinById(viewer.roomId, { name: '下一局蓝方' });
  observe(next);
  await waitFor(() => observed.state?.players.length === 2);
  await next.leave(); await viewer.leave(); await late.leave();
});
