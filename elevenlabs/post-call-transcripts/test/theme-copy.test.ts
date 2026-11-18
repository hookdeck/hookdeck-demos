import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const PUBLIC = path.join(__dirname, '../public');
const read = (file: string) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

// Runs the shared theme hook with the demo's real copy file against a tiny fake DOM and checks the wording swap.
function setup(saved: string | null) {
  const store: Record<string, string> = saved ? { 'hookdeck-demo-theme': saved } : {};
  const make = (attrs: Record<string, string>, html = '') => {
    const el: any = { dataset: {}, html, attrs: { ...attrs }, classList: { toggle() {} } };
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    }
    Object.defineProperty(el, 'innerHTML', { get: () => el.html, set: (v) => { el.html = v; } });
    el.getAttribute = (n: string) => el.attrs[n] ?? null;
    el.setAttribute = (n: string, v: string) => { el.attrs[n] = v; };
    return el;
  };
  const title = make({ 'data-copy': 'hero_title' }, 'ElevenLabs post-call transcripts with Hookdeck');
  const heading = make({ 'data-copy': 'conversations_title' }, 'Conversations');
  const root = make({ 'data-demo-theme': 'salon', 'data-demo-theme-default': 'true' });
  const document: any = {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll: (s: string) => (s === '[data-copy]' ? [title, heading] : []),
    addEventListener() {},
    dispatchEvent() { return true; },
  };
  const window: any = {};
  const context = vm.createContext({ window, document, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, CustomEvent: class {} });
  vm.runInContext(read('theme-salon.copy.js'), context);
  vm.runInContext(read('theme.js'), context);
  return { window, store, title, heading, root };
}

test('Salon is the default theme: with no saved choice its wording is on', () => {
  const { window, title, heading, root } = setup(null);
  assert.equal(root.dataset.theme, 'salon');
  assert.equal(title.html, 'Hookdeck Hair booking line');
  assert.equal(heading.html, 'Appointment book');
  assert.equal(window.HookdeckTheme.copy('call_btn', 'Call Hookdeck Hair'), 'Call the salon');
  assert.equal(window.HookdeckTheme.copy('badge_unknown', 'Fallback'), 'Fallback');
});

test('another mode restores the plain wording; Salon brings it back', () => {
  const { window, store, title, heading } = setup(null);
  for (const mode of ['light', 'dark', 'system']) {
    store['hookdeck-demo-theme'] = mode;
    window.HookdeckTheme.apply();
    assert.equal(title.html, 'ElevenLabs post-call transcripts with Hookdeck', mode);
    assert.equal(heading.html, 'Conversations', mode);
    assert.equal(window.HookdeckTheme.copy('call_btn', 'Call Hookdeck Hair'), 'Call Hookdeck Hair', mode);
  }
  store['hookdeck-demo-theme'] = 'salon';
  window.HookdeckTheme.apply();
  assert.equal(heading.html, 'Appointment book');
});

test('every data-copy key in index.html has Salon wording, and so does every runtime key the scripts ask for', () => {
  const window: any = {};
  vm.runInContext(read('theme-salon.copy.js'), vm.createContext({ window }));
  const copy = window.HookdeckThemeCopies.salon;
  const keys = [...read('index.html').matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(key in copy, `missing copy for data-copy="${key}"`);
  const runtime = [
    ...read('app.js').matchAll(/wording\('([a-z_]+)'/g),
    // call.js asks for its wording by keys named call_* and end_btn
    ...read('call.js').matchAll(/'((?:call|end)_[a-z_]+)'/g),
  ].map((m) => m[1]);
  assert.ok(runtime.includes('call_btn') && runtime.includes('end_btn') && runtime.includes('empty'));
  for (const key of runtime) assert.ok(key in copy, `missing copy for runtime key "${key}"`);
});

test('the Salon wording from the spec board', () => {
  const window: any = {};
  vm.runInContext(read('theme-salon.copy.js'), vm.createContext({ window }));
  const copy = window.HookdeckThemeCopies.salon;
  assert.equal(copy.hero_title, 'Hookdeck Hair booking line');
  assert.equal(copy.eyebrow, '{ Hookdeck + ElevenLabs } · Hookdeck Hair booking line');
  assert.equal(copy.talk_title, 'Ring the booking line');
  assert.equal(copy.call_btn, 'Call the salon');
  assert.equal(copy.retry_title, 'Bad line');
  assert.equal(copy.conversations_title, 'Appointment book');
});

test('roles wording is in the base page, not only in the theme', () => {
  const html = read('index.html');
  for (const text of ['The customer', 'The booking assistant', 'Hookdeck Hair', 'Ringing to book a haircut', "Answers the salon&#39;s phone line|Answers the salon's phone line", 'Call Hookdeck Hair', 'Call the booking line']) {
    assert.match(html, new RegExp(text), text);
  }
  // The theme's copy file keeps only wording particular to the salon's voice: no keys for the role cards
  assert.doesNotMatch(read('theme-salon.copy.js'), /"(customer|assistant|role)/);
});

test('the shared hook names no specific theme', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../public/theme.js'), 'utf8');
  assert.doesNotMatch(shared.replace(/\/\/.*$/gm, ''), /salon|hookdeck hair|elevenlabs/i);
});

test('the focused layout: every ⓘ is a real button with an aria-label that opens a dialog in the page', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/<button[^>]*data-info="([^"]+)"[^>]*>/g)];
  assert.deepEqual(buttons.map((b) => b[1]).sort(), ['assistant', 'call', 'diary', 'hero', 'retry']);
  for (const [tag, id] of buttons) {
    assert.match(tag, /aria-label="[^"]+"/, `${id} needs an aria-label`);
    assert.match(html, new RegExp(`<dialog[^>]*id="info-${id}"`), `no dialog for ${id}`);
  }
  // The deliveries ⓘ is a hover tip: a button with an aria-label that describes itself by its bubble
  assert.match(html, /<button[^>]*aria-label="About deliveries received"[^>]*aria-describedby="tipDeliveries"/);
  assert.match(html, /id="tipDeliveries" role="tooltip"/);
});

test('the main view keeps no explanatory paragraph: only the hero line, the Say prompt and footer are prose', () => {
  const html = read('index.html');
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  const paragraphs = [...main.matchAll(/<p class="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[2].replace(/<[^>]+>/g, '').trim());
  assert.equal(paragraphs.length, 2, paragraphs.join(' | '));
  assert.match(paragraphs[0], /^You call the Hookdeck Hair booking line/);
  assert.ok(paragraphs[0].split(/\s+/).length <= 12, 'the hero line is 12 words or fewer');
  assert.match(paragraphs[1], /^Say:/);
});
