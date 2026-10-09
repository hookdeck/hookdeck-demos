/**
 * A minimal client for the Event Gateway REST API: just the calls the agent
 * needs to manage its forward proxy endpoints. The API is used instead of the
 * Hookdeck CLI because each source carries a per-subscription secret, which
 * shouldn't appear on a command line, and the deployed agent has no CLI.
 */

export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string | null;
}

export interface Connection {
  id: string;
  name: string;
  source: Source;
  destination: { id: string; name: string; type: string };
}

export class HookdeckApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class HookdeckApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.hookdeck.com/2026-09-01',
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new HookdeckApiError(`${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`, response.status);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** An MCP Events source verifies Standard Webhooks signatures and answers the verification challenge. */
  createMcpEventsSource(name: string, secret: string, description: string): Promise<Source> {
    return this.request('POST', '/sources', {
      name,
      type: 'MCP_EVENTS',
      description,
      config: { auth: { webhook_secret_key: secret } },
    });
  }

  createConnection(input: { name: string; sourceId: string; destination: Record<string, unknown>; rules: unknown[] }): Promise<Connection> {
    return this.request('POST', '/connections', {
      name: input.name,
      source_id: input.sourceId,
      destination: input.destination,
      rules: input.rules,
    });
  }

  /** The secret an `MCP Events` source verifies with. Only returned when asked for with `include=config.auth`. */
  async getSourceSecret(sourceId: string): Promise<string | undefined> {
    const source = await this.request<{ config?: { auth?: { webhook_secret_key?: string } } }>('GET', `/sources/${sourceId}?include=config.auth`);
    return source.config?.auth?.webhook_secret_key;
  }

  async listConnections(matches: (name: string) => boolean): Promise<Connection[]> {
    const page = await this.request<{ models: Connection[] }>('GET', `/connections?limit=250`);
    return page.models.filter((connection) => matches(connection.name));
  }

  /** Deletes a resource; one that's already gone counts as deleted. */
  async delete(kind: 'connections' | 'destinations' | 'sources', id: string): Promise<void> {
    try {
      await this.request('DELETE', `/${kind}/${id}`);
    } catch (error) {
      if (!(error instanceof HookdeckApiError && error.status === 404)) throw error;
    }
  }
}
