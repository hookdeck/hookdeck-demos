/**
 * The quest, as code state. Old Bram's lighthouse went dark in the storm, and only the Lantern of Hollow Mere can relight it.
 *
 *   tavern  the stranger's map (takeable); a small iron chest, locked
 *   forest  the hollow oak, with a small brass key on a root shelf inside (takeable)
 *   cave    the Lantern on a stone ledge, unlit (takeable); a boat
 *   finale  back at the lighthouse: the chest opens with the key and holds flint and a wick; lighting the lantern ends the quest
 *
 * Where each item is, what the party carries (one satchel per room, shared by everyone) and which puzzles are solved live here,
 * so they can be tested without a model and saved with the rest of the story state. The tools check against this and answer with
 * a short factual reason when something cannot be done; Bram only narrates the answer.
 */

export type ItemId = 'map' | 'brass_key' | 'lantern' | 'flint_and_wick';

export interface ItemDef {
  id: ItemId;
  /** How Bram and the page name it. */
  label: string;
  /** The scene (1 based, as scene_index) where it is found. */
  scene: number;
  /** Words a model might use for it. */
  aliases: string[];
}

export const ITEMS: readonly ItemDef[] = [
  { id: 'map', label: 'the salt-stained map', scene: 1, aliases: ['map', 'salt-stained map', 'the map'] },
  { id: 'brass_key', label: 'the small brass key', scene: 2, aliases: ['key', 'brass key', 'small brass key', 'the key'] },
  { id: 'lantern', label: 'the Lantern of Hollow Mere', scene: 3, aliases: ['lantern', 'the lantern', 'lantern of hollow mere', 'lamp'] },
  { id: 'flint_and_wick', label: 'the flint and wick', scene: 4, aliases: ['flint', 'wick', 'flint and wick', 'the flint', 'the wick'] },
];

/** The scenes (1 based) that have the iron chest in them: the tavern, and the lighthouse at the end. */
export const CHEST_SCENES = [1, 4];
export const FINALE_SCENE = 4;

export interface QuestState {
  satchel: ItemId[];
  chest_open: boolean;
  lantern_lit: boolean;
}

export const newQuest = (): QuestState => ({ satchel: [], chest_open: false, lantern_lit: false });

/** Test mode (STORY_SHORT=1): the party already carries what it needs to reach and finish the finale. */
export const shortModeQuest = (): QuestState => ({ satchel: ['map', 'brass_key', 'lantern'], chest_open: false, lantern_lit: false });

export const goalDone = (q: QuestState) => q.lantern_lit;

export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);

/** Maps what a model wrote ("brass key", "the Lantern") to an item id. */
export function normalizeItem(text: string): ItemId | 'chest' | undefined {
  const t = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an|my|our) /, '');
  if (/\bchest\b|\bbox\b/.test(t)) return 'chest';
  for (const item of ITEMS) {
    if (item.id.replace(/_/g, ' ') === t || item.aliases.includes(t) || item.aliases.includes(`the ${t}`)) return item.id;
  }
  if (/\bflint\b|\bwick\b/.test(t)) return 'flint_and_wick';
  if (/\bkey\b/.test(t)) return 'brass_key';
  if (/\blantern\b/.test(t)) return 'lantern';
  if (/\bmap\b/.test(t)) return 'map';
  return undefined;
}

export interface ItemResult {
  ok: boolean;
  /** For the model: a factual sentence to narrate. */
  message: string;
  event?: 'took' | 'opened' | 'lit';
}

/** Items lying in a scene that nobody has taken, and are visible (the flint and wick only once the chest is open). */
export function itemsHere(q: QuestState, scene_index: number): ItemDef[] {
  return ITEMS.filter((i) => i.scene === scene_index && !q.satchel.includes(i.id) && (i.id !== 'flint_and_wick' || q.chest_open));
}

export function takeItem(q: QuestState, scene_index: number, raw: string): ItemResult {
  const id = normalizeItem(raw);
  if (id === 'chest') return { ok: false, message: 'The iron chest is far too heavy to take. It stays where it is.' };
  const item = id ? itemById(id) : undefined;
  if (!item) return { ok: false, message: `There is no "${raw}" here that can be taken.` };
  if (q.satchel.includes(item.id)) return { ok: false, message: `${cap(item.label)} is already in the satchel.` };
  if (item.id === 'flint_and_wick' && scene_index === FINALE_SCENE && !q.chest_open) return { ok: false, message: 'The chest is still locked: there is nothing to take out of it.' };
  if (item.scene !== scene_index) return { ok: false, message: `${cap(item.label)} is not in this place.` };
  q.satchel.push(item.id);
  return { ok: true, event: 'took', message: `The party takes ${item.label}. It is in the satchel now.` };
}

export function useItem(q: QuestState, scene_index: number, raw_item: string, raw_target: string): ItemResult {
  const a = normalizeItem(raw_item);
  const b = normalizeItem(raw_target);
  const chest_here = CHEST_SCENES.includes(scene_index);
  const pair = (x: string, y: string) => (a === x && b === y) || (a === y && b === x);
  const carrying = (id: ItemId) => q.satchel.includes(id);
  const named = (id: string | undefined) => (id && id !== 'chest' ? itemById(id)?.label : undefined) ?? raw_item;

  // The key on the chest
  if (pair('brass_key', 'chest')) {
    if (!chest_here) return { ok: false, message: 'There is no chest in this place.' };
    if (!carrying('brass_key')) return { ok: false, message: 'The chest is locked and does not open without a key. The party has no key.' };
    if (q.chest_open) return { ok: false, message: 'The chest is already open.' };
    q.chest_open = true;
    return { ok: true, event: 'opened', message: 'The brass key turns and the chest opens. Inside lie flint and a wick, now in plain sight.' };
  }
  if (a === 'chest' || b === 'chest') {
    if (!chest_here) return { ok: false, message: 'There is no chest in this place.' };
    return { ok: false, message: 'The chest is locked and does not open that way. It needs a key.' };
  }
  // Lighting the lantern
  if (pair('lantern', 'flint_and_wick')) {
    if (!carrying('lantern')) return { ok: false, message: 'The party is not carrying the Lantern.' };
    if (!carrying('flint_and_wick')) return { ok: false, message: 'There is nothing to light it with: the party has no flint and wick.' };
    if (scene_index !== FINALE_SCENE) return { ok: false, message: 'This is not the place to light the Lantern. It must be lit at the lighthouse.' };
    if (q.lantern_lit) return { ok: false, message: 'The Lantern is already lit.' };
    q.lantern_lit = true;
    return { ok: true, event: 'lit', message: 'The wick catches. The Lantern is lit and the lighthouse lamp blazes: the quest is done.' };
  }
  if (a && !carrying(a)) return { ok: false, message: `${cap(named(a))} is not in the satchel.` };
  return { ok: false, message: 'Nothing happens: that does not work here.' };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What Bram is told each turn: what lies here untaken, what the party carries, and the open puzzle. Describe-don't-direct. */
export function questNote(q: QuestState, scene_index: number): string {
  const here = itemsHere(q, scene_index);
  const carried = q.satchel.map((id) => itemById(id)!.label);
  const parts: string[] = [];
  parts.push(here.length ? `In this place, not yet taken: ${here.map((i) => i.label).join('; ')}. Describe each where it lies and never tell the players to take it.` : 'Nothing here is left to take.');
  parts.push(`In the satchel: ${carried.length ? carried.join('; ') : 'nothing'}.`);
  const chest_here = CHEST_SCENES.includes(scene_index);
  if (q.lantern_lit) parts.push('The quest is complete: the Lantern is lit.');
  else if (chest_here && !q.chest_open) parts.push(`The iron chest is here and locked${q.satchel.includes('brass_key') ? '; the party carries a key' : '; it cannot be opened yet'}.`);
  else if (scene_index === FINALE_SCENE) parts.push(q.satchel.includes('flint_and_wick') ? 'The Lantern still has to be lit at the lighthouse.' : 'The chest is open: its flint and wick can be taken.');
  parts.push('When a player takes something, call take_item; when they use one thing on another, call use_item; never otherwise, and only one such call in a reply. Narrate what the tool answers.');
  return parts.join(' ');
}

/** Whether end_story may be accepted: the goal must be complete. */
export const endAllowed = (q: QuestState) => goalDone(q);

/** The ids published for the page (and Pixel) in the satchel attribute. */
export const satchelAttribute = (q: QuestState): string => JSON.stringify(q.satchel);

export function parseSatchel(value: string | undefined): ItemId[] {
  if (!value) return [];
  try {
    const raw = JSON.parse(value);
    return Array.isArray(raw) ? raw.filter((id): id is ItemId => typeof id === 'string' && !!itemById(id)) : [];
  } catch {
    return [];
  }
}

// ---- Names ----

const NAME_STOP = new Set(['not', 'going', 'ready', 'here', 'sorry', 'fine', 'good', 'done', 'sure', 'afraid', 'looking', 'trying', 'taking', 'using', 'stuck', 'lost', 'tired', 'back', 'just', 'still', 'also', 'in', 'at', 'on', 'the', 'a', 'an', 'so', 'very', 'really', 'now', 'with', 'for', 'to']);

/** "I'm Snaggle", "my name is Snaggle", "call me Snaggle": the name a player gave, or undefined. Only a capitalised word counts. */
export function parseNameCorrection(text: string): string | undefined {
  const m = text.match(/\b(?:[Ii]['’]?m|[Ii] am|[Mm]y name(?:['’]s| is)|[Cc]all me|[Ii]t['’]?s|[Tt]his is)\s+([A-Z][A-Za-z'’-]{1,19})\b/);
  if (!m) return undefined;
  return NAME_STOP.has(m[1].toLowerCase()) ? undefined : m[1];
}

/** True when a reply uses the player's name as a word (so the check can log it). */
export const usesName = (reply: string, name: string | undefined): boolean => !!name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(reply);
