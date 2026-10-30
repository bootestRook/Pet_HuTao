import { ARENA_SIZE, PETS } from '../shared/catalog.js';
import type { BattleEvent, FighterState, ItemFieldState, RoomSnapshot } from '../shared/types.js';
import { drawHutao, drawSlap } from './hutao-art.js';
import { drawHutaoDie } from './hutao-dice.js';
import { HUTAO_RESULT_DURATION_MS, HUTAO_ROLL_DURATION_MS } from '../shared/hutao.js';
import { drawChengzhiquan, drawBound, drawBrotherLink } from './chengzhiquan-art.js';
import { CHENG_QUOTES } from '../shared/chengzhiquan.js';
import { drawItemField, drawCarriedItems, drawItemBurst, itemEventLabel } from './item-art.js';
import { drawWorldField, drawWorldFighter, drawDivineScale, worldEventLabel } from './world-art.js';
import { drawLiangchushuo } from './liangchushuo-art.js';
import { LIANG_QUOTE_DURATION_MS } from '../shared/liangchushuo.js';

type Effect = { event: BattleEvent; since: number; duration: number; value: number; numberHidden: boolean };
const damageKinds = ['attack', 'slap', 'self-damage', 'drain', 'item-damage', 'installment', 'refund', 'arena-damage', 'combo', 'reflection'];
const characterQuote = (event: BattleEvent) => ['survive', 'dash', 'bind'].includes(event.kind) || (event.kind === 'courtesy' && event.amount === 0);
const wordEffect = (event: BattleEvent) => characterQuote(event) || event.kind === 'item' || event.kind === 'immune' || worldEventLabel(event) !== null;
const effectAnchor = (event: BattleEvent) => characterQuote(event) ? event.sourceId : event.targetId;
const numberGroup = (event: BattleEvent) => damageKinds.includes(event.kind) ? event.effect === 'liang-return' ? 'damage-return' : 'damage' : event.kind === 'heal' ? `heal-${event.effect === 'nostalgia' ? 'nostalgia' : 'normal'}` : event.kind;

/** Only interpolates server positions. Movement, contacts and results belong to the server. */
export class ArenaRenderer {
  private context: CanvasRenderingContext2D;
  private snapshot: RoomSnapshot | null = null;
  private previous = new Map<string, FighterState>();
  private previousField: ItemFieldState | undefined;
  private receivedAt = 0;
  private frameDuration = 100;
  private effects: Effect[] = [];
  private motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  private animation = 0;
  private observer: ResizeObserver;
  private finishedAt = 0;

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
    this.previousField = (discontinuity ? snapshot : this.snapshot)?.battle?.field;
    this.frameDuration = Math.max(10, Math.min(250, elapsed - previousElapsed));
    this.receivedAt = now;
    if (snapshot.phase === 'finished' && (this.snapshot?.phase !== 'finished' || this.snapshot.matchId !== snapshot.matchId)) this.finishedAt = now;
    this.snapshot = snapshot;
    if (discontinuity) this.effects = [];
    this.effects = this.effects.filter(effect => now - effect.since < effect.duration);
    for (const event of events) {
      if (event.amount === 0 && damageKinds.includes(event.kind)) continue;
      if ([...damageKinds, 'heal', 'survive', 'immune', 'dash', 'bind', 'rewind'].includes(event.kind) || (event.kind === 'courtesy' && event.amount > 0) || itemEventLabel(event) || worldEventLabel(event)) {
        const duration = ['survive', 'bind', 'reward'].includes(event.kind) ? 1800 : ['dash', 'rewind', 'item', 'stun', 'balance'].includes(event.kind) ? 1000 : 650;
        let value = event.amount;
        if (!wordEffect(event)) {
          for (const previous of this.effects) {
            if (!previous.numberHidden && !wordEffect(previous.event) && previous.event.targetId === event.targetId && numberGroup(previous.event) === numberGroup(event) && now - previous.since < 180) {
              value += previous.value; previous.numberHidden = true;
            }
          }
        }
        this.effects.push({ event, since: now, duration, value, numberHidden: false });
      }
    }
    this.effects = this.effects.filter(effect => now - effect.since < effect.duration).slice(-20);
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
    const battle = this.snapshot?.battle;
    const paused = !!battle?.world.scaleRemainingMs;
    const alpha = this.snapshot?.phase === 'finished' || paused ? 1 : Math.min(1, Math.max(0, (now - this.receivedAt) / this.frameDuration));
    const positions: { fighter: FighterState; x: number; y: number }[] = [];
    const phase = this.snapshot?.phase;
    const visualElapsed = (battle?.elapsedMs ?? 0) + (paused ? 0 : phase === 'finished' ? now - this.finishedAt : Math.min(now - this.receivedAt, this.frameDuration));
    const field = this.snapshot?.battle?.field;
    if (field && phase === 'battle') drawItemField(ctx, field, this.previousField, alpha, visualElapsed, reduced);
    if (battle && phase === 'battle') drawWorldField(ctx, battle.world, visualElapsed, reduced);
    for (const fighter of this.snapshot?.battle?.fighters ?? []) {
      const before = this.previous.get(fighter.id) ?? fighter;
      // Linear interpolation remains inside the convex arena; after a missed packet
      // the last authoritative position is held, never extrapolated through a wall.
      const relocated = before.items.positionRevision !== fighter.items.positionRevision;
      const x = relocated ? fighter.x : before.x + (fighter.x - before.x) * alpha;
      const y = relocated ? fighter.y : before.y + (fighter.y - before.y) * alpha;
      positions.push({ fighter, x, y });
      const index = this.snapshot!.players.findIndex(player => player.id === fighter.id);
      const color = PETS.find(pet => pet.id === fighter.petId)!.color;
      const hit = this.effects.some(effect => effect.event.targetId === fighter.id && damageKinds.includes(effect.event.kind) && now - effect.since < 120);
      ctx.save();
      if (fighter.hp <= 0) ctx.globalAlpha = 0.3;
      if (!reduced && !paused && this.snapshot?.phase === 'battle' && fighter.hp > 0 && !fighter.boundUntilMs && fighter.world.stunnedUntilMs <= visualElapsed) {
        for (let step = 3; step >= 1; step--) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.045 * (4 - step);
          const dash = fighter.cheng?.dash;
          const trailX = Math.max(fighter.radius, Math.min(ARENA_SIZE - fighter.radius, dash ? x + (dash.fromX - x) * 0.12 * step : x - fighter.vx * 0.025 * step));
          const trailY = Math.max(fighter.radius, Math.min(ARENA_SIZE - fighter.radius, dash ? y + (dash.fromY - y) * 0.12 * step : y - fighter.vy * 0.025 * step));
          ctx.beginPath(); ctx.arc(trailX, trailY, fighter.radius * (1 - step * 0.1), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = hit ? '#fff4d9' : color;
      ctx.strokeStyle = index === 0 ? '#fff7de' : '#a8dcff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, fighter.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#10191c'; ctx.font = '800 23px "Microsoft YaHei", sans-serif';
      if (fighter.petId === 'hutao' || fighter.petId === 'chengzhiquan' || fighter.petId === 'liangchushuo') {
        if (fighter.petId === 'hutao') {
          const embarrassed = this.effects.some(effect => effect.event.targetId === fighter.id && effect.event.kind === 'self-damage');
          drawHutao(ctx, x, y, fighter.radius, embarrassed, fighter.nostalgiaUsed);
        } else if (fighter.liang) {
          drawLiangchushuo(ctx, x, y, fighter.radius, fighter.liang, visualElapsed, reduced, hit, phase === 'battle');
        } else {
          const enemy = this.snapshot?.battle?.fighters.find(other => other.id !== fighter.id);
          drawChengzhiquan(ctx, x, y, fighter.radius, fighter, visualElapsed, reduced, enemy && enemy.x > x ? -1 : 1);
        }
        const badgeY = Math.min(ARENA_SIZE - 10, y + fighter.radius - 2);
        ctx.fillStyle = '#1b2a30'; ctx.beginPath(); ctx.roundRect(x - 22, badgeY - 8, 44, 16, 6); ctx.fill();
        ctx.fillStyle = '#fff6dd'; ctx.font = '700 10px "Microsoft YaHei", sans-serif'; ctx.fillText(`P${index + 1} · ${fighter.hp}`, x, badgeY);
      } else {
        ctx.fillText(String(fighter.hp), x, y - 3);
        ctx.font = '700 9px "Microsoft YaHei", sans-serif';
        ctx.fillText(`P${index + 1}`, x, y + 16);
      }
      ctx.restore();
    }
    for (const position of positions) {
      const { fighter, x, y } = position;
      if (phase !== 'battle') continue;
      if (field) drawCarriedItems(ctx, fighter, x, y, field, visualElapsed, reduced);
      drawWorldFighter(ctx, position, visualElapsed, reduced);
      if (fighter.boundUntilMs > visualElapsed) drawBound(ctx, x, y, fighter.radius);
      const grapple = fighter.cheng?.grapple;
      const target = grapple ? positions.find(other => other.fighter.id === grapple.targetId) : null;
      if (grapple && target && (!target.fighter.cheng?.grapple || fighter.id < target.fighter.id)) drawBrotherLink(ctx, position, target, grapple, visualElapsed, reduced);
    }
    for (const { fighter, x, y } of positions) {
      const roll = fighter.diceRoll;
      if (!roll || (phase !== 'battle' && !(phase === 'finished' && roll.resolved))) continue;
      const age = visualElapsed - roll.startedAtMs;
      if (age >= 0 && age < HUTAO_ROLL_DURATION_MS + HUTAO_RESULT_DURATION_MS) drawHutaoDie(ctx, x, y, fighter.radius, roll, age, reduced);
    }
    if (paused && phase === 'battle') drawDivineScale(ctx, positions, Math.max(1, battle!.world.scaleRemainingMs - Math.min(now - this.receivedAt, 250)), reduced);
    this.effects = this.effects.filter(effect => now - effect.since < effect.duration);
    const frameEffects = [...this.effects];
    // Read the latest server-owned quote from state: reconnect restores its remaining
    // lifetime without replaying a collision or restarting the speech bubble.
    for (const { fighter } of positions) {
      const contact = fighter.liang?.contact;
      const age = contact ? visualElapsed - contact.timeMs : Infinity;
      if (!contact || age < 0 || age >= LIANG_QUOTE_DURATION_MS) continue;
      const event: BattleEvent = { seq: 0, timeMs: contact.timeMs, kind: 'courtesy', sourceId: fighter.id, targetId: fighter.id, amount: 0, text: contact.quote, x: fighter.x, y: fighter.y };
      frameEffects.push({ event, since: now - age, duration: LIANG_QUOTE_DURATION_MS, value: 0, numberHidden: false });
    }
    const newestWords = new Map<string, Effect>();
    for (const effect of frameEffects) if (wordEffect(effect.event)) newestWords.set(effectAnchor(effect.event), effect);
    const visibleLabel = (effect: Effect) => !effect.numberHidden && (!wordEffect(effect.event) || newestWords.get(effectAnchor(effect.event)) === effect);
    const labelCounts = new Map<string, number>(), labelLanes = new Map<string, number>();
    for (const effect of frameEffects) if (visibleLabel(effect)) {
      const anchor = effectAnchor(effect.event);
      labelCounts.set(anchor, (labelCounts.get(anchor) ?? 0) + 1);
    }
    for (const effect of frameEffects) {
      const { event, since } = effect;
      const quote = event.kind === 'courtesy' && event.amount === 0 ? event.text : event.kind === 'survive' ? `${CHENG_QUOTES.survive}！` : event.kind === 'dash' ? `${CHENG_QUOTES.dash}！` : event.kind === 'bind' ? CHENG_QUOTES.bind : null;
      const target = positions.find(({ fighter }) => fighter.id === (quote ? event.sourceId : event.targetId));
      if (!target) continue;
      const age = (now - since) / effect.duration;
      drawItemBurst(ctx, event, target.x, target.y, age, reduced);
      if (['green-meadow', 'divine-scale', 'lucky-jackpot'].includes(event.effect ?? '') && event.kind === 'heal') {
        ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = event.effect === 'green-meadow' ? '#8ce4b1' : '#f0d29a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(target.x, target.y, target.fighter.radius + 6 + (reduced ? 0 : age * 20), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (event.kind === 'slap') {
        ctx.save(); ctx.globalAlpha = 1 - age;
        drawSlap(ctx, target.x, target.y, age, reduced); ctx.restore();
      }
      if (event.effect === 'nostalgia') {
        ctx.save(); ctx.globalAlpha = (1 - age) * 0.75; ctx.strokeStyle = '#e8c27b'; ctx.lineWidth = 3;
        const size = 44 + (reduced ? 0 : age * 20);
        ctx.translate(Math.max(size, Math.min(ARENA_SIZE - size, target.x)), Math.max(size, Math.min(ARENA_SIZE - size, target.y)));
        ctx.rotate(-0.12); ctx.strokeRect(-size / 2, -size / 2, size, size); ctx.strokeRect(-size / 2 + 5, -size / 2 + 5, size - 10, size - 17); ctx.restore();
      }
      if (!visibleLabel(effect)) continue;
      const lane = labelLanes.get(target.fighter.id) ?? 0;
      labelLanes.set(target.fighter.id, lane + 1);
      ctx.save(); ctx.globalAlpha = 1 - age;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = wordEffect(event) ? '700 12px "Microsoft YaHei", sans-serif' : '700 18px "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = '#10191c';
      ctx.fillStyle = quote || event.kind === 'immune' ? '#ffda9c' : event.kind === 'heal' ? event.effect === 'nostalgia' ? '#ffe0a1' : '#8ce4cd' : event.kind === 'self-damage' ? '#ffb29e' : '#fff0de';
      const healPrefix = event.effect === 'nostalgia' ? '忆往昔 ' : event.effect === 'green-meadow' ? '草原 ' : event.effect === 'divine-scale' ? '天平 ' : event.effect === 'lucky-jackpot' ? '大奖 ' : '';
      const label = quote ?? itemEventLabel(event) ?? worldEventLabel(event) ?? (event.kind === 'courtesy' ? `礼让 −${effect.value}` : event.kind === 'immune' ? '免疫' : event.kind === 'heal' ? `${healPrefix}+${effect.value}` : `${event.effect === 'liang-return' ? '回礼 ' : ''}−${effect.value}`);
      const inset = Math.max(event.effect === 'nostalgia' ? 80 : 48, ctx.measureText(label).width / 2 + 10);
      const neighbor = positions.find(other => other !== target && Math.hypot(other.x - target.x, other.y - target.y) < other.fighter.radius + target.fighter.radius + 55);
      const side = neighbor ? (target.x === neighbor.x ? target.fighter.id < neighbor.fighter.id : target.x < neighbor.x) ? -1 : 1 : 0;
      const x = Math.max(inset, Math.min(ARENA_SIZE - inset, target.x + side * (target.fighter.radius + 30)));
      const requiredSpace = 42 + ((labelCounts.get(target.fighter.id) ?? 1) - 1) * 24 + 30;
      let direction = target.y < requiredSpace ? 1 : -1;
      if (neighbor) {
        const outward = target.y <= neighbor.y ? -1 : 1;
        if (outward < 0 ? target.y >= requiredSpace : ARENA_SIZE - target.y >= requiredSpace) direction = outward;
      }
      const y = Math.max(16, Math.min(ARENA_SIZE - 16, target.y + direction * (42 + lane * 24 + (reduced ? 0 : age * 10))));
      ctx.strokeText(label, x, y); ctx.fillText(label, x, y);
      ctx.restore();
    }
    this.animation = requestAnimationFrame(this.frame);
  };

  destroy() { cancelAnimationFrame(this.animation); this.observer.disconnect(); }
}
