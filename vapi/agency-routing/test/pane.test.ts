import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { Browser, chromium, Page } from 'playwright';

// The shared topology pane (public/topology-pane): tabs, the open/closed state and the detail
// strip, against a stubbed /api/flow. Runs the built bundle in headless Chromium.
describe('topology pane', () => {
  let browser: Browser;
  let page: Page;
  const root = path.join(__dirname, '..');

  const message = {
    request_id: 'req_test1', source: 'vapi-acme-dental', received_at: new Date().toISOString(), label: 'end-of-call-report', group: 'call_1',
    verified: true, rejected: false, sender_status: 200, ignored_count: 0, bytes: 1205,
    events: [{
      id: 'evt_test1', status: 'SUCCESSFUL', next_attempt_at: null, app: [{ label: 'returned 200', detail: 'stored' }],
      attempts: [
        { id: 'att1', number: 1, status: 'FAILED', response_status: 500, response_latency: 120, at: '2026-01-01T10:00:00.000Z', error_code: null },
        { id: 'att2', number: 2, status: 'SUCCESSFUL', response_status: 200, response_latency: 45, at: '2026-01-01T10:00:10.000Z', error_code: null },
      ],
    }],
  };

  before(async () => {
    const built = spawnSync('node', [path.join(root, 'scripts', 'build-scenes.mjs')], { cwd: root });
    assert.equal(built.status, 0, String(built.stderr));
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/api/flow', (route) => route.fulfill({ json: { now: new Date().toISOString(), team_id: 'tm_test', sender_label: 'Vapi', app_label: 'Demo app', messages: [message] } }));
    await page.route('**/api/deliveries', (route) => route.fulfill({ json: [] }));
    await page.route('http://pane.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="host"></div>' }));
    await page.goto('http://pane.test/');
    await page.addStyleTag({ path: path.join(root, 'public', 'scenes', 'scenes.css') });
    await page.addStyleTag({ path: path.join(root, 'public', 'topology-pane', 'topology-pane.css') });
    await page.addScriptTag({ path: path.join(root, 'public', 'scenes', 'scenes.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'topology-pane', 'topology-pane.js') });
  });

  after(async () => {
    await browser?.close();
  });

  it('opens by default, collapses, and has a tab per scene', async () => {
    await page.evaluate(() => { (window as any).pane = (window as any).TopologyPane.mount({ kit: (window as any).HookdeckScenes, deliveries: { endpoint: '/api/deliveries', map: () => null } }); });
    assert.ok(await page.evaluate(() => document.body.classList.contains('tp-open')));
    assert.deepEqual(await page.locator('.tp-tabs button').allInnerTexts(), ['Live', 'Call and async tool', 'Two clients', 'Duplicate dropped', 'Bad signature', 'App down, retry succeeds']);
    await page.locator('#tp-toggle').click();
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('tp-open'))));
    await page.locator('#tp-toggle').click();
  });

  it('click on a node fills the detail strip with attempts, retry gap and a dashboard link', async () => {
    await page.waitForFunction(() => (window as any).pane.feed.messages().length === 1);
    await page.locator('svg.stage .nodes g').nth(3).dispatchEvent('click');
    const text = await page.locator('#tp-detail').innerText();
    for (const part of ['end-of-call-report', 'Verified', 'Vapi got 200', 'attempt 1: 500', 'retry after 10 s', 'attempt 2: 200', 'Demo app: returned 200 (stored)'])
      assert.ok(text.includes(part), `${part} in: ${text}`);
    const href = await page.locator('#tp-detail a.tp-link').getAttribute('href');
    assert.equal(href, 'https://dashboard.hookdeck.com/events/evt_test1?team_id=tm_test');
  });

  it('a scripted tab shows its caption and hides the detail strip', async () => {
    await page.getByRole('tab', { name: 'Call and async tool' }).click();
    assert.ok(await page.locator('#tp-detail').isHidden());
    assert.ok((await page.locator('#tp-caption').innerText()).length > 10);
    await page.locator('#tp-next').click();
    assert.match(await page.locator('#tp-count').innerText(), /^2 \//);
  });
});
