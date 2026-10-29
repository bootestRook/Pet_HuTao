import type { CategoryId, ItemId, Loadout, PetId, SkillId, TraitId } from './types.js';

export interface CatalogEntry { id: string; name: string; description: string; title?: string; keywords?: string[] }
export interface LoadoutCategory { id: CategoryId; label: string; singular: string; limit: number; slotPageSize: number; description: string }
/** Selection and slot systems remain available even when their content catalogs are empty. */
export const LOADOUT_CATEGORIES: LoadoutCategory[] = [
  { id: 'pets', label: '小球', singular: '小球', limit: 1, slotPageSize: 1, description: '选择一个出战小球。更换小球会清空已选技能和特性。' },
  { id: 'items', label: '道具', singular: '道具', limit: 8, slotPageSize: 4, description: '道具槽位已保留，当前版本暂无可用道具。' },
  { id: 'skills', label: '技能', singular: '技能', limit: 4, slotPageSize: 4, description: '技能槽位已保留，当前版本暂无可用技能。' },
  { id: 'traits', label: '特性', singular: '特性', limit: 1, slotPageSize: 1, description: '特性槽位已保留，当前版本暂无可用特性。' },
];
export function selectionLimit(categoryId: CategoryId): number {
  return LOADOUT_CATEGORIES.find(category => category.id === categoryId)!.limit;
}

export const BATTLE_LIMIT_MS = 5 * 60_000;
export const ARENA_SIZE = 420;
export const SIMULATION_STEP_MS = 10;
export const CHARGE_PER_BOUNCE = 2;
export const MAX_CHARGE = 8;
export const HEAL_ON_CONTACT = 6;

export interface PetEntry extends CatalogEntry { id: PetId; title: string; color: string; hp: number; attack: number; speed: number; radius: number }
export const PETS: PetEntry[] = [
  { id: 'charge', name: '蓄力球', title: '撞墙蓄力 · 碰撞释放', description: `每次撞墙使下一次碰撞伤害增加 ${CHARGE_PER_BOUNCE} 点，最多累积 ${MAX_CHARGE} 点；碰撞命中后清空蓄力。`, color: '#ed795b', hp: 100, attack: 10, speed: 300, radius: 32, keywords: ['攻击', '蓄力', '撞墙', '爆发'] },
  { id: 'renew', name: '回春球', title: '碰撞回血 · 持续作战', description: `每次与对手碰撞，双方伤害结算后若仍存活，恢复 ${HEAL_ON_CONTACT} 点生命，不超过生命上限。`, color: '#63cbb6', hp: 100, attack: 10, speed: 300, radius: 32, keywords: ['回血', '治疗', '回复', '恢复'] },
];

export const ITEMS: (CatalogEntry & { id: ItemId; symbol: string })[] = [];
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
  return { petId: 'charge', items: [], skills: [], traitId: null };
}
