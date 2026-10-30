import { ARENA_SIZE } from '../shared/catalog.js';
import { WORLD_RULES as R } from '../shared/world-effects.js';
import type { BattleEvent, FighterState, WorldEffectState } from '../shared/types.js';

export interface WorldPosition { fighter: FighterState; x: number; y: number }
const clamp = (value: number, margin: number) => Math.max(margin, Math.min(ARENA_SIZE - margin, value));
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '700 11px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = '#10191c'; ctx.fillStyle = color;
  const inset = ctx.measureText(text).width / 2 + 6;
  x = clamp(x, inset); y = clamp(y, 12);
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}

export function worldEventLabel(event: BattleEvent) {
  if (event.kind === 'stun') return '眩晕3秒';
  if (event.kind === 'reward') return event.text.slice(event.text.lastIndexOf('：') + 1).split('，')[0];
  if (event.kind === 'balance') return event.amount ? `天平 −${Math.abs(event.amount)}` : '天平均衡';
  return null;
}

export function drawWorldField(ctx: CanvasRenderingContext2D, world: WorldEffectState, elapsed: number, reduced: boolean) {
  ctx.save();
  if (world.id === 'green-meadow') {
    ctx.strokeStyle = '#365742'; ctx.lineWidth = 2;
    for (let x = 15; x < ARENA_SIZE; x += 25) {
      ctx.beginPath(); ctx.moveTo(x, 418); ctx.lineTo(x - 4, 410); ctx.moveTo(x, 418); ctx.lineTo(x + 6, 406); ctx.stroke();
    }
    const age = world.pulseAtMs === null ? Infinity : elapsed - world.pulseAtMs;
    if (age >= 0 && age < 1100) {
      ctx.fillStyle = `rgba(120,220,150,${0.14 * (1 - age / 1100)})`; ctx.fillRect(3, 3, 414, 414);
      ctx.strokeStyle = '#8ce4b1'; ctx.globalAlpha = 1 - age / 1100; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(210, 210, reduced ? 160 : 20 + age * 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  for (const junk of world.debris) {
    const timeLeft = junk.landsAtMs - elapsed;
    ctx.save(); ctx.translate(junk.x, junk.y);
    ctx.strokeStyle = '#f3a18e'; ctx.fillStyle = timeLeft > 0 ? '#dd6d5029' : '#dd6d5070'; ctx.lineWidth = 2;
    ctx.setLineDash(timeLeft > 0 ? [5, 4] : []);
    ctx.beginPath(); ctx.arc(0, 0, R.junkRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    if (timeLeft > 0) {
      const progress = 1 - timeLeft / R.junkWarningMs;
      const offset = reduced ? 0 : -90 * (1 - progress * progress);
      ctx.translate(0, offset); if (!reduced) ctx.rotate(progress * 1.1 - 0.5);
      ctx.fillStyle = '#c29a71'; ctx.strokeStyle = '#ffe1ba'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-10, -9, 20, 18, 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(8, 7); ctx.moveTo(8, -7); ctx.lineTo(-8, 7); ctx.stroke();
    } else {
      ctx.globalAlpha = Math.max(0, 1 + timeLeft / 500); ctx.strokeStyle = '#ffe2c3';
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3, radius = reduced ? 29 : 27 - timeLeft * 0.04;
        ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12); ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); ctx.stroke();
      }
    }
    ctx.restore();
    if (timeLeft > 0) label(ctx, '落点', junk.x, junk.y + 38, '#ffbd9d');
  }
  const prize = world.prize;
  if (prize && elapsed < prize.expiresAtMs) {
    const pulse = reduced ? 1 : 1 + Math.sin(elapsed / 140) * 0.08;
    ctx.save(); ctx.translate(prize.x, prize.y); ctx.scale(pulse, pulse);
    ctx.shadowColor = '#ffd36e'; ctx.shadowBlur = reduced ? 0 : 18;
    ctx.fillStyle = '#b180282f'; ctx.strokeStyle = '#ffe096'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R.prizeRadius + 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffda7a';
    ctx.beginPath(); ctx.moveTo(-11, -12); ctx.lineTo(11, -12); ctx.quadraticCurveTo(11, 4, 2, 6); ctx.lineTo(2, 12); ctx.lineTo(9, 12); ctx.lineTo(9, 16); ctx.lineTo(-9, 16); ctx.lineTo(-9, 12); ctx.lineTo(-2, 12); ctx.lineTo(-2, 6); ctx.quadraticCurveTo(-11, 4, -11, -12); ctx.fill();
    ctx.beginPath(); ctx.arc(-11, -6, 7, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(11, -6, 7, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.restore();
    label(ctx, `大奖 ${Math.max(0, Math.ceil((prize.expiresAtMs - elapsed) / 1000))}s`, prize.x, prize.y + 38, '#ffe096');
  }
  ctx.restore();
}

export function drawWorldFighter(ctx: CanvasRenderingContext2D, { fighter, x, y }: WorldPosition, elapsed: number, reduced: boolean) {
  const state = fighter.world;
  ctx.save();
  if (state.invulnerableUntilMs > elapsed) {
    ctx.strokeStyle = '#ffe096'; ctx.fillStyle = '#ffe09615'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, fighter.radius + 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    label(ctx, `无敌 ${Math.ceil((state.invulnerableUntilMs - elapsed) / 1000)}s`, x, y + fighter.radius + 25, '#ffe096');
  }
  if (state.damageBonus) label(ctx, `伤害 +${state.damageBonus}`, x, y + fighter.radius + 25, '#ffe096');
  if (state.stunnedUntilMs > elapsed) {
    ctx.strokeStyle = '#f3a18e'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, fighter.radius + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const orbit = reduced ? 0 : elapsed / 250;
    ctx.fillStyle = '#ffe096';
    for (let i = 0; i < 3; i++) {
      const angle = orbit + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.arc(x + Math.cos(angle) * 18, clamp(y - fighter.radius - 11, 10) + Math.sin(angle) * 5, 3, 0, Math.PI * 2); ctx.fill();
    }
    label(ctx, `眩晕 ${((state.stunnedUntilMs - elapsed) / 1000).toFixed(1)}s`, x, y + fighter.radius + 23, '#ffc4a8');
  }
  ctx.restore();
}

export function drawDivineScale(ctx: CanvasRenderingContext2D, positions: WorldPosition[], remainingMs: number, reduced: boolean) {
  if (!remainingMs || positions.length < 2) return;
  const progress = Math.max(0, Math.min(1, 1 - remainingMs / R.scalePauseMs));
  const [a, b] = positions;
  ctx.save(); ctx.fillStyle = '#d7d8ff0c'; ctx.fillRect(3, 3, 414, 414);
  ctx.strokeStyle = '#f0d29a'; ctx.lineWidth = 2;
  // HP flows between the frozen balls, while the scale above levels out.
  ctx.setLineDash([5, 7]); ctx.lineDashOffset = reduced ? 0 : -progress * 90;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(210, 70, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  for (const point of positions) {
    ctx.beginPath(); ctx.arc(point.x, point.y, point.fighter.radius + 10 + (reduced ? 0 : Math.sin(progress * Math.PI * 4) * 3), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(210, 47); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 22); ctx.moveTo(-15, 23); ctx.lineTo(15, 23); ctx.stroke();
  ctx.save(); ctx.rotate(reduced ? 0 : (a.fighter.hp - b.fighter.hp) / 120 * 0.35 * (1 - progress));
  ctx.beginPath(); ctx.moveTo(-39, -5); ctx.lineTo(39, -5); ctx.stroke();
  for (const side of [-1, 1]) {
    const x = side * 33;
    ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x - 12, 20); ctx.lineTo(x + 12, 20); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, 21, 12, 4, 0, 0, Math.PI); ctx.stroke();
  }
  ctx.restore(); ctx.restore();
  ctx.save(); label(ctx, `神之天平 · 暂停 ${(remainingMs / 1000).toFixed(1)}s`, 210, 397, '#f0d29a'); ctx.restore();
}
