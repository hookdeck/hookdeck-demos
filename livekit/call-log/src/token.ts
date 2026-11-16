import { AccessToken } from 'livekit-server-sdk';

/** A 10 minute token that can join one room, publish and subscribe. The page never sees the key or the secret. */
export async function mintToken(api_key: string, api_secret: string, room: string, identity: string): Promise<string> {
  const token = new AccessToken(api_key, api_secret, { identity, name: 'You', ttl: '10m' });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return token.toJwt();
}
