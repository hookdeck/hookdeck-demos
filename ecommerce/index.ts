import TEMPLATES from "./templates/templates";
import {
  poissonDelaySeconds,
  ShopifyDeliveryGroupTraffic,
} from "./traffic/shopify-delivery-groups";

const API_VERSION = "2025-07-01";

const HOOKDECK_API_KEY =
  Bun.env.HOOKDECK_API_KEY ?? Bun.env.TF_VAR_hookdeck_api_key;

const API_URL = Bun.env.HOOKDECK_API_URL ?? Bun.env.TF_VAR_hookdeck_api_url;

if (!HOOKDECK_API_KEY) {
  throw new Error(
    "HOOKDECK_API_KEY or TF_VAR_hookdeck_api_key is not defined in your .env file.",
  );
}

if (!API_URL) {
  throw new Error(
    "HOOKDECK_API_URL or TF_VAR_hookdeck_api_url is not defined in your .env file.",
  );
}

const VARIANCE_PERCENTAGE_CHANGE = 0.5;

type TrafficProfile = "shopify-delivery-groups";

interface Template {
  data: () => { headers: Record<string, string>; body: any };
  base_rate_seconds: number;
  name: string;
  signature_header: string;
  traffic_profile?: TrafficProfile;
}

const response = await fetch(`${API_URL}/${API_VERSION}/sources`, {
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${HOOKDECK_API_KEY}`,
  },
});

const sources = (await response.json()).models;

const sources_by_name = sources.reduce(
  (acc: Record<string, any>, source: any) => {
    acc[source.name] = source;
    return acc;
  },
  {},
);

async function sendRequest(
  source: string,
  signature_header: string,
  data: {
    headers: Record<string, string>;
    body: any;
  },
) {
  try {
    const { headers, body } = data;
    const body_string = JSON.stringify(body);
    const response = await fetch(sources_by_name[source].url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        [signature_header]:
          source === "bigcommerce"
            ? `v1,${new Bun.CryptoHasher("sha256", "secret-key")
                .update(
                  `${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body_string}`,
                )
                .digest("base64")}`
            : new Bun.CryptoHasher("sha256", "secret-key")
                .update(body_string)
                .digest("base64"),
      },
      body: body_string,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error sending request to ${source}:`, error);
  }
}

async function sleep(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function processTemplates() {
  const allTemplates = Object.values(TEMPLATES).flat() as Template[];
  const shopifyDeliveryGroupTemplates = allTemplates.filter(
    (template) => template.traffic_profile === "shopify-delivery-groups",
  );
  const shopifyDeliveryGroupTraffic = new ShopifyDeliveryGroupTraffic(
    shopifyDeliveryGroupTemplates.reduce(
      (rate, template) => rate + template.base_rate_seconds,
      0,
    ),
  );

  Object.entries(TEMPLATES).forEach(async ([platform, templates]) => {
    console.log(`Processing ${platform} templates...`);

    const source = sources_by_name[platform];
    if (!source) {
      console.error(`Source for ${platform} not found`);
      return;
    }

    (templates as Template[]).forEach(async (template) => {
      if (template.traffic_profile === "shopify-delivery-groups") {
        while (true) {
          const traffic = shopifyDeliveryGroupTraffic.next();
          const data = template.data();
          data.headers["x-shopify-shop-domain"] = traffic.store;

          sendRequest(source.name, template.signature_header, data);
          await sleep(
            poissonDelaySeconds(
              template.base_rate_seconds * traffic.rateMultiplier,
            ),
          );
        }
      }

      let variance = 0;

      const updateVariance = async () => {
        while (true) {
          // Sleep between 1 and 120 seconds
          await sleep(Math.floor(Math.random() * 120) + 1);
          variance = Math.random() * VARIANCE_PERCENTAGE_CHANGE;
        }
      };

      void updateVariance();

      while (true) {
        const delayBetweenRequests =
          (1 / template.base_rate_seconds) * (1 - variance);
        // Send request and wait for the calculated delay
        sendRequest(source.name, template.signature_header, template.data());
        await sleep(delayBetweenRequests);
      }
    });
  });
}

// Start processing templates
processTemplates().catch((error) => {
  console.error("Error processing templates:", error);
  process.exit(1);
});
