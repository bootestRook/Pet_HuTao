import { ARENA_SIZE } from '../shared/catalog.js';
import type { HutaoRoll } from '../shared/types.js';
import { HUTAO_ROLL_DURATION_MS } from '../shared/hutao.js';

const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

/** A world-space effect anchored to the same interpolated position as its owner. */
export function drawHutaoDie(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, roll: HutaoRoll, age: number, reduced: boolean) {
  const rolling = !roll.resolved;
  const color = rolling ? '#8ed9d2' : roll.outcome === 'heal' ? '#8ce4b7' : roll.outcome === 'slap' ? '#f3cf83' : '#ffad98';
  const lift = rolling && !reduced ? Math.sin(Math.min(1, age / HUTAO_ROLL_DURATION_MS) * Math.PI) * 10 : 0;
  const dieX = Math.max(24, Math.min(ARENA_SIZE - 24, x + radius * 0.72));
  const above = y - radius - 22 - lift;
  const dieY = above >= 24 ? above : y + radius + 22 + lift;
  const value = rolling ? 1 + Math.floor(age / 70) % 6 : roll.value;

  ctx.save(); ctx.translate(dieX, dieY);
  // A small halo and sparks belong to the die, never a screen-space panel.
  ctx.shadowColor = color; ctx.shadowBlur = rolling ? 12 : 8;
  ctx.strokeStyle = color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.3;
  const rotation = reduced ? 0 : age / 400;
  ctx.beginPath(); ctx.arc(0, 0, 20, -0.8 + rotation, 2.9 + rotation); ctx.stroke();
  ctx.globalAlpha = 1;
  if (!reduced) {
    for (let spark = 0; spark < 3; spark++) {
      const angle = age / 300 + spark * Math.PI * 2 / 3;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(Math.cos(angle) * 22, Math.sin(angle) * 22, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.rotate(rolling ? Math.sin(age / 75) * 0.55 + age / 180 : -0.08);
  }
  ctx.fillStyle = '#a39776'; ctx.strokeStyle = color; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.roundRect(-12, -11, 27, 28, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f7f0dd'; ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.roundRect(-14, -14, 27, 27, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#253f45';
  if (rolling && reduced) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 18px "Microsoft YaHei", sans-serif'; ctx.fillText('?', 0, 0);
  } else {
    for (const pip of PIPS[value - 1]) {
      ctx.beginPath(); ctx.arc((pip % 3 - 1) * 7.3, (Math.floor(pip / 3) - 1) * 7.3, 2.1, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  if (roll.resolved) {
    ctx.save(); ctx.font = '700 11px "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'middle';
    const width = ctx.measureText(roll.quote).width;
    const right = dieX + 24 + width < ARENA_SIZE - 8;
    ctx.textAlign = right ? 'left' : 'right'; ctx.lineWidth = 4; ctx.strokeStyle = '#10191c'; ctx.fillStyle = color;
    const quoteX = dieX + (right ? 24 : -24);
    ctx.strokeText(roll.quote, quoteX, dieY); ctx.fillText(roll.quote, quoteX, dieY); ctx.restore();
  }
}
