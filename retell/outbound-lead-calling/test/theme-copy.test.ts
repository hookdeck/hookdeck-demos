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
  const title = make({ 'data-copy': 'hero_title' }, 'Retell outbound lead calling with Hookdeck');
  const heading = make({ 'data-copy': 'leads_title' }, 'Leads');
  const root = make({ 'data-demo-theme': 'open-house', 'data-demo-theme-default': 'true' });
  const document: any = {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll: (s: string) => (s === '[data-copy]' ? [title, heading] : []),
    addEventListener() {},
    dispatchEvent() { return true; },
  };
  const window: any = {};
  const context = vm.createContext({ window, document, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, CustomEvent: class {} });
  vm.runInContext(read('theme-open-house.copy.js'), context);
  vm.runInContext(read('theme.js'), context);
  return { window, store, title, heading, root };
}

test('Open house is the default theme: with no saved choice its wording is on', () => {
  const { window, title, heading, root } = setup(null);
  assert.equal(root.dataset.theme, 'open-house');
  assert.match(title.html, /Acme Realty lead follow-up/);
  assert.equal(heading.html, 'Enquiries book');
  assert.equal(window.HookdeckTheme.copy('badge_analyzed', 'Analyzed'), 'Particulars filed');
  assert.equal(window.HookdeckTheme.copy('badge_unknown', 'Fallback'), 'Fallback');
});

test('another mode restores the plain wording; Open house brings it back', () => {
  const { window, store, title, heading } = setup(null);
  for (const mode of ['light', 'dark', 'system']) {
    store['hookdeck-demo-theme'] = mode;
    window.HookdeckTheme.apply();
    assert.equal(title.html, 'Retell outbound lead calling with Hookdeck', mode);
    assert.equal(heading.html, 'Leads', mode);
    assert.equal(window.HookdeckTheme.copy('badge_analyzed', 'Analyzed'), 'Analyzed', mode);
  }
  store['hookdeck-demo-theme'] = 'open-house';
  window.HookdeckTheme.apply();
  assert.equal(heading.html, 'Enquiries book');
});

test('every data-copy key in index.html has Open house wording, and every status badge has a label', () => {
  const window: any = {};
  vm.runInContext(read('theme-open-house.copy.js'), vm.createContext({ window }));
  const copy = window.HookdeckThemeCopies['open-house'];
  const keys = [...read('index.html').matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(key in copy, `missing copy for data-copy="${key}"`);
  const badge_block = /const BADGE = \{([\s\S]*?)\};/.exec(read('app.js'))![1];
  for (const status of [...badge_block.matchAll(/(\w+): \[/g)].map((m) => m[1])) assert.ok(`badge_${status}` in copy, `missing badge_${status}`);
});

test('roles wording is in the base page, not only in the theme', () => {
  const html = read('index.html');
  for (const text of ['Sam calls the lead. Retell runs the call; Hookdeck reports the result.', 'New website enquiry', 'From the Acme Realty website', "Lead&#39;s name|Lead's name", 'Property asked about', 'Notes from the form', 'The caller', 'Friendly assistant · Acme Realty', 'The lead · you', 'Submit enquiry and have Sam call', 'Add an enquiry without a call']) {
    assert.match(html, new RegExp(text), text);
  }
  // The theme's copy file keeps only wording particular to Acme Realty: no keys for the roles
  assert.doesNotMatch(read('theme-open-house.copy.js'), /"(caller|lead_card|call_btn|call_button|phone_btn)/);
});

test('the shared hook names no specific theme', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../../../_shared/theme/theme.js'), 'utf8');
  assert.doesNotMatch(shared.replace(/\/\/.*$/gm, ''), /open-house|acme|retell/i);
});

test('the focused layout: every ⓘ is a real button with an aria-label that opens a dialog in the page', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/<button[^>]*data-info="([^"]+)"[^>]*>/g)];
  assert.ok(buttons.length >= 5);
  for (const [tag, id] of buttons) {
    assert.match(tag, /aria-label="[^"]+"/, `${id} needs an aria-label`);
    assert.match(html, new RegExp(`<dialog[^>]*id="info-${id}"`), `no dialog for ${id}`);
  }
  assert.match(read('app.js'), /data-info="retry" aria-label=/);
  assert.match(html, /<dialog[^>]*id="info-retry"/);
});
