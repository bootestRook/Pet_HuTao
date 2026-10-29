import { randomBytes, randomUUID } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import { z } from 'zod';
import { createDefaultLoadout, selectionLimit, validateLoadout } from '../shared/catalog.js';
import type { BattleEvent, Loadout, PlayerInfo, RoomMode, RoomSnapshot, SpectatorInfo } from '../shared/types.js';
import { BattleSimulator } from './battle.js';

const nameSchema = z.string().trim().min(1).max(16).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
const loadoutSchema = z.object({
  petId: z.string().max(64),
  items: z.array(z.string().max(64)).max(selectionLimit('items')),
  skills: z.array(z.string().max(64)).max(selectionLimit('skills')),
  traitId: z.string().min(1).max(64).nullable(),
}).strict().refine(value => validateLoadout(value as Loadout));
const activeRooms = new Set<string>();
type Admission = { name: string; role: 'host' | 'player' };

/** A single room owns the clock and combat. Clients only request pre-match choices.
 * Full snapshots include a bounded event tail so reconnect never depends on missed packets.
 */
export class DuelRoom extends Room {
  maxClients = 2;
  autoDispose = false;
  maxMessagesPerSecond = 25;
  patchRate = null;
  private players = new Map<string, PlayerInfo>();
  private mode: RoomMode = 'duel';
  private host: SpectatorInfo | null = null;
  private hostKey: string | null = null;
  private createdAt = Date.now();
  private departed = new Set<string>();
  private phase: RoomSnapshot['phase'] = 'waiting';
  private startAt = 0;
  private matchId = '';
  private simulator: BattleSimulator | null = null;
  private events: BattleEvent[] = [];
  private lastActivity = Date.now();
  private battleOrigin = 0;
  private lastBattleTick = 0;
  private closing = false;

  async onCreate(options: unknown) {
    this.parseName(options);
    const parsed = z.object({ mode: z.enum(['duel', 'spectator']).default('duel'), hostKey: z.string().min(32).max(128).optional() }).safeParse(options);
    if (!parsed.success || (parsed.data.mode === 'spectator' && !parsed.data.hostKey)) throw new ServerError(400, '创建模式无效，请重新创建房间。');
    this.mode = parsed.data.mode;
    this.hostKey = this.mode === 'spectator' ? parsed.data.hostKey! : null;
    this.maxClients = this.mode === 'spectator' ? 3 : 2;
    if (activeRooms.size >= 100) throw new ServerError(503, '房间已满，请稍后再试。');
    activeRooms.add(this.roomId);
    await this.setPrivate(true);
    this.onMessage('sync', client => client.send('snapshot', this.snapshot()));
    this.onMessage('ping', (client, payload: unknown) => {
      const parsed = z.object({ clientTime: z.number().finite() }).safeParse(payload);
      if (parsed.success) client.send('clock', { clientTime: parsed.data.clientTime, serverTime: Date.now() });
    });
    this.onMessage('loadout', (client, payload: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '观战主机不能修改玩家搭配。');
      if (this.phase !== 'waiting') return this.error(client, '比赛已经锁定，结束后再调整搭配。');
      const parsed = loadoutSchema.safeParse(payload);
      if (!parsed.success) return this.error(client, '搭配无效：请选择可用小球；当前道具、技能和特性应留空。');
      player.loadout = parsed.data as Loadout;
      player.ready = false;
      this.touch();
      this.publish();
    });
    this.onMessage('ready', (client, payload: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '观战主机不能代替玩家准备。');
      if (this.phase !== 'waiting') return this.error(client, '比赛已开始，无法改变准备状态。');
      const parsed = z.object({ ready: z.boolean() }).strict().safeParse(payload);
      if (!parsed.success) return this.error(client, '无效的准备请求。');
      player.ready = parsed.data.ready;
      this.touch();
      if (this.players.size === 2 && [...this.players.values()].every(p => p.ready && p.connected)) {
        this.phase = 'countdown';
        this.startAt = Date.now() + 3000;
        this.battleOrigin = performance.now() + 3000;
        this.matchId = randomUUID();
        void this.lock();
      }
      this.publish();
    });
    this.onMessage('rematch', client => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '再战由两名玩家决定，主机继续观战。');
      if (this.phase !== 'finished') return this.error(client, '本局还没有结束。');
      player.rematch = true;
      this.touch();
      this.tryRematch();
      this.publish();
    });
    this.onMessage('*', client => this.error(client, '不支持的操作。'));
    this.setSimulationInterval(() => this.tick(), 100);
  }

  onAuth(_client: Client, options: unknown): Admission {
    const name = this.parseName(options);
    const key = z.object({ hostKey: z.string().optional() }).safeParse(options);
    // Only the creator's one-time key claims the spectator seat. A player may
    // consume an invitation before the creator consumes its reserved seat.
    if (this.hostKey && key.success && key.data.hostKey === this.hostKey) return { name, role: 'host' };
    if (!this.canRefillFinishedRoom() && (this.phase !== 'waiting' || this.players.size >= 2)) throw new ServerError(403, '房间已满或比赛正在进行。');
    return { name, role: 'player' };
  }

  onJoin(client: Client) {
    const admission = client.auth as Admission;
    if (admission.role === 'host') {
      if (this.host || !this.hostKey) throw new ServerError(403, '观战主机席位已被使用。');
      this.host = { id: client.sessionId, name: admission.name, connected: true };
      this.hostKey = null;
    } else {
      if (this.canRefillFinishedRoom()) this.resetWaiting();
      // Recheck after authentication, because concurrent joins may have been
      // admitted while only one combat seat was filled.
      if (this.phase !== 'waiting' || this.players.size >= 2) throw new ServerError(403, '两名玩家席位已满或比赛正在进行。');
      this.players.set(client.sessionId, {
        id: client.sessionId, name: admission.name, connected: true, ready: false,
        rematch: false, loadout: createDefaultLoadout()
      });
    }
    this.touch();
    this.publish();
  }

  onDrop(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) { player.connected = false; player.ready = false; player.rematch = false; }
    if (this.host?.id === client.sessionId) this.host.connected = false;
    if (player && this.phase === 'countdown') this.cancelCountdown();
    // A socket may drop before its JOIN acknowledgement. Colyseus rejects that
    // reservation immediately; consume the rejection so it cannot crash Node.
    // The framework owns seat cleanup after a rejected/expired reservation.
    this.allowReconnection(client, 60).catch(() => {});
    this.publish();
  }

  onReconnect(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) player.connected = true;
    if (this.host?.id === client.sessionId) this.host.connected = true;
    this.touch();
    this.publish();
  }

  onLeave(client: Client) {
    if (this.host?.id === client.sessionId) {
      this.host = null;
      this.publish();
      this.disposeIfEmpty();
      return;
    }
    const player = this.players.get(client.sessionId);
    if (!player) return;
    if (player) { player.connected = false; player.ready = false; player.rematch = false; }
    if (this.phase === 'countdown') this.cancelCountdown();
    if (this.phase === 'waiting') {
      this.players.delete(client.sessionId);
      for (const p of this.players.values()) p.ready = false;
    } else {
      // Retain fighters until the result has been seen; a rematch removes departed seats.
      this.departed.add(client.sessionId);
      this.tryRematch();
    }
    this.publish();
    this.disposeIfEmpty();
  }

  onDispose() { activeRooms.delete(this.roomId); }

  private tick() {
    if (this.closing) return;
    const now = performance.now();
    if (this.phase === 'countdown' && now >= this.battleOrigin) {
      this.simulator = new BattleSimulator([...this.players.values()], randomBytes(4).readUInt32LE());
      this.phase = 'battle';
      this.lastBattleTick = this.battleOrigin;
    }
    if (this.phase === 'battle' && this.simulator) {
      this.events.push(...this.simulator.advance(now - this.lastBattleTick));
      this.events = this.events.slice(-80);
      this.lastBattleTick = now;
      if (this.simulator.snapshot().finished) {
        this.phase = 'finished';
        this.touch();
        // If both players left during combat, the host still receives its final
        // result. The next invitee starts a new lobby instead of erasing it now.
        if (this.canRefillFinishedRoom()) void this.unlock();
      }
      this.publish();
      this.disposeIfEmpty();
    } else if (this.phase === 'countdown') {
      this.publish();
    }
    if (Date.now() - this.lastActivity > 30 * 60_000) this.close();
    if (this.hostKey && Date.now() - this.createdAt > 30_000) this.hostKey = null;
    // A creation whose seat is never claimed must not leak an empty room.
    if (!this.players.size && !this.host && Date.now() - this.lastActivity > 30_000) this.close();
  }

  private snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId, mode: this.mode, host: this.host, phase: this.phase, players: [...this.players.values()],
      serverTime: Date.now(), startAt: this.startAt, matchId: this.matchId,
      battle: this.simulator?.snapshot() ?? null, events: this.events
    };
  }
  private publish() { this.broadcast('snapshot', this.snapshot()); }
  private touch() { this.lastActivity = Date.now(); }
  private error(client: Client, message: string) { client.send('error', { message }); }
  private parseName(options: unknown) {
    const result = z.object({ name: nameSchema }).safeParse(options);
    if (!result.success) throw new ServerError(400, '昵称需要 1–16 个字符，不能包含控制字符。');
    return result.data.name;
  }
  private cancelCountdown() {
    this.phase = 'waiting'; this.startAt = 0; this.matchId = '';
    for (const player of this.players.values()) player.ready = false;
    void this.unlock();
  }
  private resetWaiting() {
    for (const id of this.departed) this.players.delete(id);
    this.departed.clear();
    this.phase = 'waiting'; this.simulator = null; this.events = []; this.startAt = 0; this.matchId = '';
    for (const player of this.players.values()) { player.ready = false; player.rematch = false; }
    void this.unlock();
  }
  private tryRematch() {
    if (this.phase !== 'finished') return;
    const remaining = [...this.players.values()].filter(p => !this.departed.has(p.id));
    if ((remaining.length && remaining.every(p => p.connected && p.rematch)) || (!remaining.length && this.host)) this.resetWaiting();
  }
  private canRefillFinishedRoom() {
    return this.phase === 'finished' && this.host !== null && [...this.players.keys()].every(id => this.departed.has(id));
  }
  private disposeIfEmpty() {
    if (this.phase === 'battle' || this.phase === 'countdown') return;
    if (this.host || this.hostKey) return;
    if (![...this.players.values()].some(p => !this.departed.has(p.id))) this.close();
  }
  private close() {
    if (this.closing) return;
    this.closing = true;
    void this.disconnect();
  }
}
