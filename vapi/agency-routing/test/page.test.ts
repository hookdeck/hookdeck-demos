import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { after, before, describe, it } from 'node:test';
import { Browser, chromium, Page } from 'playwright';

process.env.LOOKUP_DELAY_MS = '1200';
process.env.VAPI_PUBLIC_KEY = 'pk-test';
process.env.ACME_ASSISTANT_ID = 'asst-acme';
process.env.GLOBEX_ASSISTANT_ID = 'asst-globex';
import { createApp, logs } from '../src/server';

// The main view in a real browser: the focused layout (ⓘ dialog and hover tips), the roles on each client's card, the
// Switchboard theme and its switch, and the "While you wait" panel following a simulated async tool call.
describe('main view', () => {
  let browser: Browser;
  let page: Page;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  const post = (path: string, message: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });

  before(async () => {
    server = createApp().listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/api/flow', (route) => route.fulfill({ json: { now: new Date().toISOString(), team_id: null, sender_label: 'Vapi', app_label: 'Demo app', messages: [] } }));
    await page.route('**/esm.sh/**', (route) => route.abort());
    await page.goto(base);
    await page.waitForSelector('.client');
  });
  after(async () => { await browser.close(); server.close(); });

  it('Switchboard is the default theme, with its wording, and Light and Dark restore the plain wording', async () => {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'switchboard');
    assert.equal(await page.locator('#client-acme h2').innerText(), 'LINE 1 · ACME DENTAL');
    assert.equal(await page.locator('#call-acme button').innerText(), 'PLUG IN AND CALL');
    assert.match(await page.locator('#call-acme .status').innerText(), /On hook/);
    await page.click('[data-theme-option="light"]');
    assert.equal(await page.locator('html').getAttribute('data-theme'), null);
    assert.equal(await page.locator('#client-acme h2').innerText(), 'Acme Dental');
    assert.equal(await page.locator('#call-acme button').innerText(), 'Call Acme Dental');
    assert.match(await page.locator('#call-acme .status').innerText(), /Idle/);
    await page.click('[data-theme-option="dark"]');
    assert.ok(await page.locator('html').evaluate((el) => el.classList.contains('dark')));
    await page.click('[data-theme-option="switchboard"]');
    assert.equal(await page.locator('#client-acme .log-title').innerText(), 'LINE LOG');
  });

  it('each card names the agent and the caller without opening anything', async () => {
    const text = await page.locator('#client-acme .roles').innerText();
    assert.match(text, /The agent/i);
    assert.match(text, /Phone receptionist/i);
    assert.match(text, /The caller · you/i);
    assert.match(text, /Priya Shah/i);
    assert.match(await page.locator('#client-globex .roles').innerText(), /Phone dispatcher/i);
  });

  it('the ⓘ dialog opens, and closes on Esc, Close and a click outside, returning focus to the button', async () => {
    const opener = page.locator('button[data-info="hero"]');
    for (const how of ['escape', 'close', 'outside']) {
      await opener.click();
      assert.ok(await page.locator('#info-hero').evaluate((d: HTMLDialogElement) => d.open), `open (${how})`);
      assert.equal(await page.locator('#info-hero h3').innerText(), 'HOW THIS DEMO WORKS');
      if (how === 'escape') await page.keyboard.press('Escape');
      else if (how === 'close') await page.locator('#info-hero .button').click();
      else await page.mouse.click(5, 500);
      assert.ok(!(await page.locator('#info-hero').evaluate((d: HTMLDialogElement) => d.open)), `closed (${how})`);
      assert.ok(await opener.evaluate((el) => el === document.activeElement), `focus returns (${how})`);
    }
  });

  it('the hover tips show on hover and on keyboard focus, and hide on Esc', async () => {
    const info = page.locator('#client-acme .chaos .info');
    const bubble = page.locator('#tip-chaos-acme');
    assert.equal(await bubble.evaluate((el) => getComputedStyle(el).display), 'none');
    await info.hover();
    assert.equal(await bubble.evaluate((el) => getComputedStyle(el).display), 'block');
    assert.match(await bubble.innerText(), /retries it after about 10s/);
    await page.mouse.move(5, 5);
    assert.equal(await bubble.evaluate((el) => getComputedStyle(el).display), 'none');
    await info.focus();
    assert.equal(await bubble.evaluate((el) => getComputedStyle(el).display), 'block');
    await page.keyboard.press('Escape');
    assert.equal(await bubble.evaluate((el) => getComputedStyle(el).display), 'none');
    await page.locator('#client-acme .log .info').hover();
    assert.match(await page.locator('#tip-log-acme').innerText(), /about four webhooks/);
  });

  it('the main view has no explanatory paragraphs: the hero is the title and one short line', async () => {
    const line = await page.locator('.hero__line p').innerText();
    assert.ok(line.split(/\s+/).length <= 12, line);
    assert.equal(await page.locator('.expect').count(), 0);
  });

  it('"While you wait" follows an async tool call from the app\'s own log, then the result', async () => {
    assert.ok(await page.locator('#wait-acme').evaluate((el: HTMLElement) => el.hidden), 'hidden before any lookup');
    const call = { id: 'call-wait-1', assistantId: 'asst-acme', monitor: { controlUrl: 'http://localhost:9/none' } };
    await post('/clients/acme/webhook', { type: 'tool-calls', call, toolCallList: [{ id: 'tc-wait-1', type: 'function', function: { name: 'lookup_customer', arguments: { customer_name: 'Priya Shah' } } }] });
    await page.waitForSelector('#wait-acme:not([hidden])');
    const text = await page.locator('#wait-steps-acme').innerText();
    assert.match(text, /Tool request received/);
    assert.match(text, /lookup_customer\(“Priya Shah”\)/);
    assert.match(text, /CRM lookup, about 1 s/);
    // Nothing is listening on port 9, so the result cannot be posted: the panel says so
    await page.waitForFunction(() => /not posted/.test(document.querySelector('#wait-steps-acme')!.textContent || ''), null, { timeout: 8000 });
    assert.match(await page.locator('#wait-steps-acme').innerText(), /failed/);
    assert.ok(logs.acme.some((e) => e.type === 'lookup-error'));
    assert.ok(await page.locator('#wait-acme .info').count() === 1, 'the ⓘ is rendered once, outside the steps that re-render');
  });

  it('nothing scrolls sideways at 390 px', async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page is ${overflow}px wider than the viewport`);
  });
});
