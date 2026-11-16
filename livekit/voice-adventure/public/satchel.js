// The party's satchel: the agent publishes `story.satchel` on its participant, a JSON array of item ids. Unknown ids and broken
// values are dropped. The wording for each item comes from the page's copy table (theme wording in the Story theme).
(function (root) {
  const ITEM_IDS = ['map', 'brass_key', 'lantern', 'flint_and_wick'];
  const PLAIN_LABELS = { map: 'Map', brass_key: 'Brass key', lantern: 'Lantern', flint_and_wick: 'Flint and wick' };
  function parseSatchel(value) {
    if (!value) return [];
    try {
      const raw = JSON.parse(value);
      return Array.isArray(raw) ? raw.filter((id) => ITEM_IDS.includes(id)) : [];
    } catch {
      return [];
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseSatchel, ITEM_IDS, PLAIN_LABELS };
  else { root.parseSatchel = parseSatchel; root.SATCHEL_PLAIN_LABELS = PLAIN_LABELS; }
})(typeof window !== 'undefined' ? window : globalThis);
