/** First playable item set. Rules are shared by catalog copy, simulation and art. */
export const ITEM_RULES = {
  banana: { bounces: 3, lifetimeMs: 20_000, radius: 12, slipMs: 1000, speedMultiplier: 2 },
  toilet: { intervalMs: 10_000, warningMs: 500 },
  punch: { bounces: 4, warningMs: 700, speed: 600, radius: 14, damage: 12, knockback: 24 },
  pump: { intervalMs: 12_000, durationMs: 4000, radiusMultiplier: 1.5, speedMultiplier: 0.75 },
  bomb: { fuseMs: 20_000, damage: 30 },
  installment: { ticks: 4, intervalMs: 1000 },
  refund: { windowMs: 3000, cooldownMs: 10_000 },
  pearl: { intervalMs: 20_000, count: 3, lifetimeMs: 10_000, radius: 9, healRatio: 0.15 },
  rewind: { threshold: 10, historyMs: 3000 },
  ticket: { intervalMs: 7000, winChance: 0.01 },
  staff: { collisionBonus: 3, awakenChance: 0.01, maxExtraHits: 5 },
  thorns: { damage: 2, speedMultiplier: 0.75 },
  ascension: { atMs: 180_000, hpMultiplier: 1.5, speedMultiplier: 1.5, damageBonus: 2 },
  regen: { intervalMs: 5000, heal: 2 },
} as const;

export const ITEM_DEFINITIONS = [
  { id: 'banana-peel', name: '香蕉皮', symbol: 'banana', title: '自己也会踩的陷阱', description: `每撞墙 ${ITEM_RULES.banana.bounces} 次留下香蕉皮，保留 ${ITEM_RULES.banana.lifetimeMs / 1000} 秒；踩中后移速 ×${ITEM_RULES.banana.speedMultiplier}，持续 ${ITEM_RULES.banana.slipMs / 1000} 秒，自己也会踩中。`, keywords: ['陷阱', '打滑', '加速', '撞墙', '香蕉'] },
  { id: 'emergency-toilet', name: '紧急传送马桶', symbol: 'toilet', title: '冲走以后再说', description: `每 ${ITEM_RULES.toilet.intervalMs / 1000} 秒传送到随机角落，预告 ${ITEM_RULES.toilet.warningMs / 1000} 秒。`, keywords: ['传送', '位移', '马桶', '随机', '逃跑'] },
  { id: 'wall-punch', name: '墙里有拳', symbol: 'punch', title: '墙壁突然动手', description: `每撞墙 ${ITEM_RULES.punch.bounces} 次发射拳套；预告 ${ITEM_RULES.punch.warningMs / 1000} 秒，命中造成 ${ITEM_RULES.punch.damage} 伤害并击退，自己也会中招。`, keywords: ['拳套', '弹簧', '投射物', '撞墙', '击退'] },
  { id: 'overinflator', name: '过度充气泵', symbol: 'pump', title: '膨胀得很实在', description: `每 ${ITEM_RULES.pump.intervalMs / 1000} 秒充气：半径 +50%，移速 −25%，持续 ${ITEM_RULES.pump.durationMs / 1000} 秒。`, keywords: ['变大', '体型', '膨胀', '减速', '碰撞'] },
  { id: 'bomb-parcel', name: '到付炸弹快递', symbol: 'bomb', title: '谁拿着谁签收', description: `开局获得 ${ITEM_RULES.bomb.fuseMs / 1000} 秒炸弹，碰撞时转交对方；倒计时不重置，爆炸造成 ${ITEM_RULES.bomb.damage} 点伤害。`, keywords: ['炸弹', '快递', '转交', '倒计时', '爆炸'] },
  { id: 'pain-installment', name: '痛觉分期合同', symbol: 'contract', title: '痛可以晚点到', description: `敌方伤害的 50% 立即扣除（向上取整）；余下分 ${ITEM_RULES.installment.ticks} 期，每 ${ITEM_RULES.installment.intervalMs / 1000} 秒扣 1 期，可致死。`, keywords: ['分期', '延迟', '欠款', '伤害', '账单'] },
  { id: 'refund-code', name: '七天无理由退货码', symbol: 'refund', title: '挨打记得开发票', description: `受伤后 ${ITEM_RULES.refund.windowMs / 1000} 秒内再次碰撞，向对方返还本次即时扣血；冷却 ${ITEM_RULES.refund.cooldownMs / 1000} 秒。`, keywords: ['反伤', '退货', '条形码', '碰撞', '伤害'] },
  { id: 'pearl-cup', name: '奶茶漏珠杯', symbol: 'pearl', title: '全场共享加料', description: `每 ${ITEM_RULES.pearl.intervalMs / 1000} 秒生成 ${ITEM_RULES.pearl.count} 颗珍珠，保留 ${ITEM_RULES.pearl.lifetimeMs / 1000} 秒；任意缺血小球拾取后，回复最大生命的 15%。`, keywords: ['奶茶', '珍珠', '回血', '治疗', '拾取', '共享'] },
  { id: 'rewind-tape', name: '后悔药录像带', symbol: 'rewind', title: '这段重新来过', description: `受伤后仍存活且生命 <${ITEM_RULES.rewind.threshold}，回到 ${ITEM_RULES.rewind.historyMs / 1000} 秒前的生命、位置和方向；每局 1 次，不能复活。`, keywords: ['倒带', '回溯', '低血', '回血', '位移', '录像带'] },
  { id: 'lucky-ticket', name: '好运奖券', symbol: 'ticket', title: '下次一定中', description: `每 ${ITEM_RULES.ticket.intervalMs / 1000} 秒开奖：1% 概率回满生命，99% 概率只放烟花。`, keywords: ['好运', '奖券', '概率', '满血', '烟花', '回血'] },
  { id: 'plain-club', name: '朴实无华的大棒', symbol: 'club', title: '偶尔不那么朴实', description: `碰撞伤害 +${ITEM_RULES.staff.collisionBonus}；开局 1% 概率升华，每次碰撞追加 1～${ITEM_RULES.staff.maxExtraHits} 段伤害。`, keywords: ['大棒', '混元紫金棍', '升华', '多段', '连击', '碰撞', '伤害'] },
  { id: 'thorn-armor', name: '反伤刺甲', symbol: 'thorns', title: '扎到谁算谁的', description: `移速 −25%；受到实际伤害后，向来源反弹 ${ITEM_RULES.thorns.damage} 点伤害，反伤不连锁。`, keywords: ['反伤', '刺甲', '减速', '自损', '伤害'] },
  { id: 'ascension-charm', name: '飞升护符', symbol: 'ascension', title: '熬到三分钟就飞升', description: `战斗满 ${ITEM_RULES.ascension.atMs / 1000} 秒后飞升：生命上限 +50% 并回满，移速 +50%，伤害 +${ITEM_RULES.ascension.damageBonus}。`, keywords: ['飞升', '180秒', '生命上限', '满血', '移速', '伤害'] },
  { id: 'healing-orb', name: '回血宝珠', symbol: 'orb', title: '滴水也能续命', description: `每 ${ITEM_RULES.regen.intervalMs / 1000} 秒回复 ${ITEM_RULES.regen.heal} 生命，不超过上限。`, keywords: ['回血', '宝珠', '治疗', '恢复', '持续'] },
] as const;

export type PlayableItemId = typeof ITEM_DEFINITIONS[number]['id'];
