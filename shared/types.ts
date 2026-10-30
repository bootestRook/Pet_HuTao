export type PetId = 'hutao' | 'chengzhiquan' | 'liangchushuo';
// Catalogs remain the source of truth for valid optional selections.
export type ItemId = string;
export type SkillId = string;
export type TraitId = string;
export type CategoryId = 'pets' | 'items' | 'skills' | 'traits';
export interface Loadout { petId: PetId; items: ItemId[]; skills: SkillId[]; traitId: TraitId | null }
export interface PlayerInfo { id: string; name: string; connected: boolean; ready: boolean; rematch: boolean; loadout: Loadout }
export const PLAYER_CAPACITY = 2;
export const SPECTATOR_CAPACITY = 8;
export type SeatRole = 'player' | 'spectator';
export interface SpectatorInfo { id: string; name: string; connected: boolean }
export type DiceOutcome = 'heal' | 'slap' | 'self-damage';
export interface HutaoRoll { startedAtMs: number; value: number; outcome: DiceOutcome; quote: string; resolved: boolean }
export interface ChengDash { targetId: string; startedAtMs: number; fromX: number; fromY: number; toX: number; toY: number; paired: boolean }
export interface ChengGrapple { targetId: string; startedAtMs: number; ticks: number }
export type LiangPhase = 'yield' | 'return';
export interface LiangState { phase: LiangPhase; contact: { phase: LiangPhase; timeMs: number; quote: string } | null }
export interface ChengState {
  mealStartedAtMs: number | null; nextMealAtMs: number; meals: number;
  survivalUsed: boolean; invulnerableUntilMs: number;
  grappleUnlocked: boolean; nextGrappleAtMs: number; dash: ChengDash | null; grapple: ChengGrapple | null;
}
export interface RewindPosition { x: number; y: number; vx: number; vy: number }
export interface DamageDebt { sourceId: string; remaining: number; ticksLeft: number; nextAtMs: number; reflectable: boolean }
export interface FighterItemsState {
  equipped: ItemId[]; slipUntilMs: number; pumpedUntilMs: number;
  nextTeleportAtMs: number; teleportStartedAtMs: number | null;
  nextPumpAtMs: number; nextPearlsAtMs: number;
  refundAmount: number; refundExpiresAtMs: number; nextRefundAtMs: number;
  debts: DamageDebt[]; rewindUsed: boolean; rewindPosition: RewindPosition | null;
  positionRevision: number;
  nextTicketAtMs: number; ticketRolls: number; ticketWins: number;
  staffAwakened: boolean; ascended: boolean; nextRegenAtMs: number;
}
export interface BananaState { id: number; ownerId: string; x: number; y: number; expiresAtMs: number; armed: boolean }
export interface PunchState { id: number; ownerId: string; x: number; y: number; originX: number; originY: number; dx: number; dy: number; launchAtMs: number }
export interface PearlState { id: number; ownerId: string; x: number; y: number; expiresAtMs: number }
export interface BombState { id: number; ownerId: string; holderId: string; explodesAtMs: number }
export interface ItemFieldState { bananas: BananaState[]; punches: PunchState[]; pearls: PearlState[]; bombs: BombState[] }
export type WorldEffectId = 'divine-scale' | 'falling-junk' | 'green-meadow' | 'lucky-jackpot';
export type JackpotReward = 'invincible' | 'heal' | 'damage';
export interface WorldFighterState { stunnedUntilMs: number; invulnerableUntilMs: number; damageBonus: number }
export interface FallingJunk { id: number; x: number; y: number; landsAtMs: number }
export interface WorldEffectState {
  id: WorldEffectId; nextAtMs: number; scaleRemainingMs: number; pulseAtMs: number | null;
  debris: FallingJunk[];
  prize: { x: number; y: number; spawnedAtMs: number; expiresAtMs: number } | null;
  prizeWinnerId: string | null; prizeReward: JackpotReward | null;
}
export interface FighterState {
  id: string; name: string; petId: PetId; hp: number; maxHp: number;
  x: number; y: number; vx: number; vy: number; radius: number;
  wallBounces: number; damageDealt: number; healing: number; hits: number;
  nostalgiaUsed: boolean; diceRoll: HutaoRoll | null;
  cheng: ChengState | null; boundUntilMs: number;
  liang: LiangState | null;
  items: FighterItemsState;
  world: WorldFighterState;
}
export interface BattleState { elapsedMs: number; fighters: FighterState[]; field: ItemFieldState; world: WorldEffectState; finished: boolean; winnerId: string | null; draw: boolean }
export type BattleEffect = 'liang-yield' | 'liang-return' | 'nostalgia' | 'meal' | 'survival' | 'drain' | 'banana' | 'toilet' | 'punch' | 'pump' | 'bomb' | 'installment' | 'refund' | 'pearl' | 'rewind' | 'lucky-ticket' | 'staff' | 'thorns' | 'ascension' | 'regen' | WorldEffectId;
export type DamageKind = 'attack' | 'slap' | 'self-damage' | 'drain' | 'item-damage' | 'installment' | 'refund' | 'arena-damage' | 'combo' | 'reflection';
export interface BattleEvent { seq: number; timeMs: number; kind: DamageKind | 'courtesy' | 'heal' | 'roll' | 'meal' | 'survive' | 'immune' | 'awaken' | 'dash' | 'bind' | 'release' | 'item' | 'rewind' | 'world' | 'balance' | 'stun' | 'reward' | 'end'; sourceId: string; targetId: string; amount: number; text: string; x: number; y: number; effect?: BattleEffect }
export interface RoomSnapshot { roomId: string; phase: 'waiting' | 'countdown' | 'battle' | 'finished'; players: PlayerInfo[]; spectators: SpectatorInfo[]; availablePlayerSeats: number; serverTime: number; startAt: number; matchId: string; battle: BattleState | null; events: BattleEvent[] }
export interface ServerInfo { publicUrl: string | null; localUrls: string[]; version: string }
