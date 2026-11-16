import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Runs the shared theme hook against a tiny fake DOM and checks the copy swap: on, off, aria, placeholder, runtime lookup.
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
  const button = make({ 'data-copy': 'join' }, 'Join a call');
  const aria = make({ 'data-copy-aria': 'leave_label', 'aria-label': 'Leave the call' });
  const input = make({ 'data-copy-placeholder': 'name_hint', placeholder: 'optional, Hester will ask' });
  const root = make({ 'data-demo-theme': 'tale' });
  const document: any = {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll: (s: string) => (s === '[data-copy]' ? [button] : s === '[data-copy-aria]' ? [aria] : s === '[data-copy-placeholder]' ? [input] : []),
    addEventListener() {},
    dispatchEvent() { return true; },
  };
  const window: any = { HookdeckThemeCopies: { tale: { join: 'Enter the inn', leave_label: 'Leave the table', name_hint: 'Hester will ask at the door' } } };
  const context = vm.createContext({ window, document, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, CustomEvent: class {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/theme.js'), 'utf8'), context);
  return { window, store, button, aria, input };
}

test('theme on: elements take the theme wording; runtime lookup follows', () => {
  const { window, button, aria, input } = setup('tale');
  assert.equal(button.html, 'Enter the inn');
  assert.equal(aria.attrs['aria-label'], 'Leave the table');
  assert.equal(input.attrs.placeholder, 'Hester will ask at the door');
  assert.equal(window.HookdeckTheme.copy('join', 'x'), 'Enter the inn');
  assert.equal(window.HookdeckTheme.copy('missing', 'fallback'), 'fallback');
});

test('theme off: the plain wording is restored and runtime lookup returns the fallback', () => {
  const { window, store, button, aria, input } = setup('tale');
  store['hookdeck-demo-theme'] = 'light';
  window.HookdeckTheme.apply();
  assert.equal(button.html, 'Join a call');
  assert.equal(aria.attrs['aria-label'], 'Leave the call');
  assert.equal(input.attrs.placeholder, 'optional, Hester will ask');
  assert.equal(window.HookdeckTheme.copy('join', 'Join a call'), 'Join a call');
  store['hookdeck-demo-theme'] = 'tale';
  window.HookdeckTheme.apply();
  assert.equal(button.html, 'Enter the inn');
});

test('the shared hook names no specific theme', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../../../_shared/theme/theme.js'), 'utf8');
  assert.doesNotMatch(shared.replace(/\/\/.*$/gm, ''), /story|tale|drowned/i);
});
