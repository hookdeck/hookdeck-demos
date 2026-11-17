/**
 * The world of "The Lantern of Hollow Mere", as code. The code decides what happens; Bram only narrates it.
 *
 * Places are joined by named exits in both directions:
 *
 *   tavern (map, locked chest) <-north door-> forest <-oak door-> hollow oak (brass key)
 *   forest <-rope bridge / steps-> cave (the Lantern, a boat) -boat-> lighthouse
 *   lighthouse <-shore path-> tavern,  lighthouse <-headland track-> forest
 *
 * Items stay where they are until taken. The party shares one satchel. The chest stays in the tavern: it opens with the brass key
 * and holds flint and a wick. The quest is done when the Lantern is lit with them at the lighthouse. The items can be gathered in any
 * order and meet at the lighthouse.
 */

export type PlaceId = 'tavern' | 'forest' | 'oak' | 'cave' | 'lighthouse';
export type ItemId = 'map' | 'brass_key' | 'lantern' | 'flint_and_wick';

export interface ExitDef {
  /** What the resolver and the code call this way out. */
  id: string;
  to: PlaceId;
  /** How it is described, as part of the place. */
  text: string;
}

export interface PlaceDef {
  id: PlaceId;
  /** Shown on the page. */
  name: string;
  /** What players call it (lower case, as speech to text writes it): used to match a named destination. */
  aliases: string[];
  /** The soundtrack file (scene name) played here. Places that share one keep it playing. */
  soundtrack: 'tavern' | 'forest' | 'cave' | 'finale';
  place: string;
  /** The fixed ambience of the place (weather, fire, trees, drips): never an item, never anything a player can change. */
  ambient: string[];
  exits: ExitDef[];
  /** Things to find, revealed only when a player investigates that thing: built from the world state (see cluesOf). */
}

export const PLACES: Record<PlaceId, PlaceDef> = {
  tavern: {
    id: 'tavern',
    name: 'The Drowned Bell',
    aliases: ['the drowned bell', 'drowned bell', 'the inn', 'the tavern', 'the bell', 'the pub'],
    soundtrack: 'tavern',
    place: 'the common room of the Drowned Bell on a stormy night, with a fire, a long table and a hooded stranger',
    ambient: ['rain on the shutters', 'the fire popping', 'the hooded stranger watching from the long table'],
    exits: [
      { id: 'north_door', to: 'forest', text: 'a north door leads out into the storm toward the Hollow Wood' },
      { id: 'shore_door', to: 'lighthouse', text: 'a back door opens onto a shore path that climbs to the lighthouse' },
    ],
  },
  forest: {
    id: 'forest',
    name: 'The Hollow Wood',
    aliases: ['the hollow wood', 'the wood', 'the woods', 'the forest', 'the trees'],
    soundtrack: 'forest',
    place: 'the Hollow Wood, a damp pine forest',
    ambient: ['a rope bridge over a stream', 'a muddy path under the pines', 'silver footprints in the mud', 'a hollow oak with a small door in its trunk'],
    exits: [
      { id: 'oak_door', to: 'oak', text: 'the small door in the hollow oak' },
      { id: 'rope_bridge', to: 'cave', text: 'the rope bridge and stone steps beside a waterfall lead down toward the Mere, following the dripping water' },
      { id: 'inn_path', to: 'tavern', text: 'the lit windows of the Drowned Bell show back down the path' },
      { id: 'headland_track', to: 'lighthouse', text: 'a headland track leads out toward the lighthouse' },
    ],
  },
  oak: {
    id: 'oak',
    name: 'The Hollow Oak',
    aliases: ['the hollow oak', 'the oak', 'the oak tree', 'the tree'],
    soundtrack: 'forest',
    place: 'inside the hollow oak, a cramped, dry hollow that smells of resin',
    ambient: ['a root shelf along the wall', 'the storm muffled outside the little door'],
    exits: [{ id: 'out', to: 'forest', text: 'the small door leads back out to the wood' }],
  },
  cave: {
    id: 'cave',
    name: 'The Cave under the Mere',
    aliases: ['the cave', 'the mere', 'the hollow mere', 'the cave under the mere', 'the pool'],
    soundtrack: 'cave',
    place: 'the cave under the Hollow Mere, dripping and dark',
    ambient: ['a stone ledge above the water', 'drips from the ceiling', 'a carving of a boat crossing a pool on the wall', 'a small rowboat on the underground pool'],
    exits: [
      { id: 'steps_up', to: 'forest', text: 'stone steps beside the waterfall lead back up to the wood' },
      { id: 'boat', to: 'lighthouse', text: 'rowing the boat across the pool leads out to the shore below the lighthouse' },
    ],
  },
  lighthouse: {
    id: 'lighthouse',
    name: 'The Lighthouse',
    aliases: ['the lighthouse', 'the light house', 'the lamp room', 'the tower'],
    soundtrack: 'finale',
    place: 'the lamp room of Old Bram\'s lighthouse at dawn',
    ambient: ['the storm clearing outside', 'the stone walls streaked with salt', 'the Drowned Bell far below'],
    exits: [
      { id: 'shore_path', to: 'tavern', text: 'a shore path leads down to the Drowned Bell' },
      { id: 'headland_track', to: 'forest', text: 'a headland track leads back to the Hollow Wood' },
    ],
  },
};

export interface ItemDef {
  id: ItemId;
  /** How Bram and the page name it. */
  label: string;
  place: PlaceId;
  aliases: string[];
}

export const ITEMS: readonly ItemDef[] = [
  { id: 'map', label: 'the salt-stained map', place: 'tavern', aliases: ['map', 'salt-stained map'] },
  { id: 'brass_key', label: 'the small brass key', place: 'oak', aliases: ['key', 'brass key', 'small brass key'] },
  { id: 'lantern', label: 'the Lantern of Hollow Mere', place: 'cave', aliases: ['lantern', 'lantern of hollow mere', 'lamp'] },
  { id: 'flint_and_wick', label: 'the flint and wick', place: 'tavern', aliases: ['flint', 'wick', 'flint and wick'] },
];

export interface World {
  location: PlaceId;
  satchel: ItemId[];
  chest_open: boolean;
  lantern_lit: boolean;
}

export const newWorld = (): World => ({ location: 'tavern', satchel: [], chest_open: false, lantern_lit: false });

/** Test starts (STORY_START=<place>): begin elsewhere with the map in the satchel. */
export const worldAt = (place: string | undefined, items?: string): World => {
  const w = newWorld();
  if (place && place in PLACES) {
    w.location = place as PlaceId;
    if (place !== 'tavern') w.satchel = ['map'];
  }
  // STORY_ITEMS=map,lantern puts those items in the satchel to begin with
  for (const id of (items ?? '').split(',').map((s) => s.trim())) if (itemById(id) && !w.satchel.includes(id as ItemId)) w.satchel.push(id as ItemId);
  return w;
};

/** The way out of this place, described by where it leads: for telling the players their real options. */
export const exitsByDestination = (w: World): string => placeOf(w).exits.map((e) => `${PLACES[e.to].name} (${e.text})`).join('; ');

const MOVE_WORDS = /\b(go|goes|going|head|heading|walk|walking|return|returning|back|enter|travel|get|run|leave|climb|row|follow|through|into|towards?|take us|take me|off to|out to)\b/i;

/**
 * Names a destination in the player's words ("go through the door into the Drowned Bell"): the exit from here that leads there, or the
 * destination when there is no direct exit. The destination the player names outweighs words like "door" or "path". Only with a
 * word of movement, so "look at the inn sign" does not move anyone.
 */
export function matchDestination(w: World, words: string): { exit?: ExitDef; destination?: PlaceDef } | undefined {
  if (!MOVE_WORDS.test(words)) return undefined;
  const text = words.toLowerCase();
  let best: { place: PlaceDef; at: number; len: number } | undefined;
  for (const place of Object.values(PLACES)) {
    if (place.id === w.location) continue;
    for (const alias of place.aliases) {
      const at = text.search(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
      if (at >= 0 && (!best || alias.length > best.len || (alias.length === best.len && at > best.at))) best = { place, at, len: alias.length };
    }
  }
  if (!best) return undefined;
  const exit = placeOf(w).exits.find((e) => e.to === best!.place.id);
  return exit ? { exit } : { destination: best.place };
}

/** How an item looks where it lies: written for the item, so a taken item is simply no longer described. */
const LYING: Record<ItemId, string> = {
  map: 'a salt-stained map on the table in front of the stranger',
  brass_key: 'a small brass key on a root shelf along the wall',
  lantern: 'the Lantern of Hollow Mere on a stone ledge, unlit',
  flint_and_wick: 'flint and a wick lying inside the open chest',
};

/**
 * What can be seen here right now, built from the world state: the fixed ambience, the items still lying here where they lie, the
 * chest as it is (locked, or open with what is left inside), and the lamp as it is. Nothing in the static text depends on the state,
 * so nothing here can be out of date.
 */
export function sightsOf(w: World): string[] {
  const p = placeOf(w);
  const out = [...p.ambient];
  for (const item of itemsHere(w)) if (item.id !== 'flint_and_wick') out.push(LYING[item.id]);
  if (chestHere(w)) {
    if (!w.chest_open) out.push('a small iron chest under the bench, locked');
    else out.push(w.satchel.includes('flint_and_wick') ? 'the small iron chest under the bench, open and empty' : `the small iron chest under the bench, open, with ${LYING.flint_and_wick.replace(' lying inside the open chest', '')} inside`);
  }
  if (w.location === 'lighthouse') out.push(w.lantern_lit ? 'the great lamp blazing, lit from the Lantern\'s flame' : 'the great lamp, dark');
  return out;
}

/** Things to find, revealed only when a player investigates that thing. Each one goes when it stops being true. */
export function cluesOf(w: World): string[] {
  const out: string[] = [];
  switch (w.location) {
    case 'tavern':
      out.push('the map has a lantern drawn near the Hollow Mere and a margin note about dripping water; the stranger knows the way and says so only if asked');
      if (!w.chest_open) out.push('the chest is locked and needs a key');
      break;
    case 'forest':
      out.push('the footprints are small and lead to the door in the oak');
      break;
    case 'oak':
      if (!w.satchel.includes('brass_key')) out.push('the brass key looks the right size for a small lock');
      break;
    case 'cave':
      out.push('the carving shows a boat crossing the pool toward a light');
      if (!w.satchel.includes('lantern')) out.push('the Lantern is cold and unlit');
      break;
    case 'lighthouse':
      if (!w.lantern_lit) out.push('the dark great lamp will take only the Lantern\'s flame, and the Lantern needs flint and a wick to wake it');
      break;
  }
  return out;
}

/** What happens when the Lantern is lit: one beat. The Mere's flame is the only fire the great lamp takes, and the party keeps the Lantern. */
export const LIT_OUTCOME = 'The flint strikes and the wick catches. The Lantern wakes with the Mere\'s own flame, and the great lamp catches from it and blazes. The Lantern stays lit in the party\'s hands: the quest is done.';

const LIGHT_REQUEST = /\b(?:re)?(?:light|kindle|ignite)\b[^.?!]{0,30}?\b(?:lantern|lamp|beacon|light|lighthouse)\b/i;
const LIGHT_REFUSAL = /\b(?:don'?t|do not|not|never|shouldn'?t|won'?t|no)\b[^.?!]{0,20}\b(?:re)?(?:light|kindle|ignite)\b/i;

/** True when the player's words ask to light, kindle or relight the Lantern, the lamp, the beacon, the light or the lighthouse ("can we...", "let's...", "I want to..." included). */
export const asksToLight = (words: string): boolean => LIGHT_REQUEST.test(words) && !LIGHT_REFUSAL.test(words);

/**
 * Lighting is decided on the player's words as well as the resolver's reading: at the lighthouse, with the Lantern and the flint and wick
 * in the satchel and the Lantern not yet lit, any request to light it lights it, whatever the resolver made of a cut-off or questioning
 * turn. Anywhere else this does nothing, so the usual refusals stand. Returns whether it added the use.
 */
export function addLightingFromWords(w: World, words: string, actions: Actions): boolean {
  if (w.location !== 'lighthouse' || w.lantern_lit || !w.satchel.includes('lantern') || !w.satchel.includes('flint_and_wick')) return false;
  if (!asksToLight(words)) return false;
  const already = actions.use.some((u) => { const a = normalizeItem(u.item); const b = normalizeItem(u.target); return (a === 'lantern' && b === 'flint_and_wick') || (a === 'flint_and_wick' && b === 'lantern'); });
  if (!already) actions.use.push({ item: 'lantern', target: 'flint_and_wick' });
  return !already;
}

export const goalDone = (w: World) => w.lantern_lit;
export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);
export const placeOf = (w: World): PlaceDef => PLACES[w.location];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Maps what the resolver wrote ("brass key", "the Lantern") to an item id, or 'chest'. */
export function normalizeItem(text: unknown): ItemId | 'chest' | undefined {
  if (typeof text !== 'string') return undefined;
  const t = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an|my|our) /, '');
  if (/\bchest\b|\bbox\b/.test(t)) return 'chest';
  for (const item of ITEMS) if (item.id.replace(/_/g, ' ') === t || item.aliases.includes(t)) return item.id;
  if (/\bflint\b|\bwick\b/.test(t)) return 'flint_and_wick';
  if (/\bkey\b/.test(t)) return 'brass_key';
  if (/\blantern\b/.test(t)) return 'lantern';
  if (/\bmap\b/.test(t)) return 'map';
  return undefined;
}

/** Items lying here that nobody has taken. The flint and wick are visible only once the chest is open. */
export function itemsHere(w: World): ItemDef[] {
  return ITEMS.filter((i) => i.place === w.location && !w.satchel.includes(i.id) && (i.id !== 'flint_and_wick' || w.chest_open));
}

export const chestHere = (w: World) => w.location === 'tavern';

// ---- What the resolver returns, and what the code makes of it ----

export interface Actions {
  /** An exit id the player clearly chose. */
  move: string | null;
  /** Somewhere or some way the player tried to go that is not one of the exits (so it is refused, not guessed). */
  blocked: string | null;
  /** "pixel" when the player spoke to the mute traveller ("ask Pixel what he thinks"). */
  addressed: string | null;
  take: string[];
  use: Array<{ item: string; target: string }>;
  give: Array<{ item: string; to: string }>;
}

export const noActions = (): Actions => ({ move: null, blocked: null, addressed: null, take: [], use: [], give: [] });

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Reads the resolver's answer: the first JSON object in the text, with anything of the wrong shape dropped. Anything unreadable is no actions. */
export function parseActions(raw: string): Actions {
  const out = noActions();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return out;
  let json: any;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!json || typeof json !== 'object') return out;
  out.move = str(json.move) ?? null;
  out.blocked = str(json.blocked) ?? null;
  out.addressed = str(json.addressed)?.toLowerCase() ?? null;
  if (Array.isArray(json.take)) out.take = json.take.map(str).filter((x: string | undefined): x is string => !!x);
  if (Array.isArray(json.use)) out.use = json.use.map((u: any) => ({ item: str(u?.item), target: str(u?.target) })).filter((u: any) => u.item && u.target);
  if (Array.isArray(json.give)) out.give = json.give.map((g: any) => ({ item: str(g?.item), to: str(g?.to) ?? 'stranger' })).filter((g: any) => g.item);
  return out;
}

/** The question for the resolver: the place, its exits, what lies here, what the party carries, and the player's words. */
export function actionPrompt(w: World, words: string, pixel_present = false): { system: string; user: string } {
  const p = placeOf(w);
  const here = itemsHere(w).map((i) => `${i.id} (${i.label})`);
  const carried = w.satchel.map((id) => `${id} (${itemById(id)!.label})`);
  return {
    system: 'You read what a player says in a spoken adventure and list only what they clearly do right now. Reply with one JSON object and nothing else: {"move": exit id or null, "blocked": text or null, "addressed": "pixel" or null, "take": [item ids], "use": [{"item": id, "target": id or "chest"}], "give": [{"item": id, "to": "stranger"}]}. Choose a "move" only when the player\'s words clearly name or describe one of the listed exits. Prefer the exit whose destination the player names ("the Drowned Bell", "the inn", "the lighthouse", "the cave"): the destination outweighs words like "door" or "path". If the player tries to go somewhere, or by a way, that is NOT in the list of exits, set "move" to null and put what they tried in "blocked". Never pick the nearest exit as a guess. Use empty arrays and null when the player does none of these. Handing an item to someone is "give" ("to" is who gets it, for example "pixel" or "stranger"). When the player speaks to or asks Pixel something, set "addressed" to "pixel". Exploring, asking, looking and talking are none of these.',
    user: `Place: ${p.place}.
Exits (use the id): ${p.exits.map((e) => `${e.id}: ${e.text}, leads to ${PLACES[e.to].name} (also called ${PLACES[e.to].aliases.join(', ')})`).join('; ')}.
Items lying here: ${here.join('; ') || 'none'}.${chestHere(w) ? ` An iron chest is here, ${w.chest_open ? 'open' : 'locked'}.` : ''}
The party carries: ${carried.join('; ') || 'nothing'}.
${pixel_present ? 'Pixel, a mute traveller, is in the party.\n' : ''}The player said: "${words.trim().slice(0, 300)}"`,
  };
}

export interface Resolution {
  /** One short factual sentence per thing that happened or was refused, for Bram to narrate. */
  outcomes: string[];
  moved: boolean;
  opened: boolean;
  lit: boolean;
  took: ItemId[];
  /** A move was asked for and refused (no such exit, or a destination with no way from here). */
  blocked_move: boolean;
}

/** Validates and applies the resolver's actions in order: take, give, use, then move. Anything that does not hold becomes a refusal outcome. */
export function applyActions(w: World, actions: Actions): Resolution {
  const r: Resolution = { outcomes: [], moved: false, opened: false, lit: false, took: [], blocked_move: false };
  const taken_ids = new Set<string>();
  const take = (raw: string, via_stranger = false, who = 'the stranger') => {
    const id = normalizeItem(raw);
    if (id === 'chest') return r.outcomes.push('The iron chest is far too heavy to take and is bolted to the floor of the inn. It stays where it is.');
    const item = id ? itemById(id) : undefined;
    if (!item) return r.outcomes.push(`There is no "${raw}" here that can be taken.`);
    // "flint" and "wick" are one item: say it once
    if (taken_ids.has(item.id)) return;
    taken_ids.add(item.id);
    if (w.satchel.includes(item.id)) return r.outcomes.push(`${cap(item.label)} is already in the satchel.`);
    if (!itemsHere(w).some((i) => i.id === item.id)) return r.outcomes.push(`${cap(item.label)} is not in this place.`);
    w.satchel.push(item.id);
    r.took.push(item.id);
    r.outcomes.push(via_stranger ? `The party gave ${item.label} to ${who}, who carries it: it is in the party's satchel.` : `The party took ${item.label}. It is in the satchel.`);
  };
  for (const raw of actions.take) take(raw);
  for (const g of actions.give) {
    const id = normalizeItem(g.item);
    const item = id && id !== 'chest' ? itemById(id) : undefined;
    const who = /pix/i.test(g.to) ? 'Pixel' : 'the stranger';
    if (item && w.satchel.includes(item.id)) r.outcomes.push(`The party handed ${item.label} to ${who}, who carries it: it stays in the party's satchel.`);
    else take(g.item, true, who);
  }
  for (const u of actions.use) {
    const a = normalizeItem(u.item);
    const b = normalizeItem(u.target);
    const pair = (x: string, y: string) => (a === x && b === y) || (a === y && b === x);
    if (pair('brass_key', 'chest') || a === 'chest' || b === 'chest') {
      if (!chestHere(w)) r.outcomes.push('There is no chest in this place.');
      else if (w.chest_open) r.outcomes.push('The chest is already open.');
      else if (!pair('brass_key', 'chest')) r.outcomes.push('The chest is locked and does not open that way. It needs a key.');
      else if (!w.satchel.includes('brass_key')) r.outcomes.push('The party tried to open the chest: it is locked and the party has no key.');
      else { w.chest_open = true; r.opened = true; r.outcomes.push('The brass key turns and the chest opens. Inside lie flint and a wick, now in plain sight.'); }
    } else if (pair('lantern', 'flint_and_wick')) {
      if (!w.satchel.includes('lantern')) r.outcomes.push('The party is not carrying the Lantern.');
      else if (!w.satchel.includes('flint_and_wick')) r.outcomes.push('There is nothing to light the Lantern with: the party has no flint and wick.');
      else if (w.location !== 'lighthouse') r.outcomes.push('This is not the place to light the Lantern. It must be lit at the lighthouse, where the great lamp is.');
      else if (w.lantern_lit) r.outcomes.push('The Lantern is already lit.');
      else { w.lantern_lit = true; r.lit = true; r.outcomes.push(LIT_OUTCOME); }
    } else if (a && itemById(a) && !w.satchel.includes(a)) r.outcomes.push(`${cap(itemById(a)!.label)} is not in the satchel.`);
    else r.outcomes.push('Nothing happens: that does not work here.');
  }
  if (!actions.move && actions.blocked) { r.blocked_move = true; r.outcomes.push(`There is no way to ${actions.blocked} from here. From here the party can go to: ${exitsByDestination(w)}.`); }
  if (actions.move) {
    const here = placeOf(w);
    const wanted = actions.move.toLowerCase().replace(/[\s-]+/g, '_');
    const exit = here.exits.find((e) => e.id === wanted) ?? here.exits.find((e) => e.to === wanted);
    if (!exit) { r.blocked_move = true; r.outcomes.push(`There is no way "${actions.move}" from here. From here the party can go to: ${exitsByDestination(w)}.`); }
    else {
      w.location = exit.to;
      r.moved = true;
      r.outcomes.push(`The party moved to ${PLACES[exit.to].name}.`);
    }
  }
  return r;
}

/** Whether the story ends now: the Lantern is lit (at the lighthouse, the only place it can be). */
export const endTriggered = (r: Resolution) => r.lit;

// ---- What Bram is told ----

/** The scene note for one reply: where the party is, what lies here, what is carried, the exits as description, what just happened. */
/** The first item the words name ("give pixel to map" still names the map), for when the resolver missed an obvious give. */
export function itemNamed(words: string): ItemId | undefined {
  const t = words.toLowerCase();
  for (const item of ITEMS) if (item.aliases.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))) return item.id;
  return undefined;
}

/** True when the words name Pixel (speech to text may write "pixel" or "pixle"). */
export const addressesPixel = (words: string): boolean => /\bpix(?:el|le)\b/i.test(words);

export function placeNote(w: World, opts: { extra?: string[]; full: boolean; described?: string[]; replies?: number; outcomes?: string[]; music?: string; arriving?: boolean }): string {
  const p = placeOf(w);
  const replies = opts.replies ?? 0;
  const parts: string[] = [];
  parts.push(`You are at ${p.name}: ${p.place}. Never describe being anywhere else, and never describe the party moving, unless this note says the party moved.`);
  if (opts.music) parts.push(`The place has started ${opts.music}.`);
  const sights = sightsOf(w);
  if (opts.full) parts.push(`What can be seen and heard: ${sights.join(', ')}.`);
  else {
    // Only what is still true counts as described: a phrase for how things used to be (the locked chest) is dropped, never repeated to Bram
    const described = (opts.described ?? []).filter((d) => sights.includes(d));
    const fresh = sights.filter((d) => !described.includes(d));
    parts.push(`You have already described this place${described.length ? `: already described, so do not repeat it unless something about it changes or it matters to what the player just did: ${described.join('; ')}` : ''}.${fresh.length ? ` Not yet mentioned: ${fresh.join('; ')}.` : ''}`);
  }
  parts.push('Never describe the Lantern or the great lamp being lit, anything opening, or anything being taken, unless "What just happened" says so.');
  parts.push(`Ways out, to describe only as part of the place: ${p.exits.map((e) => e.text).join('; ')}.`);
  const clues = cluesOf(w);
  if (clues.length && !w.lantern_lit) parts.push(`Things to find, revealed only when a player investigates that thing: ${clues.join('; ')}.`);
  const here = itemsHere(w);
  parts.push(here.length ? `Lying here, not yet taken: ${here.map((i) => i.label).join('; ')}. Describe each where it lies and never tell the players to take it.` : 'Nothing here is left to take.');
  parts.push(`In the satchel: ${w.satchel.length ? w.satchel.map((id) => itemById(id)!.label).join('; ') : 'nothing'}.`);
  if (chestHere(w)) parts.push(`The iron chest is here, ${w.chest_open ? 'open' : 'locked'}.`);
  if (opts.outcomes?.length) parts.push(`What just happened, resolved by the story (state it plainly as fact, never contradict it): ${opts.outcomes.join(' ')}`);
  for (const e of opts.extra ?? []) parts.push(e);
  if (opts.arriving) parts.push('Describe the place in two short plain sentences using some of what can be seen and heard, then stop on a short open line with no name and no question.');
  else if (replies >= 4) parts.push('Give the shortest reply now: one sentence about what happens, and no atmosphere at all.');
  else if (replies >= 1) parts.push('Answer only what the player did, in one or two sentences, with no recap of the scene.');
  return parts.join(' ');
}

/** The closing note once the Lantern is lit: Bram speaks his closing and nothing more. */
export const closingNote = (outcomes: string[]) => `The quest is complete: ${outcomes.join(' ')} Speak your closing now: at most three plain sentences that say what the players did, that the party keeps the lit Lantern and carries it back down to the Drowned Bell, and end the story. Do not say anything after it.`;

const STOP = new Set(['the', 'and', 'with', 'its', 'on', 'in', 'of', 'a', 'an', 'to', 'it', 'from', 'under', 'over', 'into', 'across', 'near', 'that', 'small', 'front']);

/** The sights (comma-separated details) that a reply mentions: a detail counts as used when one of its key words appears. */
export function usedDetails(details: string[], reply: string): string[] {
  const text = reply.toLowerCase();
  return details.filter((detail) => detail.toLowerCase().match(/[a-z]+/g)?.some((word) => word.length >= 3 && !STOP.has(word) && new RegExp(`\\b${word}(?:s|es)?\\b`).test(text)));
}

export const satchelAttribute = (w: World): string => JSON.stringify(w.satchel);

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
