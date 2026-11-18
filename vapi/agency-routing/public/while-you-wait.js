// The "While you wait" panel's logic: from a client's log entries (newest first, as /api/state returns them) work out
// where the async lookup_customer tool is. The app already logs each step: a `tool-calls` entry when the tool request
// arrives, then a `live-call-control` entry when the result has been posted to the call's controlUrl (or a
// `lookup-error` entry if that failed). Nothing here needs the server to report anything else.
//
// The countdown is an estimate: the app waits LOOKUP_DELAY_MS (6 s) after it logs the tool request, and the page
// counts down from that entry's time.
(function (root) {
  const SHOW_FOR_MS = 60000; // how long a finished lookup stays on screen
  const LOOKUP = /^lookup_customer\((.*)\) controlUrl:/;

  /**
   * @param events  one client's log entries, newest first: { at, type, call_id, detail }
   * @param now     ms since epoch
   * @param delay_ms  the app's CRM delay
   * @returns null when there is nothing to show, otherwise { customer, started_at, state, elapsed_ms, remaining_ms,
   *   progress, mode, result_at, error, call_id } where state is 'lookup' | 'sending' | 'done' | 'failed'
   */
  function derive(events, now, delay_ms) {
    const ordered = [...events].reverse(); // oldest first
    const lookups = [];
    for (const e of ordered) {
      const t = Date.parse(e.at);
      if (e.type === 'tool-calls') {
        const m = LOOKUP.exec(e.detail || '');
        if (!m) continue;
        // Hookdeck may redeliver a tool call: the same call's request while its lookup is still open is the same lookup
        if (lookups.some((l) => l.call_id === e.call_id && !l.closed)) continue;
        let customer = '';
        try { customer = String(JSON.parse(m[1]).customer_name || ''); } catch {}
        lookups.push({ call_id: e.call_id, started_at: t, customer, closed: false });
      } else if (e.type === 'live-call-control' || e.type === 'lookup-error') {
        const open = lookups.find((l) => l.call_id === e.call_id && !l.closed);
        if (!open) continue;
        open.closed = true;
        open.result_at = t;
        open.failed = e.type === 'lookup-error';
        open.mode = e.type === 'live-call-control' ? (/^(\S+) sent/.exec(e.detail || '') || [])[1] : undefined;
        open.error = open.failed ? e.detail : undefined;
      }
    }
    const last = lookups[lookups.length - 1];
    if (!last) return null;
    const elapsed_ms = Math.max(0, now - last.started_at);
    if (last.closed && now - last.result_at > SHOW_FOR_MS) return null;
    if (!last.closed && elapsed_ms > SHOW_FOR_MS + delay_ms) return null; // an old request that never finished
    const remaining_ms = Math.max(0, delay_ms - elapsed_ms);
    return {
      call_id: last.call_id,
      customer: last.customer,
      started_at: last.started_at,
      state: last.closed ? (last.failed ? 'failed' : 'done') : remaining_ms > 0 ? 'lookup' : 'sending',
      elapsed_ms,
      remaining_ms,
      progress: last.closed ? 1 : Math.min(1, elapsed_ms / delay_ms),
      mode: last.mode,
      result_at: last.result_at,
      error: last.error,
    };
  }

  const api = { derive, SHOW_FOR_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WhileYouWait = api;
})(typeof window !== 'undefined' ? window : globalThis);
