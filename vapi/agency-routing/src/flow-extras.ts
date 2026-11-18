/**
 * Two things the topology view needs that the shared flow state does not carry: how many requests
 * Event Gateway ignored as duplicates (`ignored_count` on the request), and each request's size.
 * Read with the project API key, here on the server, and merged into /api/flow's messages. Also the
 * project's team id, which the detail strip uses to link to the Hookdeck dashboard.
 */
const API_BASE = 'https://api.hookdeck.com/2025-07-01';

export function createFlowExtras(api_key: string, source_names: string[]) {
  const source_ids = new Map<string, string>();
  let team_id: string | undefined;
  let cached: { at: number; value: Promise<Map<string, number>> } | undefined;

  async function api<T = any>(route: string): Promise<T> {
    const response = await fetch(`${API_BASE}${route}`, {
      headers: { authorization: `Bearer ${api_key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Hookdeck API ${route.split('?')[0]} -> ${response.status}`);
    return response.json() as Promise<T>;
  }

  async function load(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const name of source_names) {
      if (!source_ids.has(name)) {
        const found = await api<{ models: Array<{ id: string; name: string }> }>(`/sources?name=${encodeURIComponent(name)}`);
        const id = found.models.find((s) => s.name === name)?.id;
        if (id) source_ids.set(name, id);
      }
      const source_id = source_ids.get(name);
      if (!source_id) continue;
      const requests = await api<{ models: Array<{ id: string; team_id?: string; ignored_count?: number }> }>(`/requests?source_id=${source_id}&limit=30`);
      team_id = requests.models.find((r) => r.team_id)?.team_id ?? team_id;
      for (const r of requests.models) counts.set(r.id, r.ignored_count ?? 0);
    }
    return counts;
  }

  /** Ignored-duplicate count per request id. Shared by quick polls; an API error gives an empty map. */
  function ignoredCounts(): Promise<Map<string, number>> {
    if (!cached || Date.now() - cached.at > 700) cached = { at: Date.now(), value: load().catch(() => new Map()) };
    return cached.value;
  }

  /** The Hookdeck project (team) id, known after the first request is listed. Used for dashboard links. */
  const teamId = () => team_id;

  return { ignoredCounts, teamId };
}
