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
  // Open a bubble above its control when there isn't room below it: the fixed Data flow pane covers the bottom of the window
  const place = (event) => {
    const tip = event.target.closest && event.target.closest('.tip');
    const bubble = tip && tip.querySelector(':scope > .tip-bubble');
    if (!bubble) return;
    tip.classList.remove('tip--above');
    const pane = document.querySelector('.tp-root');
    const limit = Math.min(window.innerHeight, pane ? pane.getBoundingClientRect().top : window.innerHeight);
    if (bubble.getBoundingClientRect().bottom > limit) tip.classList.add('tip--above');
  };
  document.addEventListener('pointerover', place);
  document.addEventListener('focusin', place);
})();
