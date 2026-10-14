/** Loads `.env` from the working directory if there is one; real environment variables win. */
export function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file; rely on the environment
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

export function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}
