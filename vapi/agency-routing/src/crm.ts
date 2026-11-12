import { Client, CrmRecord } from './clients';

/** The simulated CRM: each client has its own small customer list. */
export function findCustomer(client: Client, name: string): CrmRecord | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return client.crm.find((r) => {
    const full = r.name.toLowerCase();
    return full === wanted || full.split(' ').some((part) => part === wanted) || wanted.includes(full);
  });
}
