// The storyteller's ledger: the agent publishes `story.ledger` on its participant, a JSON object of participant identity to the name
// Hester wrote down. Anything else (missing, broken, not an object) is an empty ledger.
(function (root) {
  function parseLedger(value) {
    if (!value) return {};
    try {
      const raw = JSON.parse(value);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out = {};
      for (const [identity, name] of Object.entries(raw)) if (typeof name === 'string' && name.trim()) out[identity] = name.trim().slice(0, 24);
      return out;
    } catch {
      return {};
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseLedger };
  else root.parseLedger = parseLedger;
})(typeof window !== 'undefined' ? window : globalThis);
