import { ARENA_SIZE, MAX_CHARGE, PETS } from '../shared/catalog.js';
import type { BattleEvent, FighterState, RoomSnapshot } from '../shared/types.js';

type Effect = { event: BattleEvent; since: number; lane: number };

/** Only interpolates server positions. Movement, contacts and results belong to the server. */
export class ArenaRenderer {
  private context: CanvasRenderingContext2D;
  private snapshot: RoomSnapshot | null = null;
  private previous = new Map<string, FighterState>();
  private receivedAt = 0;
  private frameDuration = 100;
  private effects: Effect[] = [];
  private motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  private animation = 0;
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法显示战斗画面。');
    this.context = context;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.animation = requestAnimationFrame(this.frame);
  }

  update(snapshot: RoomSnapshot, events: BattleEvent[], reset = false) {
    const now = performance.now();
    const elapsed = snapshot.battle?.elapsedMs ?? 0;
    const previousElapsed = this.snapshot?.battle?.elapsedMs ?? 0;
    const discontinuity = reset || this.snapshot?.matchId !== snapshot.matchId || now - this.receivedAt > 500 || elapsed < previousElapsed;
    this.previous = new Map((discontinuity ? snapshot : this.snapshot)?.battle?.fighters.map(fighter => [fighter.id, fighter]) ?? []);
    this.frameDuration = Math.max(10, Math.min(250, elapsed - previousElapsed));
    this.receivedAt = now;
    this.snapshot = snapshot;
    if (discontinuity) this.effects = [];
    this.effects = this.effects.filter(effect => now - effect.since < 650);
    for (const event of events) {
      if (event.kind !== 'end') {
        // Consecutive bounces near a corner can share the same label position.
        // Show the newest charge gain instead of stacking identical text.
        if (event.kind === 'charge') this.effects = this.effects.filter(effect => effect.event.kind !== 'charge' || effect.event.targetId !== event.targetId);
        const lane = this.effects.filter(effect => effect.event.targetId === event.targetId).length % 3;
        this.effects.push({ event, since: now, lane });
      }
    }
    this.effects = this.effects.filter(effect => now - effect.since < 650).slice(-16);
  }

  private resize() {
    const scale = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    this.canvas.height = this.canvas.width;
  }

  private frame = (now: number) => {
    const ctx = this.context;
    const scale = this.canvas.width / ARENA_SIZE;
    const reduced = this.motionQuery.matches;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#10191c';
    ctx.fillRect(0, 0, ARENA_SIZE, ARENA_SIZE);
    ctx.strokeStyle = '#1d2b30';
    ctx.lineWidth = 1;
    for (let point = 40; point < ARENA_SIZE; point += 40) {
      ctx.beginPath(); ctx.moveTo(point, 0); ctx.lineTo(point, ARENA_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, point); ctx.lineTo(ARENA_SIZE, point); ctx.stroke();
    }
    ctx.strokeStyle = '#5a6c70'; ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, ARENA_SIZE - 3, ARENA_SIZE - 3);
    const alpha = this.snapshot?.phase === 'finished' ? 1 : Math.min(1, Math.max(0, (now - this.receivedAt) / this.frameDuration));
    for (const fighter of this.snapshot?.battle?.fighters ?? []) {
      const before = this.previous.get(fighter.id) ?? fighter;
      // Linear interpolation remains inside the convex arena; after a missed packet
      // the last authoritative position is held, never extrapolated through a wall.
      const x = before.x + (fighter.x - before.x) * alpha;
      const y = before.y + (fighter.y - before.y) * alpha;
      const index = this.snapshot!.players.findIndex(player => player.id === fighter.id);
      const color = PETS.find(pet => pet.id === fighter.petId)!.color;
      const hit = this.effects.some(effect => effect.event.targetId === fighter.id && effect.event.kind === 'attack' && now - effect.since < 120);
      ctx.save();
      if (fighter.hp <= 0) ctx.globalAlpha = 0.3;
      if (!reduced && this.snapshot?.phase === 'battle' && fighter.hp > 0) {
        for (let step = 3; step >= 1; step--) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.045 * (4 - step);
          const trailX = Math.max(fighter.radius, Math.min(ARENA_SIZE - fighter.radius, x - fighter.vx * 0.025 * step));
          const trailY = Math.max(fighter.radius, Math.min(ARENA_SIZE - fighter.radius, y - fighter.vy * 0.025 * step));
          ctx.beginPath(); ctx.arc(trailX, trailY, fighter.radius * (1 - step * 0.1), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (fighter.charge > 0) {
        ctx.strokeStyle = '#ffcd80'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, fighter.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fighter.charge / MAX_CHARGE); ctx.stroke();
      }
      ctx.fillStyle = hit ? '#fff4d9' : color;
      ctx.strokeStyle = index === 0 ? '#fff7de' : '#a8dcff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, fighter.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#10191c'; ctx.font = '800 23px "Microsoft YaHei", sans-serif';
      ctx.fillText(String(fighter.hp), x, y - 3);
      ctx.font = '700 9px "Microsoft YaHei", sans-serif';
      ctx.fillText(`P${index + 1}`, x, y + 16);
      ctx.restore();
    }
    this.effects = this.effects.filter(effect => now - effect.since < 650);
    for (const effect of this.effects) {
      const { event, since, lane } = effect;
      const age = (now - since) / 650;
      const x = Math.max(42, Math.min(ARENA_SIZE - 42, event.x));
      const direction = event.y < 100 ? 1 : -1;
      const y = Math.max(16, Math.min(ARENA_SIZE - 16, event.y + direction * (42 + lane * 23 + (reduced ? 0 : age * 14))));
      ctx.save(); ctx.globalAlpha = 1 - age;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 18px "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = '#10191c';
      ctx.fillStyle = event.kind === 'heal' ? '#8ce4cd' : event.kind === 'charge' ? '#ffd184' : '#fff0de';
      const label = event.kind === 'heal' ? `+${event.amount}` : event.kind === 'charge' ? `蓄力 +${event.amount}` : `−${event.amount}`;
      ctx.strokeText(label, x, y); ctx.fillText(label, x, y);
      ctx.restore();
    }
    this.animation = requestAnimationFrame(this.frame);
  };

  destroy() { cancelAnimationFrame(this.animation); this.observer.disconnect(); }
}
