// Light/dark mode for the Hookdeck design system, whose dark mode is a class on <html>. Adds a
// System / Light / Dark switch to the page; System follows the OS setting. Load it in <head>, without
// defer, so the theme is set before the page paints.
//
// A demo can add one theme of its own. Declare it on <html>:
//
//   <html data-demo-theme="story" data-demo-theme-label="Story" data-demo-theme-default="true">
//
// The switch then has a fourth option. Choosing it sets data-theme="<id>" on <html> and removes the
// `dark` class: a demo theme is its own single palette, and its stylesheet decides what it overrides
// (for example the design-system tokens under `html[data-theme="story"] main`). With
// data-demo-theme-default="true" and no saved choice, the demo theme is the default; the switch
// goes back to System, Light or Dark and remembers the choice.
//
// Wording can change with the theme too. A theme ships a copy file (for example theme-<id>.copy.js) that sets
// `window.HookdeckThemeCopies["<id>"] = { key: "wording", ... }`. Elements carry data-copy="<key>" (their
// content), data-copy-aria="<key>" (their aria-label) or data-copy-placeholder="<key>" (their placeholder),
// with the default wording written in the HTML. The theme being on swaps the wording in; off restores it.
// Text built at runtime asks for it: `HookdeckTheme.copy(key, fallback)` returns the theme's wording while the
// theme is on and `fallback` otherwise. Values are inserted as HTML: escape anything that is not your own text.
// The page can listen for the `hookdeck-theme` event on `document` to re-render runtime text.
(function () {
  const KEY = 'hookdeck-demo-theme';
  const root = document.documentElement;
  const demo_id = root.dataset.demoTheme || '';
  const demo_label = root.dataset.demoThemeLabel || (demo_id ? demo_id[0].toUpperCase() + demo_id.slice(1) : '');
  const OPTIONS = ['system', 'light', 'dark', ...(demo_id ? [demo_id] : [])];
  const media = matchMedia('(prefers-color-scheme: dark)');

  // Storage can be unavailable (private windows, blocked site data)
  const read = () => {
    try {
      const value = localStorage.getItem(KEY);
      if (OPTIONS.includes(value)) return value;
    } catch {}
    return demo_id && root.dataset.demoThemeDefault === 'true' ? demo_id : 'system';
  };
  const write = (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {}
  };

  let theme_on = false;
  const copies = () => (window.HookdeckThemeCopies && window.HookdeckThemeCopies[demo_id]) || {};
  /** The theme's wording for a key while the theme is on, otherwise the fallback. */
  function copy(key, fallback) {
    const table = copies();
    return theme_on && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
  }
  function swap_copy() {
    const each = (selector, attr, get, set) => {
      document.querySelectorAll(selector).forEach((el) => {
        const key = el.dataset[attr];
        if (!('plain_' + attr in el.dataset)) el.dataset['plain_' + attr] = get(el);
        set(el, copy(key, el.dataset['plain_' + attr]));
      });
    };
    each('[data-copy]', 'copy', (el) => el.innerHTML, (el, v) => { el.innerHTML = v; });
    each('[data-copy-aria]', 'copyAria', (el) => el.getAttribute('aria-label') || '', (el, v) => el.setAttribute('aria-label', v));
    each('[data-copy-placeholder]', 'copyPlaceholder', (el) => el.getAttribute('placeholder') || '', (el, v) => el.setAttribute('placeholder', v));
  }

  function apply() {
    const mode = read();
    const is_demo = demo_id !== '' && mode === demo_id;
    const changed = is_demo !== theme_on;
    theme_on = is_demo;
    const dark = !is_demo && (mode === 'dark' || (mode === 'system' && media.matches));
    if (is_demo) root.dataset.theme = demo_id;
    else delete root.dataset.theme;
    root.classList.toggle('dark', dark);
    document.querySelectorAll('[data-theme-option]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === mode));
    });
    swap_copy();
    if ((changed || document.readyState !== 'loading') && typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('hookdeck-theme', { detail: { on: theme_on } }));
  }

  window.HookdeckTheme = { copy, apply, get on() { return theme_on; } };

  apply();
  media.addEventListener('change', apply);

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      .theme-toggle {
        position: fixed; top: var(--s4); right: var(--s4); z-index: 10; display: flex; gap: 2px; padding: 2px;
        border-radius: var(--radius); background: var(--bg-0); box-shadow: var(--elevation-small);
      }
      .theme-toggle .button { padding: 2px var(--s2); font-size: 12px; line-height: 20px; }
      .theme-toggle .button[aria-pressed="true"] { background-color: var(--bg-3); }
    `;
    document.head.appendChild(style);

    const label = (option) => (option === demo_id ? demo_label : option[0].toUpperCase() + option.slice(1));
    const toggle = document.createElement('div');
    toggle.className = 'theme-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Colour theme');
    toggle.innerHTML = OPTIONS.map(
      (option) => `<button type="button" class="button button--minimal" data-theme-option="${option}">${label(option)}</button>`,
    ).join('');
    toggle.addEventListener('click', (event) => {
      const button = event.target.closest('[data-theme-option]');
      if (!button) return;
      write(button.dataset.themeOption);
      apply();
    });
    document.body.appendChild(toggle);
    apply();
  });
})();
