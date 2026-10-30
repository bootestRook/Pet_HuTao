import type { JackpotReward, WorldEffectId } from './types.js';

export const WORLD_EFFECTS: { id: WorldEffectId; name: string; intervalMs: number; description: string; color: string }[] = [
  { id: 'divine-scale', name: '神之天平', intervalMs: 35_000, description: '每35秒暂停战场2秒，随后均分存活小球的当前生命。', color: '#f0d29a' },
  { id: 'falling-junk', name: '天降厄运', intervalMs: 30_000, description: '每30秒随机5处落下杂物，每次命中造成3点伤害并眩晕3秒；眩晕时不能移动或造成碰撞伤害。', color: '#f3a18e' },
  { id: 'green-meadow', name: '青青草原', intervalMs: 60_000, description: '每60秒，所有存活小球恢复20点生命，不超过最大生命。', color: '#8ce4b1' },
  { id: 'lucky-jackpot', name: '幸运大奖', intervalMs: 50_000, description: '每50秒出现持续5秒的大奖。首次触碰随机获得：无敌20秒、回复50%最大生命、所有伤害+5至本局结束。领取后本局不再出现。', color: '#ffe096' },
];
export const WORLD_RULES = {
  scalePauseMs: 2000,
  junkCount: 5, junkWarningMs: 800, junkRadius: 26, junkDamage: 3, stunMs: 3000,
  meadowHeal: 20,
  prizeLifetimeMs: 5000, prizeRadius: 18, invulnerableMs: 20_000, prizeHealRatio: 0.5, damageBonus: 5,
} as const;
export const JACKPOT_REWARDS: JackpotReward[] = ['invincible', 'heal', 'damage'];
export const JACKPOT_LABELS: Record<JackpotReward, string> = { invincible: '无敌20秒', heal: '回复50%最大生命', damage: '所有伤害+5' };
