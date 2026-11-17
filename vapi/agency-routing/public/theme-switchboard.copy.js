// Switchboard wording for the theme hook (_shared/theme/theme.js): keys are the data-copy keys in index.html and the
// HookdeckTheme.copy() calls in its script. The roles (the agent, the caller) are the base wording in every theme;
// this file only has the telephone-exchange vocabulary: lines, plugs and a line log.
window.HookdeckThemeCopies = window.HookdeckThemeCopies || {};
window.HookdeckThemeCopies["switchboard"] = {
  "hero_title": "The agency <em>switchboard</em>",
  "hero_line": "One Vapi assistant and one endpoint per client line.",
  "hero_dialog_1": "An agency answers the phones for several clients. Each client has its own line on the board: its own Vapi assistant, its own Event Gateway source, its own endpoint in this app. You are the caller: plug into a line and talk to that client's assistant.",
  "hero_dialog_2": "The line log then lists every webhook that line's endpoint received during the call. The <strong>Data flow</strong> pane at the bottom shows each webhook travelling from Vapi through Event Gateway to the endpoint, and the lookup result going back into the call.",
  "line_acme": "Line 1 &middot; ",
  "line_globex": "Line 2 &middot; ",
  "call_start": "Plug in and call",
  "call_end": "Pull the plug",
  "status_idle": "On hook",
  "status_in_call": "Line open",
  "chaos_title": "Line fault",
  "log_title": "Line log",
  "log_empty": "Nothing on this line yet."
};
