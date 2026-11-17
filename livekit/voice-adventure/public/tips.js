// Hover tips: a .tip wraps a control (or an ⓘ button) and a .tip-bubble[role=tooltip]. CSS shows the bubble on hover and on
// keyboard focus; Esc hides it until the pointer or focus leaves (WCAG 1.4.13). Anything a viewer must have to proceed lives
// in the "How it works" dialog or inline, because touch screens have no hover.
(function () {
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
