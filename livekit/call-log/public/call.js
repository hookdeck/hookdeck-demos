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
  label.className = 'body-xs muted';
  label.textContent = 'Soundtrack volume ';
  const input = Object.assign(document.createElement('input'), { id: 'soundtrackVolume', type: 'range', min: '0', max: '1', step: '0.05', value: String(soundtrackVolume()) });
  input.addEventListener('input', () => {
    try { localStorage.setItem(SOUNDTRACK_VOLUME_KEY, input.value); } catch { /* per-browser convenience only */ }
    for (const el of audio_box.querySelectorAll('audio[data-soundtrack]')) el.volume = Number(input.value);
  });
  label.append(input);
  $('storyBanner').after(label);
}
soundtrackSlider();
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function peopleList() {
  let list = $('callPeople');
  if (!list) {
    list = document.createElement('ul');
    list.id = 'callPeople';
    list.className = 'body-s';
    $('callStatus').after(list);
  }
  return list;
}

const agent_of = () => room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
const character = (p) => (p?.attributes?.['story.character'] || '').split(',')[0];
let story_ended = false;

// What is happening in the story: the soundtrack that is playing, whose turn it is, or that it has ended.
function renderBanner() {
  const box = $('storyBanner');
  const agent = agent_of();
  if (agent?.attributes?.['story.state'] === 'ended') story_ended = true;
  if (!room && !story_ended) { box.hidden = true; return; }
  const parts = [];
  if (story_ended) {
    box.hidden = false;
    box.className = 'story-banner ended';
    box.innerHTML = '<strong>The story has ended.</strong> <button class="button button--secondary" id="newStoryBtn" type="button">Start a new story</button>';
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
  if (turn && room) {
    parts.push(turn === room.localParticipant.identity
      ? '<strong class="your-turn">Your turn</strong>'
      : `<strong>${esc(attrs['story.turn_name'] || 'Another player')}'s turn</strong>`);
  } else if (agent) parts.push('Listening to the story');
  const sound = [...(room?.remoteParticipants.values() || [])].find((p) => p.identity.startsWith('soundtrack-'));
  if (sound) parts.push(`Now playing: ${esc(sound.identity.slice('soundtrack-'.length))} soundtrack`);
  box.hidden = !parts.length;
  box.className = 'story-banner';
  box.innerHTML = parts.join(' · ');
}

// Who is in the call, what each one is, and who is speaking right now.
function renderPeople() {
  // Drop audio elements whose track has ended (a scene's soundtrack that has finished)
  audio_box.querySelectorAll('audio').forEach((a) => { if (!a.srcObject || a.srcObject.getTracks().every((t) => t.readyState === 'ended')) a.remove(); });
  renderBanner();
  if (!room) { peopleList().innerHTML = ''; return; }
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
  peopleList().innerHTML = everyone.map((p) => {
    const name = p === room.localParticipant ? `${p.name || p.identity} (you)` : p.isAgent ? (character(p) || 'Story agent') : (p.name || p.identity);
    const role = p.isAgent
      ? (p.attributes['lk.agent.state'] || 'joining')
      : p.identity.startsWith('soundtrack-') ? 'scene soundtrack' : 'player';
    return `<li>${speaking.has(p.identity) ? '<strong>speaking</strong> · ' : ''}${esc(name)} · ${esc(role)}</li>`;
  }).join('');
}

// What is said, as subtitles. The agent publishes each spoken line, and each player's recognized speech,
// as a text stream on the `lk.transcription` topic. The agent's lines arrive in pieces as it speaks; a
// player's arrive as the recognizer updates them.
const lines = new Map();
function showLine(id, who, text, final) {
  const box = $('transcript');
  let li = lines.get(id);
  if (!li) {
    li = document.createElement('li');
    lines.set(id, li);
    box.append(li);
    while (box.children.length > 80) box.firstChild.remove();
  }
  li.className = final ? '' : 'interim';
  li.innerHTML = `<strong>${esc(who)}</strong> ${esc(text)}`;
  box.scrollTop = box.scrollHeight;
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
      showLine(attrs['lk.segment_id'] || reader.info.id, who, text, final);
      return;
    }
    // The agent's speech arrives a few words at a time, each piece as its own stream: join pieces into one line
    // until the line is final or the agent pauses for more than a couple of seconds
    const now = Date.now();
    if (!agent_line || agent_line.final || agent_line.who !== who || now - agent_line.at > 2500) agent_line = { id: `agent-${agent_lines++}`, who, text: '', at: now, final: false };
    agent_line.text = `${agent_line.text} ${text.trim()}`.trim();
    agent_line.at = now;
    agent_line.final = final;
    showLine(agent_line.id, who, agent_line.text, final);
  });
}

// Gestures from a mute player such as Pixel arrive as chat messages on the standard `lk.chat` topic
function watchChat(r) {
  r.registerTextStreamHandler('lk.chat', async (reader, participant) => {
    const text = await reader.readAll();
    showLine(`chat-${reader.info.id}`, speakerName(participant.identity), text, true);
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
  const response = await fetch('/api/test-participant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: room_name }) });
  const data = await response.json();
  if (!response.ok) return fail(data.error);
  say(`Connected to ${room_name}. Pixel, a mute traveller, has joined.`);
});
