import * as dotenv from "dotenv";
import { resolve } from "path";
import { execSync } from "child_process";

// Load environment variables from .env file in project root
dotenv.config({ path: resolve(process.cwd(), ".env") });

// Parse command line arguments
const args = process.argv.slice(2);
let topic = "orders/create";
let address: string | undefined;

// Parse CLI flags
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--topic" && args[i + 1]) {
    topic = args[i + 1];
    i++;
  } else if (args[i] === "--address" && args[i + 1]) {
    address = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ts-node scripts/03-trigger-shopify-webhook.ts [options]

Options:
  --topic <string>              Webhook topic (default: orders/create)
                                Supported: orders/create, orders/updated, orders/paid, etc.
  --address <url>               Override webhook destination URL
                                If not provided, uses HOOKDECK_SOURCE_URL + /webhooks/shopify/orders
  --help, -h                    Show this help message

Environment Variables:
  HOOKDECK_SOURCE_URL           Required: Hookdeck source URL (base URL, path will be appended)
                                Only used if --address is not provided

Examples:
  # Trigger orders/create webhook to Hookdeck
  npm run trigger:shopify

  # Trigger orders/updated webhook
  npm run trigger:shopify -- --topic orders/updated

  # Trigger to a custom address
  npm run trigger:shopify -- --address https://example.com/webhook
`);
    process.exit(0);
  }
}

// Determine the webhook address
let webhookAddress: string;
if (address) {
  webhookAddress = address;
} else {
  const baseSourceUrl = process.env.HOOKDECK_SOURCE_URL;
  if (!baseSourceUrl) {
    console.error("Error: HOOKDECK_SOURCE_URL environment variable is not set");
    console.error(
      "Please set it in your .env file, or use --address flag to specify a custom URL"
    );
    process.exit(1);
  }

  // Append the webhook path to the Hookdeck source URL
  const webhookPath = "/webhooks/shopify/orders";
  webhookAddress = baseSourceUrl.endsWith("/")
    ? `${baseSourceUrl.slice(0, -1)}${webhookPath}`
    : `${baseSourceUrl}${webhookPath}`;
}

// Get Shopify app directory
const shopifyDir = resolve(process.cwd(), "shopify");

console.log("==========================================");
console.log("Shopify Webhook Trigger");
console.log("==========================================");
console.log(`Topic: ${topic}`);
console.log(`Address: ${webhookAddress}`);
console.log(`Shopify app directory: ${shopifyDir}`);
console.log("");

// Build the command
const command = [
  "shopify",
  "app",
  "webhook",
  "trigger",
  "--topic",
  topic,
  "--address",
  webhookAddress,
  "--api-version",
  "2026-01",
  "--path",
  shopifyDir,
].join(" ");

console.log(`Running: ${command}`);
console.log("");

try {
  execSync(command, {
    stdio: "inherit",
    encoding: "utf-8",
  });
  console.log("");
  console.log("==========================================");
  console.log("Webhook triggered successfully!");
  console.log("==========================================");
} catch (error) {
  console.error("");
  console.error("Failed to trigger webhook");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}
