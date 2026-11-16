// Join a call from the browser with livekit-client and a token the server minted. The API key and
// secret stay on the server: the token can join one room for 10 minutes.
// Pinned exact version, loaded as an ES module from esm.sh (no build step).
import { Room, RoomEvent } from 'https://esm.sh/livekit-client@2.24.0';

const $ = (id) => document.getElementById(id);
const say = (text) => { $('callStatus').textContent = text; };
const fail = (text) => { const m = $('callMessage'); m.hidden = !text; m.textContent = text || ''; m.className = 'message body-s error'; };
let room = null;
let room_name = null;

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
    const { url, token, room: name, identity } = await (await fetch('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    room = new Room();
    room.on(RoomEvent.Disconnected, () => { say('Left the call. The room closes a few seconds later; room_finished can take up to a minute.'); set_state(false); room = null; });
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    room_name = name;
    say(`Connected to ${name} as ${identity}, microphone on.`);
    set_state(true);
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
  say(`Connected to ${room_name}. A test participant is publishing demo media.`);
});
