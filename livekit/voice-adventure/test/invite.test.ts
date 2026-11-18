import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { Browser, chromium, Page } from 'playwright';

// The invite link, in a browser: after joining, the page shows a copyable link with ?room=<story room>, and opening that link
// joins the same room. The app (/api/*) and livekit-client are stubbed, so no call and no LiveKit project are needed.
describe('invite link', () => {
  const pub = path.join(__dirname, '..', 'public');
  let browser: Browser;
  let server: http.Server;
  let base = '';
  const asked: any[] = [];

  // A stand-in for livekit-client: a Room that "connects" and has nobody else in it
  const fakeLiveKit = `
    export const RoomEvent = new Proxy({}, { get: (_, k) => String(k) });
    export const Track = { Kind: { Audio: 'audio' } };
    export class Room {
      constructor() { this.remoteParticipants = new Map(); this.activeSpeakers = []; this.canPlaybackAudio = true; this.listeners = {};
        this.localParticipant = { identity: 'web-1', name: 'Priya', attributes: {}, setMicrophoneEnabled: async () => {} }; }
      on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
      registerTextStreamHandler() {}
      async connect() {}
      async startAudio() {}
      disconnect() { for (const fn of this.listeners.Disconnected || []) fn(); }
    }`;

  before(async () => {
    server = http.createServer((req, res) => {
      const file = path.join(pub, decodeURIComponent((req.url || '/').split('?')[0]));
      const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(pub, 'index.html');
      const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
      res.setHeader('content-type', types[path.extname(target)] || 'application/octet-stream');
      res.end(fs.readFileSync(target));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  });
  after(async () => { await browser?.close(); server?.close(); });

  async function open(url: string, token_reply: (body: any) => { status: number; json: any }): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await page.route('https://esm.sh/**', (route) => route.fulfill({ contentType: 'text/javascript', body: fakeLiveKit }));
    await page.route('https://fonts.*/**', (route) => route.abort());
    await page.route('**/api/token', (route) => { const body = route.request().postDataJSON(); asked.push(body); const r = token_reply(body); return route.fulfill({ status: r.status, json: r.json }); });
    await page.route('**/api/{flow,chronicle,calls,deliveries,outbound,state,answered}', (route) => route.fulfill({ json: [] }));
    await page.goto(url);
    return page;
  }

  it('shows a copyable link with the room once you have joined, and not before', async () => {
    const page = await open(`${base}/`, (body) => ({ status: 200, json: { url: 'wss://x.test', token: 't', room: 'story-abc123', identity: 'web-1' } }));
    assert.equal(await page.locator('#invite').isHidden(), true);
    await page.locator('#joinBtn').click();
    await page.locator('#invite').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#inviteLink').inputValue(), `${base}/?room=story-abc123`);
    assert.equal(await page.locator('#inviteLink').getAttribute('readonly') !== null, true);
    assert.equal(await page.locator('#inviteCopy').isVisible(), true);
    // A Join with no invite asks for a new story: no room in the request
    assert.deepEqual(Object.keys(asked.at(-1)), ['name']);
    await page.locator('#leaveBtn').click();
    await page.locator('#invite').waitFor({ state: 'hidden' });
    await page.close();
  });

  it('opening the link joins that room: the request names it, and the address bar is cleaned once used', async () => {
    const page = await open(`${base}/?room=story-abc123`, () => ({ status: 200, json: { url: 'wss://x.test', token: 't', room: 'story-abc123', identity: 'web-2' } }));
    assert.equal(await page.locator('#inviteNote').isVisible(), true);
    await page.locator('#joinBtn').click();
    await page.locator('#invite').waitFor({ state: 'visible' });
    assert.equal(asked.at(-1).room, 'story-abc123');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('#inviteNote').isHidden(), true);
    assert.equal(await page.locator('#inviteLink').inputValue(), `${base}/?room=story-abc123`);
    await page.close();
  });

  it('a closed or unknown story says so and does not join', async () => {
    const page = await open(`${base}/?room=story-ffffff`, () => ({ status: 404, json: { error: 'That story is not open (it may have ended).' } }));
    await page.locator('#joinBtn').click();
    await page.locator('#callMessage').waitFor({ state: 'visible' });
    assert.match(await page.locator('#callMessage').innerText(), /That story is not open/);
    assert.equal(await page.locator('#invite').isHidden(), true);
    assert.equal(await page.locator('#joinBtn').isEnabled(), true);
    await page.close();
  });
});
