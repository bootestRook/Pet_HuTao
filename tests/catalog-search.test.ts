import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalog } from '../client/catalog-search.js';
import { ITEMS, LOADOUT_CATEGORIES, PETS, SKILLS, TRAITS, createDefaultLoadout, getCategoryOptions, getSelection, selectionLimit, validateLoadout, withCategorySelection } from '../shared/catalog.js';

// Search fixtures are independent of the playable catalogs.
const catalog = [
  { id: 'potion', name: '急救药瓶', description: '生命低于 35% 时恢复 40 点，每局一次。', keywords: ['回血', '治疗'] },
  { id: 'boots', name: '轻羽靴', description: '出手间隔缩短 10%。', keywords: ['速度', '攻速'] },
  { id: 'shield', name: '护心镜', description: '开局获得 30 点护盾。', keywords: ['防御'] },
  { id: 'fang', name: '勇气獠牙', description: '生命低于一半时攻击增加 30%。' },
];

test('the playable catalog contains three balls, fourteen items and two empty expansion systems without weapons', () => {
  assert.deepEqual(PETS.map(pet => pet.id), ['hutao', 'chengzhiquan', 'liangchushuo']);
  assert.deepEqual(LOADOUT_CATEGORIES.map(category => category.id), ['pets', 'items', 'skills', 'traits']);
  const loadout = createDefaultLoadout();
  assert.equal('weaponId' in loadout, false);
  assert.equal(validateLoadout(loadout), true);
  assert.equal(validateLoadout({ ...loadout, items: ['shield'] }), false);
  assert.equal(validateLoadout({ ...loadout, skills: ['cat-scratch'] }), false);
  assert.equal(validateLoadout({ ...loadout, traitId: 'fox-critical' }), false);
  assert.equal(ITEMS.length, 14);
  assert.equal(new Set(ITEMS.map(item => item.id)).size, 14);
  for (const pet of PETS) {
    assert.equal(getCategoryOptions('items', pet.id).length, 14);
    assert.equal(validateLoadout({ ...loadout, petId: pet.id, items: ITEMS.slice(0, 3).map(item => item.id) }), true);
  }
  assert.equal(validateLoadout({ ...loadout, items: ITEMS.map(item => item.id) }), false);
  assert.equal(validateLoadout({ ...loadout, items: ['banana-peel', 'banana-peel'] }), false);
  assert.equal(validateLoadout({ ...loadout, items: ['last-fireworks'] }), false);
  for (const category of ['skills', 'traits'] as const) {
    assert.deepEqual(getCategoryOptions(category, 'hutao'), []);
    assert.deepEqual(getCategoryOptions(category, 'chengzhiquan'), []);
    assert.deepEqual(getCategoryOptions(category, 'liangchushuo'), []);
    assert.deepEqual(getSelection(loadout, category), []);
    assert.deepEqual(searchCatalog(getCategoryOptions(category, 'hutao'), '回血'), []);
    assert.ok(selectionLimit(category) > 0);
    assert.throws(() => withCategorySelection(loadout, category, ['unavailable-entry']));
  }
  assert.deepEqual(searchCatalog(PETS, '回春'), []);
  assert.equal(selectionLimit('items'), 3);
  assert.equal(validateLoadout({ ...loadout, items: ITEMS.slice(0, 4).map(item => item.id) }), false);
  for (const petId of ['charge', 'renew']) assert.equal(validateLoadout({ ...loadout, petId } as unknown as typeof loadout), false);
  assert.deepEqual(searchCatalog(PETS, '上嘴脸').map(entry => entry.id), ['hutao']);
  assert.equal(validateLoadout(withCategorySelection(loadout, 'pets', ['hutao'])), true);
  assert.equal(validateLoadout(withCategorySelection(loadout, 'pets', ['chengzhiquan'])), true);
  assert.deepEqual(searchCatalog(PETS, '程执权').map(entry => entry.id), ['chengzhiquan']);
  assert.equal(validateLoadout(withCategorySelection(loadout, 'pets', ['liangchushuo'])), true);
  for (const query of ['梁楚烁', '中分', '没毛', '礼尚往来']) assert.deepEqual(searchCatalog(PETS, query).map(entry => entry.id), ['liangchushuo']);
});

test('optional systems still support selecting, replacing, removing and clearing ball-specific fixture entries', () => {
  // Temporary catalog metadata verifies the retained selection system; none is shipped as game content.
  const originalItems = [...ITEMS]; const originalSkills = [...SKILLS]; const originalTraits = [...TRAITS];
  try {
    ITEMS.push(...Array.from({ length: selectionLimit('items') + 1 }, (_, index) => ({
      id: `fixture-item-${index}`, name: `测试道具 ${index}`, description: '仅用于选装测试。', symbol: '◇',
    })));
    SKILLS.push(...Array.from({ length: selectionLimit('skills') + 1 }, (_, index) => ({
      id: `fixture-hutao-skill-${index}`, petId: 'hutao' as const, name: `测试技能 ${index}`, description: '仅用于选装测试。',
    })));
    TRAITS.push({ id: 'fixture-hutao-trait', petId: 'hutao', name: '测试特性', description: '仅用于选装测试。' });

    const initial = createDefaultLoadout();
    const selected = withCategorySelection(initial, 'items', ['fixture-item-0', 'fixture-item-1']);
    assert.deepEqual(initial.items, []);
    assert.deepEqual(selected.items, ['fixture-item-0', 'fixture-item-1']);
    const replaced = withCategorySelection(selected, 'items', ['fixture-item-2', 'fixture-item-1']);
    assert.deepEqual(replaced.items, ['fixture-item-2', 'fixture-item-1']);
    const removed = withCategorySelection(replaced, 'items', ['fixture-item-2']);
    assert.deepEqual(removed.items, ['fixture-item-2']);
    assert.throws(() => withCategorySelection(initial, 'items', ['fixture-item-0', 'fixture-item-0']));
    assert.throws(() => withCategorySelection(initial, 'items', ITEMS.map(item => item.id)));

    assert.throws(() => withCategorySelection(initial, 'skills', SKILLS.map(skill => skill.id)));
    assert.throws(() => withCategorySelection(initial, 'skills', ['fixture-hutao-skill-0', 'fixture-hutao-skill-0']));
    assert.throws(() => withCategorySelection(initial, 'traits', ['fixture-hutao-trait', 'fixture-hutao-trait']));
    const withSkill = withCategorySelection(removed, 'skills', ['fixture-hutao-skill-0']);
    const withTrait = withCategorySelection(withSkill, 'traits', ['fixture-hutao-trait']);
    assert.equal(validateLoadout(withTrait), true);
    const switched = withCategorySelection(withTrait, 'pets', ['liangchushuo']);
    assert.deepEqual(switched.items, ['fixture-item-2']);
    assert.deepEqual(switched.skills, []);
    assert.equal(switched.traitId, null);
    assert.throws(() => withCategorySelection(switched, 'skills', ['fixture-hutao-skill-0']));
    assert.throws(() => withCategorySelection(switched, 'traits', ['fixture-hutao-trait']));
  } finally {
    ITEMS.splice(0, ITEMS.length, ...originalItems);
    SKILLS.splice(0, SKILLS.length, ...originalSkills);
    TRAITS.splice(0, TRAITS.length, ...originalTraits);
  }
});

test('empty search preserves catalog order and item identity without returning the input array', () => {
  const result = searchCatalog(catalog, '　 \n ');
  assert.deepEqual(result, catalog);
  assert.notEqual(result, catalog);
  assert.equal(result[0], catalog[0]);
});

test('search finds partial Chinese names, effect text and explicit keyword aliases', () => {
  assert.deepEqual(searchCatalog(catalog, '药瓶').map(entry => entry.id), ['potion']);
  assert.deepEqual(searchCatalog(catalog, '缩短').map(entry => entry.id), ['boots']);
  assert.deepEqual(searchCatalog(catalog, '回血').map(entry => entry.id), ['potion']);
  assert.deepEqual(searchCatalog(catalog, '生命').map(entry => entry.id).sort(), ['fang', 'potion']);
});

test('one typo in longer names works while short Chinese queries remain conservative', () => {
  assert.equal(searchCatalog(catalog, '急救药平')[0]?.id, 'potion');
  assert.deepEqual(searchCatalog(catalog, '药平'), []);
  assert.deepEqual(searchCatalog(catalog, '不存在的效果'), []);
});

test('normalization handles case, full-width characters and spaces, and terms intersect across fields', () => {
  const entries = [{ id: 'sword', name: 'ＡＢＣ 剑', description: '恢复 HP 10 点。' }];
  assert.deepEqual(searchCatalog(entries, ' abc　 hp  ').map(entry => entry.id), ['sword']);
  assert.deepEqual(searchCatalog(catalog, '药瓶 恢复').map(entry => entry.id), ['potion']);
  assert.deepEqual(searchCatalog(catalog, '药瓶 护盾'), []);
});

test('effects remain searchable late in long descriptions and names receive higher weight', () => {
  const entries = [
    { id: 'effect', name: '旧木箱', description: `${'普通背景说明。'.repeat(30)}急救药瓶` },
    { id: 'name', name: '急救药瓶', description: '缓慢恢复生命。' },
    { id: 'long', name: '星云石', description: `${'普通背景说明。'.repeat(30)}冰霜防护` },
  ];
  assert.equal(searchCatalog(entries, '急救药瓶')[0]?.id, 'name');
  assert.deepEqual(searchCatalog(entries, '冰霜').map(entry => entry.id), ['long']);
});

test('a 3000-entry fixture filters before pagination without losing results between pages', () => {
  const entries = Array.from({ length: 3000 }, (_, index) => ({
    id: `fixture-${index}`,
    name: `测试道具 ${index}`,
    description: index % 10 === 0 ? '开局获得护盾。' : '提升攻击。',
  }));
  const result = searchCatalog(entries, '护盾');
  assert.equal(result.length, 300);
  const pages = Array.from({ length: Math.ceil(result.length / 12) }, (_, page) => result.slice(page * 12, (page + 1) * 12));
  assert.equal(pages[0].length, 12);
  assert.equal(pages.at(-1)!.length, 12);
  assert.equal(new Set(pages.flat().map(entry => entry.id)).size, 300);
  assert.deepEqual(searchCatalog(entries, '不存在'), []);
  assert.equal(searchCatalog(entries, '').length, 3000);
});
