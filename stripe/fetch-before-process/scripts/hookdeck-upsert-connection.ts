import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.HOOKDECK_API_KEY) {
  console.error("HOOKDECK_API_KEY is not defined in your .env file.");
  process.exit(1);
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.error("STRIPE_WEBHOOK_SECRET is not defined in your .env file.");
  process.exit(1);
}

async function upsertConnection(payload: any): Promise<any> {
  try {
    const response = await fetch(
      `https://api.hookdeck.com/2025-01-01/connections`,
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

    const data = await response.json();
    console.log("Connection upserted successfully");
    console.log("Source URL:", data.source.url);
    return data;
  } catch (error) {
    console.error("Error upserting connection:", error);
    throw error;
  }
}

const connectionPayload = {
  name: "conn_stripe_invoices",
  source: {
    name: "stripe_invoice_webhooks",
    type: "STRIPE",
    config: {
      webhook_secret_key: process.env.STRIPE_WEBHOOK_SECRET,
    },
  },
  destination: {
    name: "stripe_invoice_api",
    description: null,
    config: {
      url: "https://371d-2a00-23c8-8141-f001-4f5-4e7e-feb8-5fc4.ngrok-free.app/api/stripe/invoices",
      rate_limit: 25,
      rate_limit_period: "second",
      auth: {},
      auth_type: "HOOKDECK_SIGNATURE",
    },
  },
};

upsertConnection(connectionPayload)
  .then((connection) => {
    console.log("Upsert operation completed.", connection);
  })
  .catch((error) => {
    console.error("Failed to upsert connection:", error.message);
    process.exit(1);
  });
