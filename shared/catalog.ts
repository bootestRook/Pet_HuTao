import type { CategoryId, ItemId, Loadout, PetId, SkillId, TraitId } from './types.js';
import { ITEM_DEFINITIONS } from './items.js';
import { LIANG_REDUCTION, LIANG_RETURN_BONUS } from './liangchushuo.js';
import { HUTAO_DICE_HEAL, HUTAO_SLAP_DAMAGE, HUTAO_SELF_DAMAGE, HUTAO_NOSTALGIA_THRESHOLD, HUTAO_NOSTALGIA_HEAL } from './hutao.js';
import { CHENG_MEAL_THRESHOLD, CHENG_MEAL_HEAL, CHENG_MEAL_DURATION_MS, CHENG_MEAL_COOLDOWN_MS, CHENG_INVULNERABLE_MS, CHENG_GRAPPLE_THRESHOLD, CHENG_GRAPPLE_COOLDOWN_MS, CHENG_BIND_DURATION_MS, CHENG_DRAIN_DAMAGE } from './chengzhiquan.js';

export interface CatalogEntry { id: string; name: string; description: string; title?: string; keywords?: string[] }
export interface LoadoutCategory { id: CategoryId; label: string; singular: string; limit: number; slotPageSize: number; description: string }
/** Selection and slot systems remain available even when their content catalogs are empty. */
export const LOADOUT_CATEGORIES: LoadoutCategory[] = [
  { id: 'pets', label: '小球', singular: '小球', limit: 1, slotPageSize: 1, description: '选择一个出战小球。更换小球会清空已选技能和特性。' },
  { id: 'items', label: '道具', singular: '道具', limit: 3, slotPageSize: 3, description: '通用道具 · 最多携带 3 件，战斗中自动生效。' },
  { id: 'skills', label: '技能', singular: '技能', limit: 4, slotPageSize: 4, description: '技能槽位已保留，当前版本暂无可用技能。' },
  { id: 'traits', label: '特性', singular: '特性', limit: 1, slotPageSize: 1, description: '特性槽位已保留，当前版本暂无可用特性。' },
];
export function selectionLimit(categoryId: CategoryId): number {
  return LOADOUT_CATEGORIES.find(category => category.id === categoryId)!.limit;
}

export const BATTLE_LIMIT_MS = 5 * 60_000;
export const ARENA_SIZE = 420;
export const SIMULATION_STEP_MS = 10;

export interface PetEntry extends CatalogEntry { id: PetId; title: string; color: string; hp: number; attack: number; speed: number; radius: number; persona?: string; effects: { name: string; lines: string[] }[] }
export const PETS: PetEntry[] = [
  { id: 'hutao', effects: [{ name: '上嘴脸', lines: ['每 10 秒掷骰一次。', `1 点：回复 ${HUTAO_DICE_HEAL} 生命。`, `6 点：远程造成 ${HUTAO_SLAP_DAMAGE} 伤害。`, `2～5 点：自损 ${HUTAO_SELF_DAMAGE} 生命，可致死。`] }, { name: '忆往昔', lines: [`碰撞后生命 ≤${HUTAO_NOSTALGIA_THRESHOLD} 且存活，回复 ${HUTAO_NOSTALGIA_HEAL} 生命，每局 1 次。`] }], name: '胡涛', title: '嘴强王者 · 怀旧教练', description: `【上嘴脸】每 10 秒投掷 1 枚六面骰子：1 点恢复 ${HUTAO_DICE_HEAL} 点生命；6 点无视距离扇对手一巴掌，造成 ${HUTAO_SLAP_DAMAGE} 点伤害；2～5 点扣除自身 ${HUTAO_SELF_DAMAGE} 点生命，可以致死。特效骰子跟随自身翻滚后结算，回血不超过上限。【忆往昔】球体碰撞双方伤害结算后，首次仍存活且生命不高于 ${HUTAO_NOSTALGIA_THRESHOLD} 时，恢复 ${HUTAO_NOSTALGIA_HEAL} 点生命，每局一次，不超过上限；掷骰与巴掌不直接触发。`, persona: '戴眼镜，自诩健身教练，喜欢忆往昔、上嘴脸。一年只玩三款 Steam 游戏的游戏策划，喜欢鸣潮和二次元。吹嘘王者荣耀很厉害，实际上打不过低分匹配局。', color: '#e9e0c9', hp: 100, attack: 14, speed: 330, radius: 32, keywords: ['教练', '眼镜', '骰子', '上嘴脸', '忆往昔', '王者', '鸣潮', '回血', '远程', '巴掌'] },
  { id: 'chengzhiquan', effects: [{ name: '一天八顿', lines: [`生命 <${CHENG_MEAL_THRESHOLD} 时吃饭，${CHENG_MEAL_DURATION_MS / 1000} 秒后回复 ${CHENG_MEAL_HEAL} 生命；冷却 ${CHENG_MEAL_COOLDOWN_MS / 1000} 秒。`] }, { name: '那我不玩了', lines: [`免疫 1 次致死伤害，并无敌 ${CHENG_INVULNERABLE_MS / 1000} 秒，每局 1 次。`] }, { name: '我跟你爆了', lines: [`生命 ≤${CHENG_GRAPPLE_THRESHOLD} 时解锁飞扑，冷却 ${CHENG_GRAPPLE_COOLDOWN_MS / 1000} 秒。`, `双方定身 ${CHENG_BIND_DURATION_MS / 1000} 秒，每秒汲取 ${CHENG_DRAIN_DAMAGE} 生命。`] }], name: '程执权', title: '一天八顿 · 兄弟爆了', description: `【一天八顿】存活且生命小于 ${CHENG_MEAL_THRESHOLD} 时自动扒饭 ${CHENG_MEAL_DURATION_MS / 1000} 秒，结束恢复 ${CHENG_MEAL_HEAL} 点生命，冷却 ${CHENG_MEAL_COOLDOWN_MS / 1000} 秒，从开始扒饭计时，不限每局次数。【那我不玩了】受到致死伤害时完整免疫该次伤害，保留受击前生命，并无敌 ${CHENG_INVULNERABLE_MS / 1000} 秒，每局一次；无敌不免疫束缚。【我跟你爆了】首次存活且生命不高于 ${CHENG_GRAPPLE_THRESHOLD} 时永久解锁并立即施放，之后每隔 ${CHENG_GRAPPLE_COOLDOWN_MS / 1000} 秒快速飞到随机敌人身边，双方均被束缚 ${CHENG_BIND_DURATION_MS / 1000} 秒、不能移动；束缚期间每秒汲取 ${CHENG_DRAIN_DAMAGE} 点生命，共三次，自身恢复实际扣血量。被束缚时等待解除后再飞扑，回血不关闭解锁。回血不超过上限，死亡不能复活。`, persona: '183cm，120kg，戴眼镜，卷毛。超级爱吃，一天吃8顿。爱说“那我不玩了”“跟你爆了”“我们是最好的兄弟啊”。', color: '#d9b586', hp: 120, attack: 7, speed: 240, radius: 32, keywords: ['程执权', '卷毛', '眼镜', '吃饭', '八顿', '无敌', '保命', '束缚', '吸血', '汲取', '兄弟'] },
  { id: 'liangchushuo', effects: [{ name: '礼尚往来', lines: [`礼让：本次碰撞受到的伤害减少 ${LIANG_REDUCTION}。`, `回礼：下次碰撞造成的伤害增加 ${LIANG_RETURN_BONUS}。`, '开局礼让，每次碰撞交替。'] }], name: '梁楚烁', title: '礼数到位 · 回礼有劲', description: `【礼尚往来】开局处于礼让阶段：当次受到的球体碰撞总伤害减少 ${LIANG_REDUCTION}，最低为 0；下一次碰撞进入回礼阶段，当次自身球体碰撞伤害增加 ${LIANG_RETURN_BONUS}，随后切回礼让，循环交替。每次真实球体碰撞只推进一次；被免疫或眩晕未出手也推进，束缚贴身不重复触发。加减伤先于分期与免疫；远程、汲取、道具独立伤害及自损不享受效果，也不推进阶段。录像带不回溯阶段。礼让时说“没毛”或“那确实”，回礼时说“必须的”。`, persona: '190cm，120kg，戴眼镜，中分，很帅气。懂礼貌、懂礼节、会来事，爱说“没毛”“那确实”“必须的”。身高体重不直接换算战斗属性。', color: '#f3ebdc', hp: 100, attack: 10, speed: 300, radius: 32, keywords: ['梁楚烁', '中分', '眼镜', '帅气', '礼让', '回礼', '礼尚往来', '减伤', '没毛', '那确实', '必须的'] },
];

export const ITEMS: (CatalogEntry & { id: ItemId; symbol: string })[] = ITEM_DEFINITIONS.map(entry => ({ ...entry, keywords: [...entry.keywords] }));
export interface SkillEntry extends CatalogEntry { id: SkillId; petId: PetId }
export const SKILLS: SkillEntry[] = [];
export interface TraitEntry extends CatalogEntry { id: TraitId; petId: PetId }
export const TRAITS: TraitEntry[] = [];

export function getCategoryOptions(categoryId: CategoryId, petId: PetId): CatalogEntry[] {
  switch (categoryId) {
    case 'pets': return PETS;
    case 'items': return ITEMS;
    case 'skills': return SKILLS.filter(entry => entry.petId === petId);
    case 'traits': return TRAITS.filter(entry => entry.petId === petId);
  }
}
export function getSelection(loadout: Loadout, categoryId: CategoryId): string[] {
  switch (categoryId) {
    case 'pets': return [loadout.petId];
    case 'items': return [...loadout.items];
    case 'skills': return [...loadout.skills];
    case 'traits': return loadout.traitId === null ? [] : [loadout.traitId];
  }
}
export function cloneLoadout(loadout: Loadout): Loadout {
  return { petId: loadout.petId, items: [...loadout.items], skills: [...loadout.skills], traitId: loadout.traitId };
}
export function validateLoadout(loadout: Loadout): boolean {
  if (!loadout || !Array.isArray(loadout.items) || !Array.isArray(loadout.skills)
    || !(loadout.traitId === null || typeof loadout.traitId === 'string')
    || Object.keys(loadout).some(key => !['petId', 'items', 'skills', 'traitId'].includes(key))) return false;
  return LOADOUT_CATEGORIES.every(category => {
    const ids = getSelection(loadout, category.id);
    const available = getCategoryOptions(category.id, loadout.petId);
    return ids.length <= category.limit && new Set(ids).size === ids.length && ids.every(id => available.some(entry => entry.id === id));
  });
}
export function withCategorySelection(loadout: Loadout, categoryId: CategoryId, ids: string[]): Loadout {
  const next = cloneLoadout(loadout);
  if (ids.length > selectionLimit(categoryId) || new Set(ids).size !== ids.length || ids.some(id => !getCategoryOptions(categoryId, next.petId).some(entry => entry.id === id))) {
    throw new Error('选择超过槽位上限，或不属于当前小球的可用内容。');
  }
  switch (categoryId) {
    case 'pets':
      if (ids.length !== 1) throw new Error('需要选择一个小球。');
      if (next.petId !== ids[0]) { next.skills = []; next.traitId = null; }
      next.petId = ids[0] as PetId; break;
    case 'items': next.items = [...ids]; break;
    case 'skills': next.skills = [...ids]; break;
    case 'traits': next.traitId = ids[0] ?? null; break;
  }
  return next;
}
export function createDefaultLoadout(): Loadout {
  return { petId: 'hutao', items: [], skills: [], traitId: null };
}
