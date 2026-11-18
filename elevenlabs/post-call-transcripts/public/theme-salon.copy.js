// Salon wording for the theme hook (_shared/theme/theme.js): keys are the data-copy keys in index.html and the
// HookdeckTheme.copy() calls in app.js and call.js. The roles framing (the customer, the booking assistant, the call button
// that rings Hookdeck Hair) is the base wording in every theme; this file only has what is particular to the salon's own voice.
// Everything technical (header names, webhook types, ids, sizes) keeps its default wording.
window.HookdeckThemeCopies = window.HookdeckThemeCopies || {};
window.HookdeckThemeCopies["salon"] = {
  "eyebrow": "{ Hookdeck + ElevenLabs } · Hookdeck Hair booking line",
  "hero_title": "Hookdeck Hair booking line",
  "hero_line": "Book a haircut by phone. The diary fills in after the call.",
  "talk_title": "Ring the booking line",
  "call_btn": "Call the salon",
  "end_btn": "Hang up",
  "call_connecting": "Ringing the salon...",
  "call_in": "Through to the salon ({0}). Speak now.",
  "call_ended": "Hung up. The write-up arrives in a few seconds.",
  "retry_title": "Bad line",
  "conversations_title": "Appointment book",
  "empty": "The appointment book is empty. Call the salon above."
};
