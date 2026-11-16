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

  function apply() {
    const mode = read();
    const is_demo = demo_id !== '' && mode === demo_id;
    const dark = !is_demo && (mode === 'dark' || (mode === 'system' && media.matches));
    if (is_demo) root.dataset.theme = demo_id;
    else delete root.dataset.theme;
    root.classList.toggle('dark', dark);
    document.querySelectorAll('[data-theme-option]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === mode));
    });
  }

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
