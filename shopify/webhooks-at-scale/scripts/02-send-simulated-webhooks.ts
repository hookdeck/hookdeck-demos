import * as dotenv from "dotenv";
import { createHmac, randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

// Load environment variables from .env file in project root
// Try to resolve relative to script location, fallback to process.cwd()
let envPath: string;
try {
  // @ts-ignore - __dirname is available in CommonJS
  envPath = resolve(__dirname, "..", ".env");
} catch {
  // Fallback to current working directory if __dirname not available
  envPath = resolve(process.cwd(), ".env");
}
dotenv.config({ path: envPath });

// Parse command line arguments
const args = process.argv.slice(2);
let burstSize = parseInt(process.env.BURST_SIZE || "300");
let duplicateEvery = parseInt(process.env.DUPLICATE_EVERY || "0");
let topic = process.env.TOPIC || "orders/create";
let includeCustomerPhone = process.env.INCLUDE_CUSTOMER_PHONE !== "false"; // Default to true

// Parse CLI flags
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--burst" && args[i + 1]) {
    burstSize = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === "--duplicate-every" && args[i + 1]) {
    duplicateEvery = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === "--topic" && args[i + 1]) {
    topic = args[i + 1];
    i++;
  } else if (args[i] === "--no-customer-phone") {
    includeCustomerPhone = false;
  } else if (args[i] === "--with-customer-phone") {
    includeCustomerPhone = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ts-node 02-send-simulated-webhooks.ts [options]

Options:
  --burst <number>              Number of webhooks to send (default: 300, or BURST_SIZE env var)
  --duplicate-every <number>    Reuse same event ID every N requests (default: 0 = unique IDs, or DUPLICATE_EVERY env var)
  --topic <string>              Webhook topic (default: orders/create, or TOPIC env var)
                                Supported topics: orders/create, orders/updated, orders/paid, orders/cancelled, etc.
  --no-customer-phone           Exclude customer.phone from payload (for failure scenarios)
  --with-customer-phone          Include customer.phone in payload (default)
  --help, -h                    Show this help message

Environment Variables:
  HOOKDECK_SOURCE_URL           Required: Hookdeck source URL (base URL, path will be appended)
  SHOPIFY_CLIENT_SECRET         Required: Client secret for HMAC signature generation (should match what 'shopify app dev' uses)
  BURST_SIZE                     Default burst size if --burst not provided
  DUPLICATE_EVERY                Default duplicate frequency if --duplicate-every not provided
  TOPIC                          Default topic if --topic not provided
  INCLUDE_CUSTOMER_PHONE         Set to "false" to exclude customer.phone (default: true)
`);
    process.exit(0);
  }
}

// Validate required environment variables
const baseSourceUrl = process.env.HOOKDECK_SOURCE_URL;
if (!baseSourceUrl) {
  console.error("Error: HOOKDECK_SOURCE_URL environment variable is not set");
  console.error(
    "Please set it in your .env file or as an environment variable",
  );
  process.exit(1);
}

// Append the webhook path to the Hookdeck source URL
// This matches the path configured in shopify.app.toml
const webhookPath = "/webhooks/shopify/orders";
const sourceUrl = baseSourceUrl.endsWith("/")
  ? `${baseSourceUrl.slice(0, -1)}${webhookPath}`
  : `${baseSourceUrl}${webhookPath}`;

// Get Shopify client secret from .env file - REQUIRED
// This should match the secret that 'shopify app dev' auto-injects into the Shopify SDK
// The Shopify SDK uses this secret to verify webhook HMAC signatures
const shopifySecretEnv = process.env.SHOPIFY_CLIENT_SECRET;

if (!shopifySecretEnv) {
  console.error("Error: SHOPIFY_CLIENT_SECRET environment variable is not set");
  console.error(
    "Please set it in your .env file. This should match the client secret that 'shopify app dev' uses.",
  );
  console.error(
    "You can find it by running: shopify app env show --path ./shopify",
  );
  process.exit(1);
}

// TypeScript now knows this is definitely a string (process.exit above ensures it)
const shopifySecret: string = shopifySecretEnv;

console.log(`✓ Using SHOPIFY_CLIENT_SECRET (length: ${shopifySecret.length})`);
console.log(
  `  (This should match the secret that 'shopify app dev' injects for signature verification)`,
);

// Array of 10 different email recipients
const emailRecipients = [
  "john@example.com",
  "jane@example.com",
  "bob@example.com",
  "alice@example.com",
  "charlie@example.com",
  "diana@example.com",
  "eve@example.com",
  "frank@example.com",
  "grace@example.com",
  "henry@example.com",
];

// Order payload matching include_fields structure
// Can include/exclude customer.phone for failure scenario testing
function createOrderPayload(id: number, includePhone: boolean = true): any {
  // Randomly select one of the 10 email recipients
  const randomEmail =
    emailRecipients[Math.floor(Math.random() * emailRecipients.length)];

  const payload: any = {
    id: id,
    updated_at: new Date().toISOString(),
    admin_graphql_api_id: `gid://shopify/Order/${id}`,
    customer: {
      id: 115310627314723954,
      email: randomEmail,
    },
    billing_address: {
      phone: includePhone ? "123-123-1234" : null,
    },
  };

  // Include customer.phone only if requested
  if (includePhone) {
    payload.customer.phone = "123-123-1234";
  }

  return payload;
}

// Generate HMAC signature (secret is always available as it's required)
function generateSignature(payload: string): string {
  const hmac = createHmac("sha256", shopifySecret);
  hmac.update(payload, "utf8");
  return hmac.digest("base64");
}

// Send a single webhook
async function sendWebhook(
  eventId: string,
  topic: string,
  payload: any,
): Promise<{ success: boolean; status: number; error?: string }> {
  // Use JSON.stringify with no spaces to ensure consistent formatting
  // This matches what Shopify sends (compact JSON)
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Shopify-Captain-Hook", // Match Shopify user agent
    "X-Shopify-Event-Id": eventId,
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": "demo.myshopify.com",
    "X-Shopify-Triggered-At": new Date().toISOString(),
    "X-Shopify-Api-Version": "2026-01",
    "X-Shopify-Test": "true", // Match Shopify CLI test webhooks
    "X-Shopify-Webhook-Id": randomUUID(),
    "X-Shopify-Hmac-SHA256": signature, // Always include signature
  };

  try {
    // sourceUrl is guaranteed to be defined due to validation above
    const response = await fetch(sourceUrl!, {
      method: "POST",
      headers,
      body: payloadString,
    });

    return {
      success: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 0,
      error: error.message || "Network error",
    };
  }
}

// Main execution
async function main() {
  console.log("==========================================");
  console.log("Simulated Shopify Webhook Sender");
  console.log("==========================================");
  console.log(`Base Source URL: ${baseSourceUrl}`);
  console.log(`Full Webhook URL: ${sourceUrl}`);
  console.log(`Burst size: ${burstSize}`);
  console.log(`Topic: ${topic}`);
  console.log(
    `Duplicate mode: ${
      duplicateEvery > 0
        ? `Every ${duplicateEvery} requests`
        : "Unique event IDs"
    }`,
  );
  console.log(
    `Customer phone: ${includeCustomerPhone ? "included" : "excluded"}`,
  );
  console.log("==========================================");
  console.log("");

  let successCount = 0;
  let failureCount = 0;
  const failures: Array<{ index: number; error: string }> = [];

  // Generate event IDs based on duplicate mode
  const eventIds: string[] = [];
  for (let i = 0; i < burstSize; i++) {
    if (duplicateEvery > 0 && i % duplicateEvery === 0) {
      // Reuse event ID every N requests
      eventIds.push(randomUUID());
    } else if (duplicateEvery > 0) {
      // Reuse the last event ID
      eventIds.push(eventIds[eventIds.length - 1]);
    } else {
      // Unique event ID for each request
      eventIds.push(randomUUID());
    }
  }

  console.log(`Sending ${burstSize} webhooks...`);
  const startTime = Date.now();

  // Send webhooks with progress updates
  for (let i = 0; i < burstSize; i++) {
    const payload = createOrderPayload(1000000 + i, includeCustomerPhone);
    const result = await sendWebhook(eventIds[i], topic, payload);

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
      failures.push({
        index: i + 1,
        error: result.error || `HTTP ${result.status}`,
      });
    }

    // Progress update every 50 requests
    if ((i + 1) % 50 === 0 || i === burstSize - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `Progress: ${
          i + 1
        }/${burstSize} (${successCount} success, ${failureCount} failures) - ${elapsed}s`,
      );
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("");
  console.log("==========================================");
  console.log("Summary");
  console.log("==========================================");
  console.log(`Total: ${burstSize}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failures: ${failureCount}`);
  console.log(`Time: ${elapsed}s`);
  console.log(`Rate: ${(burstSize / parseFloat(elapsed)).toFixed(2)} req/s`);

  if (failures.length > 0) {
    console.log("");
    console.log("First 10 failures:");
    failures.slice(0, 10).forEach((f) => {
      console.log(`  Request ${f.index}: ${f.error}`);
    });
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more`);
    }
  }

  console.log("==========================================");

  // Exit with error code if there were failures
  if (failureCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
