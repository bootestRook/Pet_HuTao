export type PetId = 'charge' | 'renew';
// Empty catalogs remain the source of truth for valid optional selections.
export type ItemId = string;
export type SkillId = string;
export type TraitId = string;
export type CategoryId = 'pets' | 'items' | 'skills' | 'traits';
export interface Loadout { petId: PetId; items: ItemId[]; skills: SkillId[]; traitId: TraitId | null }
export interface PlayerInfo { id: string; name: string; connected: boolean; ready: boolean; rematch: boolean; loadout: Loadout }
export type RoomMode = 'duel' | 'spectator';
export interface SpectatorInfo { id: string; name: string; connected: boolean }
export interface FighterState {
  id: string; name: string; petId: PetId; hp: number; maxHp: number;
  x: number; y: number; vx: number; vy: number; radius: number;
  charge: number; wallBounces: number; damageDealt: number; healing: number; hits: number;
}
export interface BattleState { elapsedMs: number; fighters: FighterState[]; finished: boolean; winnerId: string | null; draw: boolean }
export interface BattleEvent { seq: number; timeMs: number; kind: 'attack' | 'charge' | 'heal' | 'end'; sourceId: string; targetId: string; amount: number; text: string; x: number; y: number }
export interface RoomSnapshot { roomId: string; mode: RoomMode; host: SpectatorInfo | null; phase: 'waiting' | 'countdown' | 'battle' | 'finished'; players: PlayerInfo[]; serverTime: number; startAt: number; matchId: string; battle: BattleState | null; events: BattleEvent[] }
export interface ServerInfo { publicUrl: string | null; localUrls: string[]; version: string }
