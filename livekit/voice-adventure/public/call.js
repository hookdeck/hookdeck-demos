// Join a call from the browser with livekit-client and a token the server minted. The API key and
// secret stay on the server: the token can join one room for 10 minutes.
// Pinned exact version, loaded as an ES module from esm.sh (no build step).
import { Room, RoomEvent, Track } from 'https://esm.sh/livekit-client@2.24.0';

const $ = (id) => document.getElementById(id);
const say = (text) => { $('callStatus').textContent = text; $('callStatus').dataset.themed = ''; };
// A status line built from theme wording is rebuilt when the theme changes
let say_themed = () => {};
const say_copy = (key, fallback, vars) => { const draw = () => { $('callStatus').textContent = T(key, fallback, vars); }; draw(); $('callStatus').dataset.themed = '1'; say_themed = draw; };
const fail = (text) => { const m = $('callMessage'); m.hidden = !text; m.textContent = text || ''; m.className = 'message body-s error'; };
let room = null;
let room_name = null;
let my_identity = null;
// An invite link (`?room=story-...`) joins the story that is already running; without one, Join starts a new story
let invite_room = new URLSearchParams(location.search).get('room');

// Remote audio (the innkeeper, the storyteller, other players, the scene soundtrack) plays through hidden <audio> elements.
const audio_box = document.createElement('div');
audio_box.hidden = true;
document.body.append(audio_box);
// Soundtrack volume, 0 to 1. Defaults low so the characters stay clear; remembered per browser.
const SOUNDTRACK_VOLUME_KEY = 'story.soundtrackVolume';
function soundtrackVolume() {
  try { const v = Number(localStorage.getItem(SOUNDTRACK_VOLUME_KEY)); return Number.isFinite(v) && localStorage.getItem(SOUNDTRACK_VOLUME_KEY) !== null ? v : 0.15; } catch { return 0.15; }
}
function soundtrackSlider() {
  if ($('soundtrackVolume')) return;
  const label = document.createElement('label');
  label.className = 'field inline volume';
  label.innerHTML = '<span class="subtitle-xs">Soundtrack volume</span>';
  const input = Object.assign(document.createElement('input'), { id: 'soundtrackVolume', type: 'range', min: '0', max: '1', step: '0.05', value: String(soundtrackVolume()) });
  input.addEventListener('input', () => {
    try { localStorage.setItem(SOUNDTRACK_VOLUME_KEY, input.value); } catch { /* per-browser convenience only */ }
    for (const el of audio_box.querySelectorAll('audio[data-soundtrack]')) el.volume = Number(input.value);
  });
  label.append(input);
  // The slider sits in a hover tip, like the page's other controls (the bubble's wording follows the theme)
  const tip = document.createElement('span');
  tip.className = 'tip';
  const bubble = document.createElement('span');
  bubble.className = 'tip-bubble';
  bubble.id = 'tipVolume';
  bubble.setAttribute('role', 'tooltip');
  bubble.dataset.copy = 'tip_volume';
  bubble.textContent = 'Only changes what you hear. The soundtrack itself is pulled into the room at each new scene.';
  input.setAttribute('aria-describedby', 'tipVolume');
  tip.append(label, bubble);
  $('callStatus').after(tip);
}
soundtrackSlider();
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function peopleList() {
  let list = $('callPeople');
  if (!list) {
    list = document.createElement('ul');
    list.id = 'callPeople';
    list.className = 'people-list body-s';
    $('storyBanner').after(list);
  }
  return list;
}

const agent_of = () => room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
const character = (p) => (p?.attributes?.['story.character'] || '').split(',')[0];
let story_ended = false;

// What is happening in the story: the soundtrack that is playing, whose turn it is, or that it has ended.
// Plain-theme text and story-theme text sit side by side; the page's CSS shows the one for the theme in use
// (.only-plain / .only-story), so the plain themes keep their wording.
const FLAME = '<svg class="story-ornament story-flame" aria-hidden="true" width="22" height="30" viewBox="0 0 22 30"><path d="M11 1 C15 8 19 11 19 18 C19 24 15 29 11 29 C7 29 3 24 3 18 C3 13 7 10 9 5 C10 9 13 11 11 1 Z" class="flame-outer"></path><path d="M11 12 C13 16 15 18 15 21 C15 24 13 26 11 26 C9 26 7 24 7 21 C7 18 9 16 11 12 Z" class="flame-inner"></path></svg>';

const T = (key, fallback, vars = {}) => {
  const text = (window.HookdeckTheme ? window.HookdeckTheme.copy(key, fallback) : fallback);
  return text.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));
};

// The storyteller has left, or has not answered for 20 s after a player spoke: offer to call him back.
let quiet_since = 0;
function agent_quiet() {
  if (!room || story_ended) return false;
  const agent = agent_of();
  if (!agent) return people_seen_agent;
  const state = agent.attributes?.['lk.agent.state'];
  const waiting = (state === 'thinking' || state === 'listening') && last_player_line_at && Date.now() - last_player_line_at > 20000 && last_agent_line_at < last_player_line_at;
  return Boolean(waiting);
}
let people_seen_agent = false;
let last_player_line_at = 0;
let last_agent_line_at = 0;

function renderBanner() {
  const box = $('storyBanner');
  const agent = agent_of();
  if (agent) people_seen_agent = true;
  if (agent?.attributes?.['story.state'] === 'ended') story_ended = true;
  if (story_ended) $('playerName').readOnly = false;
  if (!room && !story_ended) { box.hidden = true; return; }
  if (story_ended) {
    box.hidden = false;
    box.className = 'message success body-m story-banner story-ended';
    box.innerHTML = `<span class="end-text"><strong class="end-title">${esc(T('ended_title', 'The story has ended.'))}</strong><span class="end-sub">${esc(T('ended_sub', ''))}</span></span>`
      + ` <button class="button" id="newStoryBtn" type="button">${esc(T('new_btn', 'Start a new story'))}</button>`;
    $('newStoryBtn').addEventListener('click', async () => {
      story_ended = false;
      room?.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 600));
      $('joinBtn').click();
    });
    return;
  }
  if (agent_quiet()) {
    box.hidden = false;
    box.className = 'message warning body-m story-banner';
    box.innerHTML = `<span class="story-turn-body"><strong class="turn-title">${esc(T('quiet_title', 'The storyteller has stopped answering'))}</strong><span class="turn-sub">${esc(T('quiet_sub', 'The story is saved where it stopped.'))}</span></span>`
      + ` <button class="button" id="continueBtn" type="button">${esc(T('continue_btn', 'Continue the story'))}</button>`;
    $('continueBtn').addEventListener('click', async () => {
      $('continueBtn').disabled = true;
      const response = await fetch('/api/story/continue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: room_name }) });
      if (!response.ok) { fail((await response.json().catch(() => ({}))).error || 'Could not continue the story.'); $('continueBtn').disabled = false; return; }
      last_player_line_at = 0;
      people_seen_agent = false;
      say('Calling the storyteller back…');
    });
    return;
  }
  const attrs = agent?.attributes || {};
  const turn = attrs['story.turn'];
  const sound = [...(room?.remoteParticipants.values() || [])].find((p) => p.identity.startsWith('soundtrack-'));
  const place = attrs['story.place'] || '';
  const scene = sound ? sound.identity.slice('soundtrack-'.length) : '';
  let tone = 'info';
  let title = '';
  let sub = '';
  let mine = false;
  if (turn && room) {
    mine = turn === room.localParticipant.identity;
    const who = esc(attrs['story.turn_name'] || 'Another player');
    if (mine) tone = 'success';
    title = mine ? T('turn_mine_title', 'Your turn') : T('turn_other_title', "{who}'s turn", { who });
    sub = mine ? T('turn_mine_sub', '') : T('turn_other_sub', '', { who });
  } else if (agent) {
    title = T('listening_title', 'Listening to the story');
    sub = T('listening_sub', '');
  }
  box.hidden = !(title || scene);
  box.className = `message ${tone} body-m story-banner${mine ? ' your-turn' : ''}`;
  box.innerHTML = `<span class="story-turn-body">${mine ? FLAME : ''}${title ? `<strong class="turn-title">${title}</strong>` : ''}${sub ? `<span class="turn-sub">${sub}</span>` : ''}${place ? `<span class="turn-playing badge badge--primary">${esc(T('place_label', 'Place: {place}', { place }))}</span>` : scene ? `<span class="turn-playing badge badge--primary">Now playing: ${esc(scene)}</span>` : ''}</span>`;
}

// Who is in the call, what each one is, and who is speaking right now. An agent's own state
// (listening, thinking, speaking) already says when it is talking, so it gets no second badge.
// What the party carries: item ids from the agent's `story.satchel` attribute, worded by the theme
function renderSatchel() {
  const box = $('satchel');
  const agent = agent_of();
  if (!room || !agent || !agent.attributes?.['story.satchel']) { box.hidden = true; return; }
  const ids = parseSatchel(agent.attributes['story.satchel']);
  box.hidden = false;
  $('satchelItems').innerHTML = ids.length
    ? ids.map((id) => `<li class="badge badge--primary">${esc(T('item_' + id, SATCHEL_PLAIN_LABELS[id]))}</li>`).join('')
    : `<li class="satchel-empty">${esc(T('satchel_empty', 'None yet'))}</li>`;
}

function renderPeople() {
  // Drop audio elements whose track has ended (a scene's soundtrack that has finished)
  audio_box.querySelectorAll('audio').forEach((a) => { if (!a.srcObject || a.srcObject.getTracks().every((t) => t.readyState === 'ended')) a.remove(); });
  renderBanner();
  renderSatchel();
  if (!room) { peopleList().innerHTML = ''; return; }
  // The name Hester wrote in her ledger: a player who joined without a name sees it in the (read-only) name field
  const ledger = parseLedger(agent_of()?.attributes?.['story.ledger']);
  const mine = ledger[room.localParticipant.identity];
  if (mine && $('playerName').value.trim() !== mine && room.localParticipant.identity === my_identity) $('playerName').value = mine;
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
  const pixel_here = everyone.some((p) => p.identity === 'bot-pixel');
  $('testBtn').disabled = pixel_here || !room;
  $('testBtn').textContent = T(pixel_here ? 'pixel_here' : 'pixel_add', pixel_here ? 'Pixel has joined' : 'Add Pixel, a mute player');
  peopleList().innerHTML = everyone.map((p) => {
    const bot = p.identity.startsWith('bot-');
    const name = p === room.localParticipant ? `${p.name || p.identity} (you)` : p.isAgent ? (character(p) || 'Story agent') : (p.name || p.identity);
    const role = p.isAgent ? (p.attributes['lk.agent.state'] || 'joining') : p.identity.startsWith('soundtrack-') ? 'scene soundtrack' : bot ? 'mute player' : 'player';
    const tone = p.isAgent ? 'badge--primary' : p.identity.startsWith('soundtrack-') ? '' : 'badge--success';
    return `<li>${esc(name)} <span class="badge ${tone}">${esc(role)}</span>${speaking.has(p.identity) && !p.isAgent ? ' <span class="badge badge--bold_primary">speaking</span>' : ''}</li>`;
  }).join('');
}

// What is said, as subtitles. The agent publishes each spoken line, and each player's recognized speech,
// as a text stream on the `lk.transcription` topic. The agent's lines arrive in pieces as it speaks; a
// player's arrive as the recognizer updates them.
const lines = new Map();
// One transcript entry per turn: speech-to-text splits an utterance into several segments at each
// pause, so consecutive segments from the same speaker join the newest entry until someone else speaks.
const entries = new WeakMap();
function showLine(id, who, text, final, role = 'player') {
  const box = $('transcript');
  let li = lines.get(id);
  if (!li) {
    const top = box.firstElementChild;
    const top_entry = top && entries.get(top);
    if (top_entry && top_entry.who === who && top_entry.role === role) {
      li = top;
    } else {
      li = document.createElement('li');
      li.dataset.role = role;
      // The first line the storyteller speaks gets an illuminated first letter in the story theme
      if (role === 'storyteller' && !box.querySelector('li[data-role="storyteller"]')) li.dataset.first = 'true';
      entries.set(li, { who, role, segments: new Map() });
      // Newest first, so the transcript reads down from the latest line
      box.prepend(li);
      while (box.children.length > 80) box.lastChild.remove();
    }
    lines.set(id, li);
  }
  const entry = entries.get(li);
  // A mute player's gesture arrives as *Pixel does something.*: show it as an italic line without the asterisks
  const shown = role === 'mute' ? text.replace(/^\s*\*+\s*|\s*\*+\s*$/g, '') : text;
  entry.segments.set(id, { text: shown, final });
  const segments = [...entry.segments.values()];
  li.className = segments.every((seg) => seg.final) ? '' : 'interim';
  if (role === 'player' || role === 'mute') last_player_line_at = Date.now();
  else last_agent_line_at = Date.now();
  const joined = segments.map((seg) => seg.text.trim()).filter(Boolean).join(' ');
  li.innerHTML = `<span class="badge badge--mono speaker">${esc(who)}</span> <span class="line-text">${esc(joined)}</span>`;
  box.scrollTop = 0;
}

function speakerRole(identity) {
  const p = identity === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(identity);
  if (p?.isAgent) return /Hester/.test(p.attributes?.['story.character'] || '') ? 'innkeeper' : 'storyteller';
  return identity.startsWith('bot-') ? 'mute' : 'player';
}

function speakerName(identity) {
  const p = identity === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(identity);
  if (!p) return identity;
  if (p.isAgent) return character(p) || 'Story agent';
  return p === room.localParticipant ? `${p.name || p.identity} (you)` : (p.name || p.identity);
}

let agent_line = null;
let agent_lines = 0;

function watchTranscription(r) {
  r.registerTextStreamHandler('lk.transcription', async (reader, participant) => {
    const attrs = reader.info.attributes || {};
    const who = speakerName(participant.identity);
    const from_agent = room.remoteParticipants.get(participant.identity)?.isAgent;
    let text = '';
    for await (const chunk of reader) text += chunk;
    const final = attrs['lk.transcription_final'] === 'true';
    if (!from_agent) {
      // A player's speech: the recognizer sends the whole phrase again as it improves, under one segment id
      showLine(attrs['lk.segment_id'] || reader.info.id, who, text, final, speakerRole(participant.identity));
      return;
    }
    // The agent's speech arrives a few words at a time, each piece as its own stream: join pieces into one line
    // until the line is final or the agent pauses for more than a couple of seconds
    const now = Date.now();
    if (!agent_line || agent_line.final || agent_line.who !== who || now - agent_line.at > 2500) agent_line = { id: `agent-${agent_lines++}`, who, text: '', at: now, final: false };
    agent_line.text = `${agent_line.text} ${text.trim()}`.trim();
    agent_line.at = now;
    agent_line.final = final;
    showLine(agent_line.id, who, agent_line.text, final, speakerRole(participant.identity));
  });
}

// Gestures from a mute player such as Pixel arrive as chat messages on the standard `lk.chat` topic
function watchChat(r) {
  r.registerTextStreamHandler('lk.chat', async (reader, participant) => {
    const text = await reader.readAll();
    showLine(`chat-${reader.info.id}`, speakerName(participant.identity), text, true, speakerRole(participant.identity));
  });
}

function watchRoom(r) {
  watchTranscription(r);
  watchChat(r);
  r.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      // The scene soundtrack plays under the voices: start it quiet, and let the slider change it.
      if (participant.identity.startsWith('soundtrack-')) {
        el.dataset.soundtrack = 'true';
        el.volume = soundtrackVolume();
      }
      audio_box.append(el);
    }
    renderPeople();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); renderPeople(); });
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!r.canPlaybackAudio) {
      say('The browser blocked audio. Click anywhere on the page to hear the call.');
      document.addEventListener('click', () => r.startAudio(), { once: true });
    }
  });
  for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantNameChanged]) {
    r.on(event, renderPeople);
  }
}

// The invite link: this page's address with the story room, copyable once you are in
function showInvite(name) {
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set('room', name);
  $('inviteLink').value = link.toString();
  $('invite').hidden = !name;
}
function showInviteNote(show) {
  const note = $('inviteNote');
  note.hidden = !show;
  if (show) note.textContent = T('invite_note', 'You have been invited to a story already under way. Type a name and select Join a call.');
}
$('inviteCopy').addEventListener('click', async () => {
  const input = $('inviteLink');
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
  const button = $('inviteCopy');
  button.textContent = T('invite_copied', 'Copied');
  setTimeout(() => { button.textContent = T('invite_copy', 'Copy link'); }, 1500);
});
$('inviteLink').addEventListener('focus', () => $('inviteLink').select());
if (invite_room) showInviteNote(true);

function set_state(connected) {
  $('joinBtn').disabled = connected;
  $('leaveBtn').disabled = !connected;
  $('testBtn').disabled = !connected;
  if (!connected) $('testBtn').textContent = T('pixel_add', 'Add Pixel, a mute player');
  // The name is fixed from joining until the player leaves or the story ends
  $('playerName').readOnly = connected;
  if (!connected) $('invite').hidden = true;
}

$('joinBtn').addEventListener('click', async () => {
  fail('');
  $('joinBtn').disabled = true;
  say('Getting a token…');
  try {
    const response = await fetch('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('playerName').value, ...(invite_room ? { room: invite_room } : {}) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `the app answered ${response.status}`);
    const { url, token, room: name, identity } = data;
    room = new Room();
    story_ended = false;
    lines.clear();
    agent_line = null;
    $('transcript').replaceChildren();
    watchRoom(room);
    room.on(RoomEvent.Disconnected, () => { audio_box.replaceChildren(); room = null; renderPeople(); say('Left the call. The session ends, and the chronicle closes, about a minute after the last person leaves.'); set_state(false); room = null; });
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    room_name = name;
    my_identity = identity;
    say_copy('status_connected', `Connected to ${name} as ${identity}, microphone on.`, { name: $('playerName').value.trim() || identity });
    set_state(true);
    showInvite(name);
    // The invite was used: a later Join (for example "Start a new story") starts a new story instead of returning here
    if (invite_room) { invite_room = null; try { history.replaceState(null, '', location.pathname); } catch { /* the link stays in the address bar */ } showInviteNote(false); }
    await room.startAudio();
    renderPeople();
  } catch (error) {
    fail(`Could not join: ${error.message}. If the page can't reach the microphone, check the browser's permission.`);
    say('');
    set_state(false);
    room?.disconnect();
  }
});

$('leaveBtn').addEventListener('click', async () => {
  await fetch('/api/test-participant/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: room_name }) });
  room?.disconnect();
});

$('testBtn').addEventListener('click', async () => {
  fail('');
  $('testBtn').disabled = true;
  const response = await fetch('/api/test-participant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: room_name }) });
  const data = await response.json();
  if (!response.ok) { $('testBtn').disabled = false; return fail(data.error); }
  say_copy('status_pixel', `Connected to ${room_name}. Pixel, a mute traveller, has joined.`, { room: room_name });
});

document.addEventListener('hookdeck-theme', () => { $('callStatus').dataset.themed && say_themed(); renderPeople(); });
setInterval(() => renderBanner(), 5000);

// Test-only: ?demo=mine|other|ended renders the story UI from sample participants, with no call, so the
// layout can be checked in light and dark without spending anything.
const demo_state = new URLSearchParams(location.search).get('demo');
if (demo_state) {
  const person = (identity, name, extra = {}) => ({ identity, name, isAgent: false, attributes: {}, ...extra });
  const agent = person('agent-1', '', { isAgent: true, attributes: { 'story.character': 'Old Bram Tallow, storyteller', 'lk.agent.state': 'listening', 'story.turn': demo_state === 'mine' ? 'web-1' : demo_state === 'other' ? 'bot-pixel' : '', 'story.turn_name': 'Pixel', 'story.state': demo_state === 'ended' ? 'ended' : 'playing' } });
  if (demo_state === 'quiet') people_seen_agent = true;
  const remotes = [...(demo_state === 'quiet' ? [] : [agent]), person('bot-pixel', 'Pixel'), person('soundtrack-cave', 'Soundtrack: cave')];
  my_identity = 'web-1';
  room = { localParticipant: person('web-1', 'Priya'), remoteParticipants: new Map(remotes.map((p) => [p.identity, p])), activeSpeakers: [agent] };
  // As if joined without a name: the agent's ledger fills the read-only name field
  agent.attributes['story.ledger'] = JSON.stringify({ 'web-1': 'Priya' });
  agent.attributes['story.place'] = 'The Cave under the Mere';
  agent.attributes['story.satchel'] = JSON.stringify(demo_state === 'quiet' ? [] : ['map', 'brass_key']);
  set_state(true);
  showInvite('story-demo01');
  say_copy('status_connected', 'Connected to story-demo as web-1, microphone on.', { name: 'Priya' });
  renderPeople();
  showLine('a', 'Hester Pennywhistle', 'Ah, Priya, we\'ve been expecting you, and your quiet friend, Pixel.', true, 'innkeeper');
  showLine('b', 'Old Bram Tallow', 'The cave is dark and dripping. On a stone ledge sits a brass lantern, its glass cracked, and a small boat knocks against the rocks below.', true, 'storyteller');
  showLine('c', 'Priya (you)', 'I take the Lantern and row across the pool.', true, 'player');
  showLine('d', 'Pixel', '*Pixel holds the lantern up to the cave wall and taps a carving.*', true, 'mute');
}
