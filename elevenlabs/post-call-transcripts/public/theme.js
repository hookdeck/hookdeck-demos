// Light/dark mode for the Hookdeck design system, whose dark mode is a class
// on <html>. Adds a System / Light / Dark switch to the page; System follows
// the OS setting. Load it in <head>, without defer, so the theme is set before
// the page paints.
(function () {
  const KEY = 'hookdeck-demo-theme';
  const OPTIONS = ['system', 'light', 'dark'];
  const media = matchMedia('(prefers-color-scheme: dark)');

  // Storage can be unavailable (private windows, blocked site data)
  const read = () => {
    try {
      const value = localStorage.getItem(KEY);
      return OPTIONS.includes(value) ? value : 'system';
    } catch {
      return 'system';
    }
  };
  const write = (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {}
  };

  function apply() {
    const mode = read();
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
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

    const toggle = document.createElement('div');
    toggle.className = 'theme-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Colour theme');
    toggle.innerHTML = OPTIONS.map(
      (option) => `<button type="button" class="button button--minimal" data-theme-option="${option}">${option[0].toUpperCase()}${option.slice(1)}</button>`,
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
