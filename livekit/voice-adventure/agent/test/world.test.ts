import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addLightingFromWords, cluesOf, sightsOf, addressesPixel, exitsByDestination, itemNamed, ITEMS, matchDestination, PLACES, actionPrompt, applyActions, closingNote, endTriggered, itemsHere, newWorld, noActions, normalizeItem, parseActions, parseNameCorrection, parseSatchel, placeNote, satchelAttribute, usedDetails, usesName, worldAt, type Actions, type World } from '../src/world.ts';
import { buildState, decodeState, encodeState, recapInstructions, shouldResume } from '../src/resume.ts';
import { bramInstructions, cleanSpeech, onBramReply, onPlayout, onSceneStart, TOOL_NAMES, type TurnState } from '../src/story.ts';
import { COOLDOWN_TURNS, GENERIC_LINES, POINTING_RESPONSES, RESPONDING_LINES, SCENE_LINES, chooseGesture, pickGesture, respondLine } from '../src/pixel-lines.ts';

const act = (o: Partial<Actions>): Actions => ({ ...noActions(), ...o });
const at = (place: World['location'], satchel: World['satchel'] = []): World => ({ ...newWorld(), location: place, satchel: [...satchel] });

test('the map: every exit leads to a real place and, except the boat, has a way back', () => {
  for (const place of Object.values(PLACES)) {
    for (const exit of place.exits) {
      const target = PLACES[exit.to];
      assert.ok(target, `${place.id} -> ${exit.id}`);
      // the boat across the pool is the one one-way exit: the lighthouse is reached by water, and left by land
      if (exit.id !== 'boat') assert.ok(target.exits.some((e) => e.to === place.id), `${exit.to} has a way back to ${place.id}`);
    }
  }
  const to = (from: string, id: string) => PLACES[from as keyof typeof PLACES].exits.find((e) => e.id === id)?.to;
  assert.equal(to('tavern', 'north_door'), 'forest');
  assert.equal(to('forest', 'oak_door'), 'oak');
  assert.equal(to('oak', 'out'), 'forest');
  assert.equal(to('forest', 'rope_bridge'), 'cave');
  assert.equal(to('cave', 'steps_up'), 'forest');
  assert.equal(to('cave', 'boat'), 'lighthouse');
  assert.equal(to('lighthouse', 'shore_path'), 'tavern');
  assert.equal(to('lighthouse', 'headland_track'), 'forest');
});

test('moving: a real exit moves the party, a bad exit does not, and going back works', () => {
  const w = newWorld();
  let r = applyActions(w, act({ move: 'north_door' }));
  assert.equal(r.moved, true);
  assert.equal(w.location, 'forest');
  assert.match(r.outcomes[0], /moved to The Hollow Wood/);
  r = applyActions(w, act({ move: 'secret_tunnel' }));
  assert.equal(r.moved, false);
  assert.equal(w.location, 'forest');
  assert.match(r.outcomes[0], /no way "secret_tunnel"/);
  applyActions(w, act({ move: 'oak_door' }));
  assert.equal(w.location, 'oak');
  applyActions(w, act({ move: 'out' }));
  assert.equal(w.location, 'forest');
  applyActions(w, act({ move: 'inn_path' }));
  assert.equal(w.location, 'tavern');
  // an exit that is not in this place is refused
  assert.equal(applyActions(w, act({ move: 'boat' })).moved, false);
});

test('items stay where they are; taking works only where the item lies; the flint and wick appear only with the chest open', () => {
  const w = newWorld();
  assert.deepEqual(itemsHere(w).map((i) => i.id), ['map']);
  assert.equal(itemsHere(at('oak')).map((i) => i.id)[0], 'brass_key');
  assert.deepEqual(itemsHere(at('cave')).map((i) => i.id), ['lantern']);
  assert.equal(applyActions(w, act({ take: ['the lantern'] })).took.length, 0);
  assert.match(applyActions(at('tavern'), act({ take: ['brass key'] })).outcomes[0], /not in this place/);
  const r = applyActions(w, act({ take: ['map'] }));
  assert.deepEqual(w.satchel, ['map']);
  assert.deepEqual(r.took, ['map']);
  assert.match(applyActions(w, act({ take: ['map'] })).outcomes[0], /already in the satchel/);
  assert.match(applyActions(w, act({ take: ['chest'] })).outcomes[0], /too heavy/);
  assert.match(applyActions(w, act({ take: ['flint'] })).outcomes[0], /not in this place/);
  // left behind in the oak until taken, even after the party leaves and returns
  const v = at('oak');
  applyActions(v, act({ move: 'out' }));
  applyActions(v, act({ move: 'oak_door' }));
  assert.deepEqual(itemsHere(v).map((i) => i.id), ['brass_key']);
});

test('give to the stranger is the party taking it: an item here is taken, a carried one stays in the shared satchel, and one not here is refused', () => {
  const w = at('cave');
  let r = applyActions(w, act({ give: [{ item: 'lantern', to: 'stranger' }] }));
  assert.deepEqual(w.satchel, ['lantern']);
  assert.match(r.outcomes[0], /stranger, who carries it/);
  r = applyActions(w, act({ give: [{ item: 'lantern', to: 'stranger' }] }));
  assert.deepEqual(w.satchel, ['lantern']); // no duplicate
  assert.match(r.outcomes[0], /stays in the party's satchel/);
  assert.match(applyActions(w, act({ give: [{ item: 'brass key', to: 'stranger' }] })).outcomes[0], /not in this place/);
});

test('the chest is in the tavern: it needs the key; with the key it opens and the flint and wick can be taken', () => {
  const w = at('tavern');
  assert.match(applyActions(w, act({ use: [{ item: 'brass key', target: 'chest' }] })).outcomes[0], /no key/);
  assert.match(applyActions(at('forest', ['brass_key']), act({ use: [{ item: 'brass key', target: 'chest' }] })).outcomes[0], /no chest in this place/);
  const v = at('tavern', ['brass_key']);
  const r = applyActions(v, act({ use: [{ item: 'key', target: 'chest' }] }));
  assert.equal(r.opened, true);
  assert.equal(v.chest_open, true);
  assert.match(applyActions(v, act({ use: [{ item: 'key', target: 'chest' }] })).outcomes[0], /already open/);
  assert.deepEqual(itemsHere(v).map((i) => i.id).sort(), ['flint_and_wick', 'map']);
  assert.equal(applyActions(v, act({ take: ['flint and wick'] })).took[0], 'flint_and_wick');
});

test('lighting: only at the lighthouse with the Lantern and the flint and wick, in any order of gathering; then the ending triggers', () => {
  assert.match(applyActions(at('lighthouse', ['flint_and_wick']), act({ use: [{ item: 'lantern', target: 'flint and wick' }] })).outcomes[0], /not carrying the Lantern/);
  assert.match(applyActions(at('lighthouse', ['lantern']), act({ use: [{ item: 'lantern', target: 'flint and wick' }] })).outcomes[0], /no flint and wick/);
  assert.match(applyActions(at('cave', ['lantern', 'flint_and_wick']), act({ use: [{ item: 'flint', target: 'lantern' }] })).outcomes[0], /not the place/);
  const w = at('lighthouse', ['lantern', 'flint_and_wick']);
  const r = applyActions(w, act({ use: [{ item: 'flint and wick', target: 'lantern' }] }));
  assert.equal(r.lit, true);
  assert.equal(endTriggered(r), true);
  assert.match(closingNote(r.outcomes), /Speak your closing now/);
  // the whole route: lantern first, boat to the lighthouse, back by the shore path, the key from the oak, the chest, back to the lighthouse
  const route = newWorld();
  const steps: Actions[] = [act({ move: 'north_door' }), act({ move: 'rope_bridge' }), act({ take: ['lantern'] }), act({ move: 'boat' }), act({ move: 'shore_path' }), act({ move: 'north_door' }), act({ move: 'oak_door' }), act({ take: ['key'] }), act({ move: 'out' }), act({ move: 'inn_path' }), act({ use: [{ item: 'key', target: 'chest' }] }), act({ take: ['flint'] }), act({ move: 'shore_door' })];
  for (const s of steps) applyActions(route, s);
  assert.equal(route.location, 'lighthouse');
  assert.deepEqual([...route.satchel].sort(), ['brass_key', 'flint_and_wick', 'lantern']);
  assert.equal(applyActions(route, act({ use: [{ item: 'lantern', target: 'flint' }] })).lit, true);
});

test('resolver JSON: parsed from the model text, bad shapes dropped, unreadable is no actions; the prompt carries place, exits, items and the words', () => {
  assert.deepEqual(parseActions('{"move":"boat","take":["lantern"],"use":[{"item":"key","target":"chest"}],"give":[{"item":"map","to":"stranger"}]}'), { move: 'boat', blocked: null, addressed: null, take: ['lantern'], use: [{ item: 'key', target: 'chest' }], give: [{ item: 'map', to: 'stranger' }] });
  assert.deepEqual(parseActions('```json\n{"move": null, "take": [], "use": [], "give": []}\n```'), noActions());
  assert.deepEqual(parseActions('{"move": 3, "take": "map", "use": [{"item": "key"}], "give": [{"to": "x"}]}'), noActions());
  for (const bad of ['', 'no', '{broken', '[1]', 'null']) assert.deepEqual(parseActions(bad), noActions());
  const p = actionPrompt(newWorld(), 'I take the map and go north');
  assert.match(p.user, /north_door/);
  assert.match(p.user, /map \(the salt-stained map\)/);
  assert.match(p.user, /I take the map and go north/);
  assert.match(p.user, /chest is here, locked/);
});

test('state saves and resumes with location, satchel and puzzle flags; the older scene-based state is ignored', () => {
  const world: World = { location: 'oak', satchel: ['map', 'lantern'], chest_open: false, lantern_lit: false };
  const back = decodeState(encodeState(buildState({ scene_index: 5, players: [{ identity: 'web-1', name: 'Priya', bot: false }], summary: ['Bram: x'], world })))!;
  assert.deepEqual(back.world, world);
  assert.equal(shouldResume(back), true);
  assert.equal(shouldResume({ ...back, ended: true }), false);
  assert.match(recapInstructions(back, back.players), /You are at The Hollow Oak/);
  assert.match(recapInstructions(back, back.players), /In the satchel: the salt-stained map; the Lantern of Hollow Mere/);
  assert.equal(decodeState(JSON.stringify({ v: 1, scene_index: 2, players: [], clues: [], summary: [], ended: false, saved_at: 1 })), null);
  assert.deepEqual(parseSatchel(satchelAttribute(world)), ['map', 'lantern']);
  assert.deepEqual(parseSatchel('nonsense'), []);
});

test('the note: where the party is, never anywhere else; what lies here and is carried; the exits as description; what just happened; shortening', () => {
  const w = at('forest');
  const arrival = placeNote(w, { full: true, arriving: true, outcomes: ['The party moved to The Hollow Wood.'], music: 'with its soundtrack' });
  assert.match(arrival, /You are at The Hollow Wood/);
  assert.match(arrival, /Never describe being anywhere else, and never describe the party moving, unless this note says the party moved/);
  assert.match(arrival, /What can be seen and heard: a rope bridge/);
  assert.match(arrival, /Ways out, to describe only as part of the place: the small door in the hollow oak/);
  assert.match(arrival, /What just happened.*moved to The Hollow Wood/);
  assert.match(arrival, /Nothing here is left to take/);
  const oak = placeNote(at('oak'), { full: true });
  assert.match(oak, /Lying here, not yet taken: the small brass key.*never tell the players to take it/);
  assert.doesNotMatch(oak, /iron chest/);
  assert.match(placeNote(at('tavern'), { full: true }), /iron chest is here, locked/);
  const later = placeNote(w, { full: false, described: ['a rope bridge over a stream'], replies: 2 });
  assert.match(later, /already described, so do not repeat it.*a rope bridge over a stream/);
  assert.match(later, /Answer only what the player did, in one or two sentences/);
  assert.match(placeNote(w, { full: false, replies: 4 }), /shortest reply now/);
  assert.deepEqual(usedDetails(sightsOf(newWorld()), 'The fire pops and the rain hammers the shutters.'), ['rain on the shutters', 'the fire popping']);
});

test('atmosphere tracking follows the place and resets on arrival', () => {
  const s: TurnState = { scene_index: 0, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false, world: newWorld() };
  onSceneStart(s, 'tavern');
  assert.equal(s.scene_index, 1);
  onBramReply(s, 'The fire pops and the rain hammers the shutters.');
  assert.deepEqual(s.described, ['rain on the shutters', 'the fire popping']);
  onSceneStart(s, 'forest');
  assert.deepEqual(s.described, []);
  assert.equal(s.replies_in_scene, 0);
});

test('the instructions: no tools, "my lighthouse", you not names, and no invented places', () => {
  const text = bramInstructions([{ name: 'Snaggle', bot: false }, { name: 'Pixel', bot: true }]);
  assert.match(text, /Say it as "my lighthouse"/);
  assert.match(text, /You have no tools/);
  assert.doesNotMatch(text, /next_scene|take_item|use_item|end_story/);
  assert.match(text, /never describe the party being anywhere but where the note says/);
  assert.match(text, /Speak to the player as "you"/);
  assert.match(text, /There is one human player: after your greeting never use their name at all/);
});

test('names: items normalised; tool names still kept out of speech; corrections parsed; the name check finds a reply that uses it', () => {
  assert.equal(normalizeItem('The Brass Key'), 'brass_key');
  assert.equal(normalizeItem('iron chest'), 'chest');
  assert.equal(normalizeItem(7), undefined);
  assert.ok(TOOL_NAMES.includes('take_item'));
  assert.equal(cleanSpeech('You pick it up. take_item("key") and go').removed, true);
  assert.equal(parseNameCorrection("I'm Snaggle."), 'Snaggle');
  assert.equal(parseNameCorrection("I'm going to the door"), undefined);
  assert.equal(usesName('Snaggle, the way is before you.', 'Snaggle'), true);
  assert.equal(usesName('The way is before you.', 'Snaggle'), false);
});

test('Pixel: lines fit the place and the satchel, with a cooldown, and it skips when nothing fits', () => {
  const cooldown = new Map<string, number>();
  const random = () => 0;
  // an empty satchel never gets a line about the Lantern or the key
  const taken: string[] = [];
  const cave = at('cave');
  for (let turn = 0; turn < 40; turn++) { const l = pickGesture(cave, cooldown, turn * 100, random); if (l) taken.push(l); }
  assert.ok(taken.length > 0);
  assert.ok(taken.every((l) => !/holds the Lantern up/.test(l)));
  // lines about something lying here stop once it is taken
  assert.ok(Object.values(SCENE_LINES).flat().some((l) => l.here));
  const oak = at('oak', ['brass_key']);
  for (let turn = 0; turn < 30; turn++) assert.doesNotMatch(pickGesture(oak, new Map(), turn * 100, () => Math.random()) ?? '', /brass key on the shelf/);
  // cooldown: the same line is not repeated within COOLDOWN_TURNS, then it comes back
  const c2 = new Map<string, number>();
  const first = pickGesture(at('oak'), c2, 0, random)!;
  for (let turn = 1; turn < COOLDOWN_TURNS; turn++) assert.notEqual(pickGesture(at('oak'), c2, turn, random), first);
  // a place whose lines are all cooling down: Pixel skips
  const c3 = new Map<string, number>();
  for (const line of [...SCENE_LINES.oak, ...GENERIC_LINES]) c3.set(line.text, 10);
  assert.equal(pickGesture(at('oak'), c3, 11, random), undefined);
  assert.deepEqual(chooseGesture(at('oak'), c3, 11, random), { reason: 'cooldown' });
});

test('an exit the player names that does not exist is refused, not guessed; flint and wick are one take', () => {
  const w = at('cave');
  const r = applyActions(w, act({ blocked: 'the shore path' }));
  assert.equal(r.moved, false);
  assert.equal(w.location, 'cave');
  assert.match(r.outcomes[0], /no way to the shore path from here.*rowing the boat/);
  assert.deepEqual(parseActions('{"move": null, "blocked": "the hollow oak", "take": [], "use": [], "give": []}').blocked, 'the hollow oak');
  const v = at('tavern', ['brass_key']);
  v.chest_open = true;
  const t = applyActions(v, act({ take: ['flint', 'wick'] }));
  assert.equal(t.outcomes.length, 1);
  assert.deepEqual(v.satchel, ['brass_key', 'flint_and_wick']);
  assert.match(actionPrompt(v, 'x').system, /Never pick the nearest exit as a guess/);
  assert.match(applyActions(at('tavern'), act({ take: ['chest'] })).outcomes[0], /bolted to the floor/);
});

test('test starts: STORY_START puts the party elsewhere with the map', () => {
  assert.equal(worldAt('cave').location, 'cave');
  assert.deepEqual(worldAt('cave').satchel, ['map']);
  assert.equal(worldAt(undefined).location, 'tavern');
  assert.equal(worldAt('nowhere').location, 'tavern');
  assert.deepEqual(worldAt('lighthouse', 'lantern,bogus').satchel, ['map', 'lantern']);
  assert.equal(ITEMS.length, 4);
});

test('presence floor: every place has generic lines that need nothing, so Pixel never runs dry; the reason for a skip is named', () => {
  assert.ok(GENERIC_LINES.length >= 3 && GENERIC_LINES.every((l) => !l.needs && !l.here));
  for (const place of Object.keys(PLACES) as Array<keyof typeof PLACES>) {
    // an empty-handed party, even with every place line cooling down, still has the generic lines
    const cool = new Map<string, number>();
    for (const l of SCENE_LINES[place]) cool.set(l.text, 5);
    const choice = chooseGesture(at(place), cool, 6, () => 0);
    assert.ok(choice.line, `${place}: ${JSON.stringify(choice)}`);
    assert.ok(GENERIC_LINES.some((l) => l.text === choice.line));
  }
  // nothing eligible at all is its own reason (a world where no line fits cannot happen with generics, so test the cooldown path and the empty-pool wording)
  const all = new Map<string, number>();
  for (const l of [...SCENE_LINES.cave, ...GENERIC_LINES]) all.set(l.text, 0);
  assert.equal(chooseGesture(at('cave'), all, 1).reason, 'cooldown');
});

test('addressing Pixel: detected in the words and flagged by the resolver; an item given to Pixel joins the shared satchel', () => {
  for (const words of ['Ask the pixel what he thinks.', 'Pixel, what do you think?', 'give Pixel the map', 'ask pixle']) assert.equal(addressesPixel(words), true, words);
  assert.equal(addressesPixel('I look at the pixelated map'), false);
  assert.equal(parseActions('{"move": null, "addressed": "Pixel", "take": [], "use": [], "give": [{"item": "map", "to": "pixel"}]}').addressed, 'pixel');
  const p = actionPrompt(newWorld(), 'ask pixel', true);
  assert.match(p.user, /Pixel, a mute traveller, is in the party/);
  assert.match(p.system, /"addressed": "pixel" or null/);
  assert.doesNotMatch(actionPrompt(newWorld(), 'x', false).user, /Pixel, a mute traveller/);
  const w = newWorld();
  const r = applyActions(w, act({ give: [{ item: 'map', to: 'Pixel' }] }));
  assert.deepEqual(w.satchel, ['map']);
  assert.match(r.outcomes[0], /gave the salt-stained map to Pixel, who carries it/);
  // Pixel answers: handed an item it takes it; otherwise a response or a pointer at something here
  assert.match(respondLine(w, 'the salt-stained map'), /Pixel takes the salt-stained map with a small bow/);
  const answers = new Set<string>();
  for (let i = 0; i < 60; i++) answers.add(respondLine(at('cave'), undefined));
  assert.ok([...answers].every((a) => RESPONDING_LINES.some((l) => l.text === a) || a === POINTING_RESPONSES.cave));
  assert.ok(answers.has(POINTING_RESPONSES.cave));
  assert.match(placeNote(w, { full: false, replies: 1, extra: ['The player spoke to Pixel, the mute traveller.'] }), /spoke to Pixel/);
});

test('a garbled "give pixel to map" still names the item, so the code can make the give itself', () => {
  assert.equal(itemNamed('Give pixel to map.'), 'map');
  assert.equal(itemNamed('hand Pixel the brass key'), 'brass_key');
  assert.equal(itemNamed('give pixel a hug'), undefined);
});

test('Pixel is never in the turn rotation: with any number of humans, only humans get the turn', () => {
  const players = [{ identity: 'web-1', name: 'Gandalf', bot: false }, { identity: 'bot-pixel', name: 'Pixel', bot: true }, { identity: 'web-2', name: 'Strider', bot: false }];
  const s: TurnState = { scene_index: 1, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false };
  const order: string[] = [];
  for (let i = 0; i < 12; i++) order.push(onPlayout(s, players)!.name);
  assert.ok(!order.includes('Pixel'), order.join(','));
  assert.deepEqual(order.slice(0, 4), ['Gandalf', 'Strider', 'Gandalf', 'Strider']);
  // one human: the turn always goes back to them
  const one: TurnState = { scene_index: 1, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false };
  for (let i = 0; i < 5; i++) assert.equal(onPlayout(one, [players[0], players[1]])!.name, 'Gandalf');
});

test('Pixel lines follow the puzzle flags: no tug at a chest that is open, no "nearly home" once the Lantern is lit', () => {
  const open = at('tavern');
  open.chest_open = true;
  for (let i = 0; i < 60; i++) assert.doesNotMatch(pickGesture(open, new Map(), 0, () => Math.random()) ?? '', /puzzled tug/);
  const shut = at('tavern');
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickGesture(shut, new Map(), 0, () => Math.random()) ?? '');
  assert.ok([...seen].some((l) => /puzzled tug/.test(l)));
  assert.ok(![...seen].some((l) => /open chest/.test(l)));
  const lit = at('lighthouse', ['lantern']);
  lit.lantern_lit = true;
  for (let i = 0; i < 60; i++) assert.doesNotMatch(pickGesture(lit, new Map(), 0, () => Math.random()) ?? '', /nearly home|dark lamp/);
  assert.ok(Object.values(SCENE_LINES).every((lines) => lines.length <= 3), 'few, better lines');
});

test('destinations: "Go through the door into the Drowned Bell" from the forest is the inn path, not the oak door', () => {
  const forest = at('forest');
  const m = matchDestination(forest, 'Go through the door into the drowned bell.');
  assert.equal(m?.exit?.id, 'inn_path');
  assert.equal(matchDestination(forest, 'head back to the inn')?.exit?.id, 'inn_path');
  assert.equal(matchDestination(forest, 'we go to the lighthouse')?.exit?.id, 'headland_track');
  assert.equal(matchDestination(forest, 'walk into the cave under the mere')?.exit?.id, 'rope_bridge');
  assert.equal(matchDestination(forest, 'go into the hollow oak')?.exit?.id, 'oak_door');
  // a destination with no direct exit from here: named, with no exit
  const cave = at('cave');
  const nope = matchDestination(cave, 'go back to the inn');
  assert.equal(nope?.exit, undefined);
  assert.equal(nope?.destination?.name, 'The Drowned Bell');
  // no word of movement, no move; and the current place is not a destination
  assert.equal(matchDestination(forest, 'look at the inn sign'), undefined);
  assert.equal(matchDestination(forest, 'go deeper into the wood'), undefined);
  // the prompt shows each exit with its destination and what it is called
  const p = actionPrompt(forest, 'x');
  assert.match(p.user, /inn_path: .*leads to The Drowned Bell \(also called the drowned bell, drowned bell, the inn/);
  assert.match(p.system, /destination outweighs words like "door" or "path"/);
});

test('a blocked move names the real ways out by destination', () => {
  const w = at('forest');
  const r = applyActions(w, act({ blocked: 'the tone' }));
  assert.equal(r.blocked_move, true);
  assert.match(r.outcomes[0], /From here the party can go to: The Hollow Oak \(the small door in the hollow oak\); The Cave under the Mere/);
  assert.match(r.outcomes[0], /The Drowned Bell \(the lit windows/);
  assert.match(exitsByDestination(at('oak')), /The Hollow Wood \(the small door leads back out/);
  const bad = applyActions(at('cave'), act({ move: 'north_door' }));
  assert.equal(bad.blocked_move, true);
  assert.match(bad.outcomes[0], /The Hollow Wood.*The Lighthouse/);
});

const everything = (w: World, extra = '') => [placeNote(w, { full: true, arriving: true }), placeNote(w, { full: false, described: [], replies: 1 }), sightsOf(w).join(', '), cluesOf(w).join('; '), extra].join(' | ');

test('state-built descriptions: the static place text names no item and no puzzle state', () => {
  for (const place of Object.values(PLACES)) {
    const fixed = [place.place, ...place.ambient].join(' ');
    assert.doesNotMatch(fixed, /\b(map|key|chest|lantern|flint|wick|locked|unlit|dark lamp)\b/i, `${place.id}: ${fixed}`);
  }
});

test('the tavern before and after the chest is opened: locked, then open with the flint and wick until taken', () => {
  const w = newWorld();
  assert.match(everything(w), /small iron chest under the bench, locked/);
  assert.match(everything(w), /chest is locked and needs a key/);
  assert.match(placeNote(w, { full: true }), /iron chest is here, locked/);
  w.satchel.push('brass_key');
  applyActions(w, act({ use: [{ item: 'key', target: 'chest' }] }));
  const opened = everything(w);
  assert.doesNotMatch(opened, /locked|needs a key/i);
  assert.match(opened, /iron chest under the bench, open, with flint and a wick inside/);
  assert.match(opened, /iron chest is here, open/);
  assert.match(opened, /Lying here, not yet taken: .*flint and wick/);
  assert.match(actionPrompt(w, 'x').user, /chest is here, open/);
  // once the flint and wick are taken the open chest is empty, and nothing says locked
  applyActions(w, act({ take: ['flint and wick'] }));
  const empty = everything(w);
  assert.match(empty, /open and empty/);
  assert.doesNotMatch(empty, /locked|needs a key|flint and a wick inside/i);
});

test('a taken item is no longer described where it lay: the map, the key, the Lantern', () => {
  const tavern = newWorld();
  assert.match(sightsOf(tavern).join(', '), /salt-stained map on the table/);
  applyActions(tavern, act({ take: ['map'] }));
  assert.doesNotMatch(everything(tavern), /map on the table|Lying here, not yet taken: the salt-stained map/);
  const oak = at('oak');
  assert.match(everything(oak), /small brass key on a root shelf/);
  assert.match(everything(oak), /right size for a small lock/);
  applyActions(oak, act({ take: ['key'] }));
  assert.doesNotMatch(everything(oak), /brass key on a root shelf|right size for a small lock/);
  assert.match(placeNote(oak, { full: true }), /Nothing here is left to take/);
  const cave = at('cave');
  assert.match(everything(cave), /Lantern of Hollow Mere on a stone ledge, unlit/);
  applyActions(cave, act({ take: ['lantern'] }));
  assert.doesNotMatch(everything(cave), /on a stone ledge, unlit|cold and unlit/);
  assert.match(placeNote(cave, { full: true }), /In the satchel: the Lantern of Hollow Mere/);
});

test('the lighthouse lamp is dark until the Lantern is lit, then described as lit', () => {
  const w = at('lighthouse', ['lantern', 'flint_and_wick']);
  assert.match(sightsOf(w).join(', '), /great lamp, dark/);
  applyActions(w, act({ use: [{ item: 'flint and wick', target: 'lantern' }] }));
  const lit = everything(w);
  assert.match(lit, /great lamp blazing, lit from the Lantern's flame/);
  assert.doesNotMatch(lit, /lamp, dark/);
  assert.doesNotMatch(sightsOf(at('lighthouse')).join(' '), /chest/i);
});

test('a changed thing counts as new: the chest now open may be mentioned once, though the locked chest was already described', () => {
  const s: TurnState = { scene_index: 0, inputs: 0, input_since_call: false, last_reply: '', rotation: -1, ending: false };
  const w = newWorld();
  s.world = w;
  onSceneStart(s, 'tavern');
  onBramReply(s, 'A small iron chest sits under the bench, locked.');
  assert.ok(s.described!.includes('a small iron chest under the bench, locked'));
  w.satchel.push('brass_key');
  applyActions(w, act({ use: [{ item: 'key', target: 'chest' }] }));
  const note = placeNote(w, { full: false, described: s.described, replies: 1 });
  assert.match(note, /Not yet mentioned:.*iron chest under the bench, open/);
  assert.doesNotMatch(note, /locked/);
});

test('Pixel lines use the same state: no tap at a map that was taken, no pointing at a key that is gone', () => {
  const tavern = newWorld();
  applyActions(tavern, act({ take: ['map'] }));
  for (let i = 0; i < 80; i++) assert.doesNotMatch(pickGesture(tavern, new Map(), 0, () => Math.random()) ?? '', /taps the salt-stained map/);
  const oak = at('oak', ['brass_key']);
  for (let i = 0; i < 80; i++) assert.doesNotMatch(pickGesture(oak, new Map(), 0, () => Math.random()) ?? '', /brass key on the shelf/);
});

// ---- Lighting the Lantern: decided on the player's words as well as the resolver's reading ----

const lightWith = (w: World, words: string, a: Actions = noActions()) => {
  addLightingFromWords(w, words, a);
  return applyActions(w, a);
};

test('at the lighthouse with the Lantern and the flint and wick, any request to light it lights it, whatever the resolver said', () => {
  for (const words of ['Can we light the lantern with the', 'Can we now light the lighthouse?', 'light the lamp', "Let's light the beacon", 'I want to relight the light', 'kindle the lantern please']) {
    const w = at('lighthouse', ['lantern', 'flint_and_wick']);
    const r = lightWith(w, words, act({ addressed: 'pixel' }));
    assert.equal(r.lit, true, words);
    assert.equal(w.lantern_lit, true, words);
    assert.equal(endTriggered(r), true, words);
    assert.ok(w.satchel.includes('lantern'), 'the Lantern is kept');
  }
});

test('the same words do not light it elsewhere, without both items, when already lit, or when refused', () => {
  const words = 'Can we now light the lighthouse?';
  const cave = at('cave', ['lantern', 'flint_and_wick']);
  assert.equal(addLightingFromWords(cave, words, noActions()), false);
  assert.equal(lightWith(cave, words).lit, false);
  assert.equal(lightWith(at('lighthouse', ['lantern']), words).lit, false);
  assert.equal(lightWith(at('lighthouse', ['flint_and_wick']), words).lit, false);
  const lit = at('lighthouse', ['lantern', 'flint_and_wick']);
  lit.lantern_lit = true;
  assert.equal(addLightingFromWords(lit, words, noActions()), false);
  assert.equal(lightWith(at('lighthouse', ['lantern', 'flint_and_wick']), "Don't light the lantern yet").lit, false);
  assert.equal(lightWith(at('lighthouse', ['lantern', 'flint_and_wick']), 'What is the lamp made of?').lit, false);
  // a resolver use that already lights it is not doubled
  const w = at('lighthouse', ['lantern', 'flint_and_wick']);
  const a = act({ use: [{ item: 'lantern', target: 'flint' }] });
  assert.equal(addLightingFromWords(w, 'light the lantern', a), false);
  assert.equal(a.use.length, 1);
});

test('Bram cannot narrate changes the code did not make, and the lighthouse clue is a hint, not an event', () => {
  const w = at('lighthouse', ['lantern', 'flint_and_wick']);
  assert.match(placeNote(w, { full: true }), /Never describe the Lantern or the great lamp being lit, anything opening, or anything being taken, unless "What just happened" says so/);
  assert.match(placeNote(w, { full: false }), /unless "What just happened" says so/);
  const clue = cluesOf(w).join(' ');
  assert.doesNotMatch(clue, /\b(is|are) lit\b|lit here/i);
  assert.match(clue, /only the Lantern's flame/);
});

test('the Lantern is a special flame that is kept: the outcome, the sights and the closing say so', () => {
  const w = at('lighthouse', ['lantern', 'flint_and_wick']);
  const r = lightWith(w, 'light the lamp');
  assert.match(r.outcomes.join(' '), /Mere's own flame, and the great lamp catches from it/);
  assert.match(r.outcomes.join(' '), /stays lit in the party's hands/);
  assert.ok(w.satchel.includes('lantern') && w.satchel.includes('flint_and_wick'));
  assert.match(closingNote(r.outcomes), /keeps the lit Lantern and carries it back down to the Drowned Bell/);
  assert.match(bramInstructions([{ name: 'A', bot: false }]), /only the Mere's own flame, which the Lantern of Hollow Mere holds/);
});
