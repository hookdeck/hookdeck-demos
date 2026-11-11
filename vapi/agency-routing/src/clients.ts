/**
 * The two "clients" of the simulated voice AI agency. Each client gets its own
 * Vapi assistant, its own Hookdeck source (the assistant's Server URL) and its
 * own destination (a route in this app). In a real agency, the routes would be
 * the clients' own endpoints.
 */
export interface CrmRecord {
  name: string;
  phone: string;
  summary: string;
}

export interface Client {
  slug: string;
  name: string;
  /** Hookdeck source, connection and destination names */
  source: string;
  destination: string;
  /** Path the Hookdeck CLI forwards to; the client's "endpoint" */
  path: string;
  /** Environment variables written by `npm run setup` */
  env_source_url: string;
  env_assistant_id: string;
  assistant_name: string;
  first_message: string;
  system_prompt: string;
  crm: CrmRecord[];
}

const TOOL_RULES = `When the caller asks about their account, appointment or order, ask for their name, then call lookup_customer.
lookup_customer runs in the background and always answers "Success." straight away; that is NOT the result.
After calling it, tell the caller you are checking and keep chatting briefly. The real result arrives a few seconds later as a system message that starts with "CRM result:". When it arrives, read the key facts out to the caller in one or two sentences.
Never invent account details.`;

export const CLIENTS: Client[] = [
  {
    slug: 'acme',
    name: 'Acme Dental',
    source: 'vapi-acme-dental',
    destination: 'local-acme-dental',
    path: '/clients/acme/webhook',
    env_source_url: 'ACME_SOURCE_URL',
    env_assistant_id: 'ACME_ASSISTANT_ID',
    assistant_name: 'Hookdeck demo - Acme Dental',
    first_message: 'Thanks for calling Acme Dental. How can I help?',
    system_prompt: `You are the phone receptionist for Acme Dental. Keep replies short and spoken-style.\n${TOOL_RULES}`,
    crm: [
      { name: 'Priya Shah', phone: '555-0101', summary: 'Next appointment is a hygiene clean on Thursday at 9:30 am with Dr Lee. No outstanding balance.' },
      { name: 'Tom Becker', phone: '555-0102', summary: 'Crown fitting is booked for Monday at 2 pm. A 40 dollar balance is outstanding.' },
    ],
  },
  {
    slug: 'globex',
    name: 'Globex Plumbing',
    source: 'vapi-globex-plumbing',
    destination: 'local-globex-plumbing',
    path: '/clients/globex/webhook',
    env_source_url: 'GLOBEX_SOURCE_URL',
    env_assistant_id: 'GLOBEX_ASSISTANT_ID',
    assistant_name: 'Hookdeck demo - Globex Plumbing',
    first_message: 'Globex Plumbing, how can I help you today?',
    system_prompt: `You are the phone dispatcher for Globex Plumbing. Keep replies short and spoken-style.\n${TOOL_RULES}`,
    crm: [
      { name: 'Maria Lopez', phone: '555-0201', summary: 'Water heater repair job 4471 is scheduled for tomorrow between 8 and 10 am. Technician is Sam.' },
      { name: 'Ken Ito', phone: '555-0202', summary: 'Quote 3380 for a bathroom re-pipe was sent last week and is awaiting approval.' },
    ],
  },
];

export const clientBySlug = (slug: string): Client | undefined => CLIENTS.find((c) => c.slug === slug);
