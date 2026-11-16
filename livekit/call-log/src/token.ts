import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';

/** The agent that runs the story. `npm run agent` registers a worker under this name. */
export const AGENT_NAME = 'story-gm';

/**
 * A 10 minute token that can join one room, publish and subscribe. The page never sees the key or
 * the secret. The token also carries a room configuration that dispatches the agent by name when the
 * room is created, so only rooms joined from this page get the story agent.
 */
export async function mintToken(api_key: string, api_secret: string, room: string, identity: string, name = 'Player'): Promise<string> {
  const token = new AccessToken(api_key, api_secret, { identity, name, ttl: '10m' });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  token.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })] });
  return token.toJwt();
}
