import type { DiceOutcome } from './types.js';

export const HUTAO_ROLL_INTERVAL_MS = 10_000;
export const HUTAO_ROLL_DURATION_MS = 800;
export const HUTAO_RESULT_DURATION_MS = 1600;
export const HUTAO_DICE_HEAL = 12;
export const HUTAO_SLAP_DAMAGE = 8;
export const HUTAO_SELF_DAMAGE = 4;
export const HUTAO_NOSTALGIA_THRESHOLD = 40;
export const HUTAO_NOSTALGIA_HEAL = 25;
export const HUTAO_QUOTES = ['龙逼', '666', '破绷', '我叼你妈'] as const;

export function diceOutcome(value: number): DiceOutcome {
  if (value === 1) return 'heal';
  if (value === 6) return 'slap';
  return 'self-damage';
}
