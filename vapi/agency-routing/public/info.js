// ⓘ buttons and hover tips for the focused layout: explanation sits behind an ⓘ dialog or a hover tip,
// and the page keeps labels, data, actions and status.
//
// - <button data-info="hero"> opens <dialog id="info-hero">. The dialog closes on Esc, on its Close button and on a click
//   outside it, and focus returns to the button that opened it. The buttons are found by delegation, so ones the page
//   renders later work too.
// - .tip wraps a control and a .tip-bubble[role=tooltip]; CSS shows the bubble on hover and on keyboard focus.
//   Esc hides it until the pointer or focus leaves (WCAG 1.4.13). Anything a viewer must have to proceed is a dialog,
//   because touch screens have no hover.
(function () {
  let opener = null;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-info]');
    if (!button) return;
    const dialog = document.getElementById(`info-${button.dataset.info}`);
    if (!dialog || dialog.open) return;
    opener = button;
    button.setAttribute('aria-expanded', 'true');
    dialog.showModal();
  });

  document.querySelectorAll('dialog.info-dialog').forEach((dialog) => {
    // A click on the backdrop lands on the dialog element itself, outside its padding box content
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) dialog.close();
    });
    dialog.addEventListener('close', () => {
      const id = dialog.id.replace(/^info-/, '');
      // The page can re-render a button, so the opener may have been replaced: find its twin
      const target = opener && opener.isConnected ? opener : document.querySelector(`[data-info="${id}"]`);
      document.querySelectorAll(`[data-info="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (target) target.focus();
      opener = null;
    });
  });

  // Esc hides a hover tip until the pointer or focus leaves it
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.tip:hover, .tip:focus-within').forEach((tip) => tip.classList.add('tip--off'));
  });
  const clear = (event) => {
    const tip = event.target.closest && event.target.closest('.tip');
    if (tip) tip.classList.remove('tip--off');
  };
  document.addEventListener('pointerout', clear);
  document.addEventListener('focusout', clear);
})();
