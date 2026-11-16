import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';

/** The agent that runs the story. `npm run agent` registers a worker under this name. */
export const AGENT_NAME = 'story-gm';

/**
 * A 10 minute token that can join one room, publish and subscribe. The page never sees the key or
 * the secret. The token also carries a room configuration that dispatches the agent by name when the
 * room is created, so only rooms joined from this page get the story agent.
 */
export async function mintToken(api_key: string, api_secret: string, room: string, identity: string, name?: string, options: { dispatch?: boolean } = {}): Promise<string> {
  // With no name the participant has none, and the innkeeper asks for one; with a name she greets the player by it
  const token = new AccessToken(api_key, api_secret, { identity, ...(name ? { name } : {}), ttl: '10m' });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  // Only a player who opens the room asks for the agent. Pixel joins a room that already has one, so its token carries no dispatch.
  if (options.dispatch !== false) token.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })] });
  return token.toJwt();
}
