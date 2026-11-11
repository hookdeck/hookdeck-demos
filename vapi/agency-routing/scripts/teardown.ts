/** Deletes the Vapi assistants, tool and credential this demo created. Hookdeck connections are left in place. */
import 'dotenv/config';
import { CLIENTS } from '../src/clients';
import { vapi } from './vapi-api';

async function main() {
  for (const client of CLIENTS) {
    const id = process.env[client.env_assistant_id];
    if (id) await vapi('DELETE', `/assistant/${id}`).then(() => console.log(`Deleted assistant ${client.assistant_name}`), (e) => console.warn(e.message));
  }
  if (process.env.VAPI_TOOL_ID) await vapi('DELETE', `/tool/${process.env.VAPI_TOOL_ID}`).then(() => console.log('Deleted tool'), (e) => console.warn(e.message));
  if (process.env.VAPI_HMAC_CREDENTIAL_ID) await vapi('DELETE', `/credential/${process.env.VAPI_HMAC_CREDENTIAL_ID}`).then(() => console.log('Deleted credential'), (e) => console.warn(e.message));
}
main();
