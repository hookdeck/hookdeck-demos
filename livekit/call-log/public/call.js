// Join a call from the browser with livekit-client and a token the server minted. The API key and
// secret stay on the server: the token can join one room for 10 minutes.
// Pinned exact version, loaded as an ES module from esm.sh (no build step).
import { Room, RoomEvent, Track } from 'https://esm.sh/livekit-client@2.24.0';

const $ = (id) => document.getElementById(id);
const say = (text) => { $('callStatus').textContent = text; };
const fail = (text) => { const m = $('callMessage'); m.hidden = !text; m.textContent = text || ''; m.className = 'message body-s error'; };
let room = null;
let room_name = null;

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
  $('callStatus').after(label);
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

function renderBanner() {
  const box = $('storyBanner');
  const agent = agent_of();
  if (agent?.attributes?.['story.state'] === 'ended') story_ended = true;
  if (!room && !story_ended) { box.hidden = true; return; }
  if (story_ended) {
    box.hidden = false;
    box.className = 'message success body-m story-banner story-ended';
    box.innerHTML = '<span class="only-plain">The story has ended.</span>'
      + '<span class="only-story end-text"><strong class="end-title">The End</strong><span class="end-sub">The lantern is lit and Hollow Mere is quiet again.</span></span>'
      + ' <button class="button" id="newStoryBtn" type="button"><span class="only-plain">Start a new story</span><span class="only-story">Begin a new tale</span></button>';
    $('newStoryBtn').addEventListener('click', async () => {
      story_ended = false;
      room?.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 600));
      $('joinBtn').click();
    });
    return;
  }
  const attrs = agent?.attributes || {};
  const turn = attrs['story.turn'];
  const sound = [...(room?.remoteParticipants.values() || [])].find((p) => p.identity.startsWith('soundtrack-'));
  const scene = sound ? sound.identity.slice('soundtrack-'.length) : '';
  let tone = 'info';
  let plain = '';
  let title = '';
  let sub = '';
  let mine = false;
  if (turn && room) {
    mine = turn === room.localParticipant.identity;
    const who = esc(attrs['story.turn_name'] || 'Another player');
    if (mine) tone = 'success';
    plain = `<strong>${mine ? 'Your turn' : `${who}'s turn`}</strong>`;
    title = mine ? 'Your Turn' : `${who}'s Turn`;
    sub = mine ? 'Old Bram waits for you.' : `Old Bram is listening to ${who}.`;
  } else if (agent) {
    plain = 'Listening to the story';
    title = 'The Tale Unfolds';
    sub = 'Old Bram is telling it.';
  }
  const badges = [plain && `<span class="only-plain">${plain}</span>`];
  if (scene) badges.push(`<span class="badge badge--primary only-plain">Now playing: ${esc(scene)}</span>`);
  const story = title
    ? `<span class="only-story story-turn-body">${mine ? FLAME : ''}<strong class="turn-title">${title}</strong><span class="turn-sub">${sub}</span>${scene ? `<span class="turn-playing">Now playing: ${esc(scene)}</span>` : ''}</span>`
    : '';
  box.hidden = !(plain || scene);
  box.className = `message ${tone} body-m story-banner${mine ? ' your-turn' : ''}`;
  box.innerHTML = badges.filter(Boolean).join(' ') + story;
}

// Who is in the call, what each one is, and who is speaking right now. An agent's own state
// (listening, thinking, speaking) already says when it is talking, so it gets no second badge.
function renderPeople() {
  // Drop audio elements whose track has ended (a scene's soundtrack that has finished)
  audio_box.querySelectorAll('audio').forEach((a) => { if (!a.srcObject || a.srcObject.getTracks().every((t) => t.readyState === 'ended')) a.remove(); });
  renderBanner();
  if (!room) { peopleList().innerHTML = ''; return; }
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
  const pixel_here = everyone.some((p) => p.identity === 'bot-pixel');
  $('testBtn').disabled = pixel_here || !room;
  $('testBtn').textContent = pixel_here ? 'Pixel has joined' : 'Add Pixel, a mute player';
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
function showLine(id, who, text, final, role = 'player') {
  const box = $('transcript');
  let li = lines.get(id);
  if (!li) {
    li = document.createElement('li');
    li.dataset.role = role;
    // The first line the storyteller speaks gets an illuminated first letter in the story theme
    if (role === 'storyteller' && !box.querySelector('li[data-role="storyteller"]')) li.dataset.first = 'true';
    lines.set(id, li);
    box.append(li);
    while (box.children.length > 80) box.firstChild.remove();
  }
  li.className = final ? '' : 'interim';
  li.innerHTML = `<span class="badge badge--mono speaker">${esc(who)}</span> <span class="line-text">${esc(text)}</span>`;
  box.scrollTop = box.scrollHeight;
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
  for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantAttributesChanged]) {
    r.on(event, renderPeople);
  }
}

function set_state(connected) {
  $('joinBtn').disabled = connected;
  $('leaveBtn').disabled = !connected;
  $('testBtn').disabled = !connected;
  if (!connected) $('testBtn').textContent = 'Add Pixel, a mute player';
}

$('joinBtn').addEventListener('click', async () => {
  fail('');
  $('joinBtn').disabled = true;
  say('Getting a token…');
  try {
    const { url, token, room: name, identity } = await (await fetch('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('playerName').value }) })).json();
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
    say(`Connected to ${name} as ${identity}, microphone on.`);
    set_state(true);
    await room.startAudio();
    renderPeople();
  } catch (error) {
    fail(`Could not join: ${error.message}. Check that the browser has microphone access.`);
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
  say(`Connected to ${room_name}. Pixel, a mute traveller, has joined.`);
});

// Test-only: ?demo=mine|other|ended renders the story UI from sample participants, with no call, so the
// layout can be checked in light and dark without spending anything.
const demo_state = new URLSearchParams(location.search).get('demo');
if (demo_state) {
  const person = (identity, name, extra = {}) => ({ identity, name, isAgent: false, attributes: {}, ...extra });
  const agent = person('agent-1', '', { isAgent: true, attributes: { 'story.character': 'Old Bram Tallow, storyteller', 'lk.agent.state': 'listening', 'story.turn': demo_state === 'mine' ? 'web-1' : demo_state === 'other' ? 'bot-pixel' : '', 'story.turn_name': 'Pixel', 'story.state': demo_state === 'ended' ? 'ended' : 'playing' } });
  const remotes = [agent, person('bot-pixel', 'Pixel'), person('soundtrack-cave', 'Soundtrack: cave')];
  room = { localParticipant: person('web-1', 'Priya'), remoteParticipants: new Map(remotes.map((p) => [p.identity, p])), activeSpeakers: [agent] };
  $('callStatus').textContent = 'Connected to story-demo as web-1, microphone on.';
  renderPeople();
  showLine('a', 'Hester Pennywhistle', 'Ah, Priya, we\'ve been expecting you, and your quiet friend, Pixel.', true, 'innkeeper');
  showLine('b', 'Old Bram Tallow', 'The cave is dark and dripping. A stone ledge holds the Lantern. Priya, will you take it and leave by the tunnel, or row across the pool?', true, 'storyteller');
  showLine('c', 'Priya (you)', 'I take the Lantern and row across the pool.', true, 'player');
  showLine('d', 'Pixel', '*Pixel holds the lantern up to the cave wall and taps a carving.*', true, 'mute');
}
