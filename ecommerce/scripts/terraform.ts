import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

const PROJECT_DIR = join(import.meta.dir, "..");
const TERRAFORM_DIR = join(PROJECT_DIR, "terraform");
const LEGACY_STATE_PATH = join(TERRAFORM_DIR, "terraform.tfstate");
const LEGACY_BACKUP_PATH = join(TERRAFORM_DIR, "terraform.tfstate.backup");

export const apiKeyHash = (apiKey: string) =>
  new Bun.CryptoHasher("sha256").update(apiKey).digest("hex");

export const stateBackendPath = (apiKey: string) =>
  `.state/${apiKeyHash(apiKey)}/terraform.tfstate`;

const absoluteStatePath = (apiKey: string) =>
  join(TERRAFORM_DIR, stateBackendPath(apiKey));

const getApiKey = () => {
  const apiKey =
    Bun.env.TF_VAR_hookdeck_api_key ?? Bun.env.HOOKDECK_API_KEY;

  if (!apiKey) {
    throw new Error(
      "TF_VAR_hookdeck_api_key or HOOKDECK_API_KEY must be set before running Terraform.",
    );
  }

  return apiKey;
};

const getApiUrl = () => {
  const apiUrl = Bun.env.TF_VAR_hookdeck_api_url ?? Bun.env.HOOKDECK_API_URL;

  if (!apiUrl) {
    throw new Error(
      "TF_VAR_hookdeck_api_url or HOOKDECK_API_URL must be set before running Terraform.",
    );
  }

  return apiUrl;
};

const migrateLegacyState = (apiKey: string) => {
  const scopedStatePath = absoluteStatePath(apiKey);
  const scopedBackupPath = `${scopedStatePath}.backup`;
  const hasLegacyState = existsSync(LEGACY_STATE_PATH);
  const hasLegacyBackup = existsSync(LEGACY_BACKUP_PATH);

  if (!hasLegacyState && !hasLegacyBackup) {
    console.log("No legacy Terraform state remains to migrate.");
    return;
  }

  if (
    (hasLegacyState && existsSync(scopedStatePath)) ||
    (hasLegacyBackup && existsSync(scopedBackupPath))
  ) {
    throw new Error(
      "The API-key-scoped state already exists; refusing to overwrite it with legacy state.",
    );
  }

  mkdirSync(dirname(scopedStatePath), { recursive: true });

  if (hasLegacyState) {
    renameSync(LEGACY_STATE_PATH, scopedStatePath);
  }

  if (hasLegacyBackup) {
    renameSync(LEGACY_BACKUP_PATH, scopedBackupPath);
  }

  console.log("Migrated legacy Terraform state into API-key-scoped storage.");
};

const assertLegacyStateMigrated = () => {
  if (existsSync(LEGACY_STATE_PATH) || existsSync(LEGACY_BACKUP_PATH)) {
    throw new Error(
      "Legacy Terraform state exists. Run `bun run tf:state:migrate` with the API key for that project before continuing.",
    );
  }
};

const runTerraform = async (
  args: string[],
  environment: Record<string, string | undefined>,
) => {
  const process = Bun.spawn(["terraform", ...args], {
    cwd: TERRAFORM_DIR,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return process.exited;
};

const main = async () => {
  const apiKey = getApiKey();
  const providedArgs = Bun.argv.slice(2);
  const commandArgs = providedArgs.length > 0 ? providedArgs : ["plan"];
  const command = commandArgs[0];

  if (command === "migrate") {
    migrateLegacyState(apiKey);
    return;
  }

  assertLegacyStateMigrated();

  const apiUrl = getApiUrl();
  const backendPath = stateBackendPath(apiKey);
  mkdirSync(dirname(absoluteStatePath(apiKey)), { recursive: true });

  const environment = {
    ...Bun.env,
    TF_VAR_hookdeck_api_key: apiKey,
    TF_VAR_hookdeck_api_url: apiUrl,
  };
  const initArgs = [
    "init",
    "-reconfigure",
    `-backend-config=path=${backendPath}`,
  ];

  console.log("Using API-key-scoped Terraform state.");

  if (command === "init") {
    process.exitCode = await runTerraform(
      [...initArgs, ...commandArgs.slice(1)],
      environment,
    );
    return;
  }

  const initExitCode = await runTerraform(initArgs, environment);
  if (initExitCode !== 0) {
    process.exitCode = initExitCode;
    return;
  }

  process.exitCode = await runTerraform(commandArgs, environment);
};

if (import.meta.main) {
  await main();
}
