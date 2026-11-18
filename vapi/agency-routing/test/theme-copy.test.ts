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
  const title = make({ 'data-copy': 'hero_title' }, 'Vapi agency routing <em>with Hookdeck</em>');
  const heading = make({ 'data-copy': 'log_title' }, 'Received by this endpoint');
  const root = make({ 'data-demo-theme': 'switchboard', 'data-demo-theme-default': 'true' });
  const document: any = {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll: (s: string) => (s === '[data-copy]' ? [title, heading] : []),
    addEventListener() {},
    dispatchEvent() { return true; },
  };
  const window: any = {};
  const context = vm.createContext({ window, document, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, CustomEvent: class {} });
  vm.runInContext(read('theme-switchboard.copy.js'), context);
  vm.runInContext(read('theme.js'), context);
  return { window, store, title, heading, root };
}

test('Switchboard is the default theme: with no saved choice its wording is on', () => {
  const { window, title, heading, root } = setup(null);
  assert.equal(root.dataset.theme, 'switchboard');
  assert.equal(title.html, 'The agency <em>switchboard</em>');
  assert.equal(heading.html, 'Line log');
  assert.equal(window.HookdeckTheme.copy('call_start', 'Call {client}'), 'Plug in and call');
  assert.equal(window.HookdeckTheme.copy('call_end', 'End call'), 'Pull the plug');
  assert.equal(window.HookdeckTheme.copy('status_idle', 'Idle'), 'On hook');
  assert.equal(window.HookdeckTheme.copy('status_in_call', 'In call'), 'Line open');
  assert.equal(window.HookdeckTheme.copy('log_empty', 'Nothing received yet.'), 'Nothing on this line yet.');
  assert.equal(window.HookdeckTheme.copy('badge_unknown', 'Fallback'), 'Fallback');
});

test('Light, Dark and System restore the plain wording; Switchboard brings it back', () => {
  const { window, store, title, heading } = setup(null);
  for (const mode of ['light', 'dark', 'system']) {
    store['hookdeck-demo-theme'] = mode;
    window.HookdeckTheme.apply();
    assert.equal(title.html, 'Vapi agency routing <em>with Hookdeck</em>', mode);
    assert.equal(heading.html, 'Received by this endpoint', mode);
    assert.equal(window.HookdeckTheme.copy('call_start', 'Call {client}'), 'Call {client}', mode);
    assert.equal(window.HookdeckTheme.copy('status_idle', 'Idle'), 'Idle', mode);
  }
  store['hookdeck-demo-theme'] = 'switchboard';
  window.HookdeckTheme.apply();
  assert.equal(heading.html, 'Line log');
});

test('every data-copy key in index.html, and every runtime wording() key, has Switchboard wording', () => {
  const window: any = {};
  vm.runInContext(read('theme-switchboard.copy.js'), vm.createContext({ window }));
  const copy = window.HookdeckThemeCopies['switchboard'];
  const html = read('index.html');
  // Static keys, and the per-client line number keys the column template builds (line_${slug})
  const keys = new Set([...html.matchAll(/data-copy="([^"$]+)"/g)].map((m) => m[1]));
  assert.ok(keys.size >= 5);
  for (const key of keys) assert.ok(key in copy, `missing copy for data-copy="${key}"`);
  for (const slug of ['acme', 'globex']) assert.ok(`line_${slug}` in copy, `missing line_${slug}`);
  assert.match(html, /data-copy="line_\$\{esc\(c\.slug\)\}"/);
  for (const [, key] of html.matchAll(/wording\('([a-z_]+)'/g)) assert.ok(key in copy, `missing copy for wording('${key}')`);
});

test('roles wording is in the base page and the client config, not only in the theme', () => {
  const html = read('index.html');
  for (const text of ['The agent', 'The caller &middot; you', 'Call {client}', 'End call', 'agent_role', 'caller_name', 'caller_note']) {
    assert.ok(html.includes(text), text);
  }
  const clients = fs.readFileSync(path.join(__dirname, '../src/clients.ts'), 'utf8');
  for (const text of ["agent_role: 'Phone receptionist'", "agent_role: 'Phone dispatcher'"]) assert.ok(clients.includes(text), text);
  // The theme's copy file keeps only the telephone-exchange vocabulary: no keys for the roles
  assert.doesNotMatch(read('theme-switchboard.copy.js'), /"(agent|caller|role)/);
});

test('the shared hook names no specific theme', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../public/theme.js'), 'utf8');
  assert.doesNotMatch(shared.replace(/\/\/.*$/gm, ''), /switchboard|acme|vapi/i);
});

test('the theme stylesheet only restyles main and the ⓘ dialogs, never the Data flow pane', () => {
  const css = read('theme-switchboard.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('}').map((rule) => rule.split('{')[0]).filter((s) => s.trim() && !s.trim().startsWith('@')).flatMap((s) => s.split(','));
  for (const selector of selectors) {
    const s = selector.trim();
    if (!s) continue;
    assert.match(s, /^html\[data-theme="switchboard"\]/, `selector must be scoped to the theme: ${s}`);
    // Anything below the html element is in main, an ⓘ dialog or tip, or a hero/card piece that lives in main
    const allowed = /(^html\[data-theme="switchboard"\]( body)?$)|main|\.info-dialog|\.tip-bubble|\.hero|\.screw|\.client-head|\.jack|\.role|\.call|\.chaos|\.wait|\.dot|\.ev\b|\.step|\.bar|\.log-title|\.chaos-title|\.meta/;
    assert.match(s, allowed, `unexpected selector: ${s}`);
    assert.doesNotMatch(s, /\.tp-|topology|scenes|\.theme-toggle/, `must not touch the pane: ${s}`);
  }
});

test('the focused layout: every ⓘ is a real button with an aria-label, and each opens a dialog or tip in the page', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/<button[^>]*data-info="([^"]+)"[^>]*>/g)];
  assert.ok(buttons.length >= 1);
  for (const [tag, id] of buttons) {
    assert.match(tag, /aria-label="[^"]+"/, `${id} needs an aria-label`);
    assert.match(html, new RegExp(`<dialog[^>]*id="info-${id}"`), `no dialog for ${id}`);
  }
  // The hover tips are built by tip(): a button with an aria-label that points at its role="tooltip" bubble
  assert.match(html, /const tip = \(id, label, title, text\) => `<span class="tip"><button type="button" class="info" aria-label="\$\{esc\(label\)\}" aria-describedby="\$\{esc\(id\)\}">/);
  assert.match(html, /class="tip-bubble" id="\$\{esc\(id\)\}" role="tooltip"/);
  for (const label of ['About failure injection', 'About the webhooks in the log', 'About the while you wait panel']) assert.ok(html.includes(label), label);
  // The long explanations are gone from the main view: they live in the dialog and the tips only
  assert.doesNotMatch(html, /class="expect/);
  assert.doesNotMatch(html, /<p class="body-m">\s*A voice AI agency/);
});
