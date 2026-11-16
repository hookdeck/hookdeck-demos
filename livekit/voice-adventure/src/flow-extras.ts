/**
 * Two things the topology view needs that the shared flow state does not carry: how many requests
 * Event Gateway ignored as duplicates (`ignored_count` on the request), and each request's size.
 * Read with the project API key, here on the server, and merged into /api/flow's messages. Also the
 * project's team id, which the detail strip uses to link to the Hookdeck dashboard.
 */
const API_BASE = 'https://api.hookdeck.com/2025-07-01';

export function createFlowExtras(api_key: string, source_name: string) {
  let source_id: string | undefined;
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
    if (!source_id) {
      const found = await api<{ models: Array<{ id: string; name: string }> }>(`/sources?name=${encodeURIComponent(source_name)}`);
      source_id = found.models.find((s) => s.name === source_name)?.id;
    }
    if (!source_id) return new Map();
    const requests = await api<{ models: Array<{ id: string; team_id?: string; ignored_count?: number }> }>(`/requests?source_id=${source_id}&limit=30`);
    team_id = requests.models.find((r) => r.team_id)?.team_id ?? team_id;
    return new Map(requests.models.map((r) => [r.id, r.ignored_count ?? 0]));
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
