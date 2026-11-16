// Join a call from the browser with livekit-client and a token the server minted. The API key and
// secret stay on the server: the token can join one room for 10 minutes.
// Pinned exact version, loaded as an ES module from esm.sh (no build step).
import { Room, RoomEvent, Track } from 'https://esm.sh/livekit-client@2.24.0';

const $ = (id) => document.getElementById(id);
const say = (text) => { $('callStatus').textContent = text; };
const fail = (text) => { const m = $('callMessage'); m.hidden = !text; m.textContent = text || ''; m.className = 'message body-s error'; };
let room = null;
let room_name = null;

// Remote audio (the game master, other players, the scene soundtrack) plays through hidden <audio> elements.
const audio_box = document.createElement('div');
audio_box.hidden = true;
document.body.append(audio_box);
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

// Who is in the call, what each one is, and who is speaking right now.
function renderPeople() {
  if (!room) { peopleList().innerHTML = ''; return; }
  const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()];
  peopleList().innerHTML = everyone.map((p) => {
    const name = p === room.localParticipant ? `${p.name || p.identity} (you)` : p.isAgent ? 'Story agent' : (p.name || p.identity);
    const role = p.isAgent
      ? (p.attributes['lk.agent.state'] || 'joining')
      : p.identity.startsWith('soundtrack-') ? 'scene soundtrack' : 'player';
    return `<li>${speaking.has(p.identity) ? '<strong>speaking</strong> · ' : ''}${esc(name)} · ${esc(role)}</li>`;
  }).join('');
}

function watchRoom(r) {
  r.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) audio_box.append(track.attach());
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
  say(`Connected to ${room_name}. A silent bot player, Pixel, has joined.`);
});
