import * as dotenv from "dotenv";
import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import * as TOML from "@iarna/toml";

// Load environment variables from .env file in project root
dotenv.config({ path: resolve(process.cwd(), ".env") });

// Configuration constants
const PROD_CONNECTION_NAME = "shopify-orders-prod-conn";
const DEV_CONNECTION_NAME = "shopify-orders-dev-conn";
const SOURCE_NAME = "shopify-orders";
const PROD_DESTINATION_NAME = "shopify-orders-prod";
const DEV_DESTINATION_NAME = "shopify-orders-dev";

// Validate required environment variables
if (!process.env.HOOKDECK_API_KEY) {
  console.error("Error: HOOKDECK_API_KEY environment variable is not set");
  console.error(
    "Please set it in your .env file or as an environment variable"
  );
  process.exit(1);
}

if (!process.env.DESTINATION_URL) {
  console.error("Error: DESTINATION_URL environment variable is not set");
  console.error(
    "Please set it in your .env file or as an environment variable"
  );
  console.error("Example: DESTINATION_URL=https://your-url.com/webhook");
  process.exit(1);
}

// Validate that shopify.app.toml exists
const shopifyTomlPath = resolve(process.cwd(), "shopify", "shopify.app.toml");
if (!existsSync(shopifyTomlPath)) {
  console.error("Error: shopify/shopify.app.toml not found");
  console.error(
    "Please run 'shopify app dev' first to create the app and configuration file"
  );
  process.exit(1);
}

// Get Shopify API secret from shopify app env show
let shopifyApiSecret: string;
const shopifyDir = resolve(process.cwd(), "shopify");

// Verify shopify directory exists
if (!existsSync(shopifyDir)) {
  console.error(`Error: shopify directory not found: ${shopifyDir}`);
  console.error("Please make sure you're running this from the project root");
  process.exit(1);
}

try {
  // Run the command using --path flag to specify the app directory
  const envOutput = execSync(`shopify app env show --path "${shopifyDir}"`, {
    encoding: "utf-8",
  });

  // Parse: SHOPIFY_API_SECRET=value
  const apiSecretMatch = envOutput.match(/SHOPIFY_API_SECRET=([^\s]+)/);
  if (!apiSecretMatch || !apiSecretMatch[1]) {
    throw new Error(
      "Could not extract SHOPIFY_API_SECRET from shopify app env show"
    );
  }
  shopifyApiSecret = apiSecretMatch[1];
} catch (error) {
  console.error("Error: Failed to run 'shopify app env show'");
  console.error(`Running from directory: ${shopifyDir}`);
  console.error(
    "Make sure you have run 'shopify app dev' in the shopify directory and are authenticated with Shopify CLI"
  );
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

/**
 * Update or add an environment variable in the .env file
 */
function updateEnvFile(envPath: string, key: string, value: string): void {
  let envContent = "";
  let keyExists = false;
  const lines: string[] = [];

  // Read existing .env file if it exists
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, "utf-8");
    const envLines = envContent.split("\n");

    // Process each line
    for (const line of envLines) {
      const trimmed = line.trim();

      // Check if this line contains the key we're updating
      if (trimmed.startsWith(`${key}=`)) {
        // Update the existing line
        lines.push(`${key}=${value}`);
        keyExists = true;
      } else if (trimmed.match(/^#\s*.*HOOKDECK_SOURCE_URL/i) && !keyExists) {
        // If there's a comment about HOOKDECK_SOURCE_URL, add the key after it
        lines.push(line);
        lines.push(`${key}=${value}`);
        keyExists = true;
      } else {
        // Keep the line as-is
        lines.push(line);
      }
    }
  }

  // If key doesn't exist, add it at the end
  if (!keyExists) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push(""); // Add blank line before new entry
    }
    lines.push(`${key}=${value}`);
  }

  // Write back to file
  try {
    writeFileSync(envPath, lines.join("\n"), "utf-8");
    console.log(`Updated .env file: ${key}=${value}`);
    console.log("");
  } catch (error) {
    console.warn(`Warning: Failed to update .env file: ${error}`);
    console.warn(`Please manually add ${key}=${value} to your .env file`);
    console.log("");
  }
}

// Types for API responses
interface HookdeckSource {
  id: string;
  url: string;
  name: string;
  type: string;
}

interface HookdeckDestination {
  id: string;
  name: string;
  type: string;
}

interface HookdeckConnection {
  id: string;
  name: string;
  source: HookdeckSource;
  destination: HookdeckDestination;
}

// Prompt for confirmation
function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// API client function
async function upsertConnection(payload: any): Promise<HookdeckConnection> {
  const response = await fetch(
    "https://api.hookdeck.com/2025-07-01/connections",
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.HOOKDECK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API request failed with status ${response.status}: ${errorBody}`
    );
  }

  return await response.json();
}

// Main function
async function main() {
  console.log("Creating/updating Hookdeck connections...");
  console.log(`Production connection: ${PROD_CONNECTION_NAME}`);
  console.log(`Development connection: ${DEV_CONNECTION_NAME}`);
  console.log(`Destination URL: ${process.env.DESTINATION_URL}`);
  console.log("");

  // Build rules array for filtering and deduplication
  // Filter: All events where x-shopify-topic starts with "orders/"
  // Deduplicate: Based on x-shopify-event-ed header with 60 second window
  // Note: headers are case-sensitive!
  const rules = [
    {
      type: "filter",
      headers: {
        "x-shopify-topic": {
          $startsWith: "orders/",
        },
      },
    },
    {
      type: "deduplicate",
      include_fields: ["headers.x-shopify-event-id"],
      window: 60000, // 60 seconds in milliseconds
    },
  ];

  // Step 1: Create/update production connection (HTTP destination)
  console.log(
    `Creating/updating production connection: ${PROD_CONNECTION_NAME}`
  );

  const prodConnectionPayload = {
    name: PROD_CONNECTION_NAME,
    source: {
      name: SOURCE_NAME,
      type: "SHOPIFY",
      config: {
        auth: {
          webhook_secret_key: shopifyApiSecret,
        },
      },
    },
    destination: {
      name: PROD_DESTINATION_NAME,
      type: "HTTP",
      config: {
        url: process.env.DESTINATION_URL,
        rate_limit: 1,
        rate_limit_period: "minute",
      },
    },
    rules: rules,
  };

  let prodConnection: HookdeckConnection;
  try {
    prodConnection = await upsertConnection(prodConnectionPayload);
    console.log("Production connection upserted successfully.");
    console.log("");
  } catch (error: any) {
    console.error(
      "Error: hookdeck connection upsert failed for production connection"
    );
    console.error(error.message);
    process.exit(1);
  }

  // Extract source URL and ID from production connection
  const sourceUrl = prodConnection.source.url;
  const sourceId = prodConnection.source.id;

  if (!sourceUrl || !sourceId) {
    console.error(
      "Error: Could not extract source URL or ID from API response"
    );
    console.error(
      "Response structure:",
      JSON.stringify(prodConnection, null, 2)
    );
    process.exit(1);
  }

  console.log("==========================================");
  console.log("Hookdeck Source URL:");
  console.log(sourceUrl);
  console.log(`Source ID: ${sourceId}`);
  console.log("==========================================");
  console.log("");

  // Update .env file with HOOKDECK_SOURCE_URL and SHOPIFY_CLIENT_SECRET
  const envPath = resolve(process.cwd(), ".env");
  updateEnvFile(envPath, "HOOKDECK_SOURCE_URL", sourceUrl);
  updateEnvFile(envPath, "SHOPIFY_CLIENT_SECRET", shopifyApiSecret);

  // Step 2: Create/update development connection (CLI destination) reusing the same source
  console.log(
    `Creating/updating development connection: ${DEV_CONNECTION_NAME}`
  );
  console.log(`Reusing source: ${sourceId}`);
  console.log("");

  const devConnectionPayload = {
    name: DEV_CONNECTION_NAME,
    source_id: sourceId, // Reuse the source from production connection
    destination: {
      name: DEV_DESTINATION_NAME,
      type: "CLI",
      config: {
        path: "/",
      },
    },
    rules: rules, // Same rules as production
  };

  let devConnection: HookdeckConnection;
  try {
    devConnection = await upsertConnection(devConnectionPayload);
    console.log("Development connection upserted successfully.");
    console.log("");
  } catch (error: any) {
    console.error(
      "Error: hookdeck connection upsert failed for development connection"
    );
    console.error(error.message);
    process.exit(1);
  }

  console.log("==========================================");
  console.log("Both connections created successfully!");
  console.log("==========================================");
  console.log(`Production: ${PROD_CONNECTION_NAME} (HTTP destination)`);
  console.log(`Development: ${DEV_CONNECTION_NAME} (CLI destination)`);
  console.log("");
  console.log("To use the CLI connection for local debugging, run:");
  console.log(`  hookdeck listen 4000 ${SOURCE_NAME}`);
  console.log("==========================================");
  console.log("");

  // Step 3: Update shopify.app.toml with webhook subscription
  console.log(`Preparing to update ${shopifyTomlPath}...`);
  console.log("");

  // Read and parse the TOML file
  const fileContent = readFileSync(shopifyTomlPath, "utf-8");
  const config = TOML.parse(fileContent) as any;

  // Ensure webhooks section exists
  if (!config.webhooks) {
    config.webhooks = { api_version: "2026-04", subscriptions: [] };
  }
  if (!config.webhooks.subscriptions) {
    config.webhooks.subscriptions = [];
  }

  // Check for existing order webhook subscriptions
  const webhookSubs = config.webhooks.subscriptions;
  const existingOrderSubs = webhookSubs.filter((sub: any) =>
    sub.topics?.some((topic: string) => topic.startsWith("orders/"))
  );

  // If exists, prompt for confirmation
  if (existingOrderSubs.length > 0) {
    console.log("Found existing order webhook subscriptions:");
    existingOrderSubs.forEach((sub: any) => {
      console.log(`  - Topics: ${sub.topics?.join(", ")}`);
      console.log(`    URI: ${sub.uri}`);
    });
    console.log("");

    const confirmed = await confirm(
      "Do you want to replace these with the Hookdeck source URL? (y/N): "
    );
    if (!confirmed) {
      console.log("Update cancelled. Exiting.");
      process.exit(0);
    }

    // Remove existing order subscriptions
    config.webhooks.subscriptions = webhookSubs.filter(
      (sub: any) =>
        !sub.topics?.some((topic: string) => topic.startsWith("orders/"))
    );
  }

  // Add new order webhook subscription
  // Append the webhook path to the Hookdeck source URL
  const webhookPath = "/webhooks/shopify/orders";
  const orderWebhookSub = {
    topics: [
      "orders/cancelled",
      "orders/create",
      "orders/delete",
      "orders/edited",
      "orders/fulfilled",
      "orders/paid",
      "orders/partially_fulfilled",
      "orders/updated",
    ],
    uri: `${sourceUrl}${webhookPath}`,
  };

  config.webhooks.subscriptions.push(orderWebhookSub);

  // Write back to file
  try {
    const updatedContent = TOML.stringify(config);
    writeFileSync(shopifyTomlPath, updatedContent, "utf-8");
    console.log(`${shopifyTomlPath} updated successfully`);
    console.log("");
    console.log("Updated webhook subscription:");
    console.log(`  URI: ${orderWebhookSub.uri}`);
    console.log(`  (Hookdeck source: ${sourceUrl} + path: ${webhookPath})`);
    console.log("");
  } catch (error) {
    console.error(`Failed to update ${shopifyTomlPath}`);
    console.error(error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
