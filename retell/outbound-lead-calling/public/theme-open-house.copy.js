// Open house wording for the theme hook (_shared/theme/theme.js): keys are the data-copy keys in index.html and the
// HookdeckTheme.copy() calls in app.js. The roles framing (Sam, the lead, the enquiry) is the base wording in every theme;
// this file only has what is particular to Acme Realty.
window.HookdeckThemeCopies = window.HookdeckThemeCopies || {};
window.HookdeckThemeCopies["open-house"] = {
  "eyebrow": "Acme Realty · Hookdeck + Retell",
  "hero_title": "A lead enquires. Retell <em>rings</em>. Hookdeck reports back.",
  "hero_dialog": "Retell's agent, Sam, calls the lead with the lead's details as dynamic variables. In the browser you answer as the lead through your microphone, or optionally take the call on a phone. The call's <code>call_started</code>, <code>call_ended</code> and <code>call_analyzed</code> events come back through Hookdeck, which verifies <code>x-retell-signature</code>, deduplicates and retries, and update the enquiries below. Watch it in the <strong>Data flow</strong> pane.",
  "failure_title": "Office phones down",
  "leads_title": "Enquiries book",
  "badge_new": "Enquiry",
  "badge_calling": "Dialling",
  "badge_in_call": "On the phone",
  "badge_completed": "Call done",
  "badge_analyzed": "Particulars filed",
  "badge_no_answer": "No answer",
  "badge_failed": "Failed",
  "badge_gave_up": "Gave up"
};
