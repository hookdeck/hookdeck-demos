import TEMPLATES from "./templates/templates";

const API_VERSION = "2024-09-01";

const HOOKDECK_API_KEY = "4emxvbpbks0w8j75tu4iu87twsdu649u8qis9ggxmn30wfxl0m";

const API_URL = "https://api.hookdeck.com";

const VARIANCE_PERCENTAGE_CHANGE = 0.5;

interface Template {
  data: () => { headers: Record<string, string>; body: any };
  base_rate_seconds: number;
  name: string;
  signature_header: string;
}

const response = await fetch(
  `${API_URL}/${API_VERSION}/sources`,
  {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HOOKDECK_API_KEY}`,
    },
  }
);

const sources = (await response.json()).models;

const sources_by_name = sources.reduce(
  (acc: Record<string, any>, source: any) => {
    acc[source.name] = source;
    return acc;
  },
  {}
);

async function sendRequest(
  source: string,
  signature_header: string,
  data: {
    headers: Record<string, string>;
    body: any;
  }
) {
  try {
    const { headers, body } = data;
    const body_string = JSON.stringify(body);
    const response = await fetch(sources_by_name[source].url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        [signature_header]: new Bun.CryptoHasher("sha256", "secret-key")
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
  Object.entries(TEMPLATES).forEach(async ([platform, templates]) => {
    console.log(`Processing ${platform} templates...`);

    const source = sources_by_name[platform];
    if (!source) {
      console.error(`Source for ${platform} not found`);
      return;
    }

    (templates as Template[]).forEach(async (template) => {
      let variance = 0;

      const updateVariance = async () => {
        // Sleep between 1 and 120 seconds
        await sleep(Math.floor(Math.random() * 120) + 1);
        variance = Math.random() * VARIANCE_PERCENTAGE_CHANGE;
        updateVariance();
      };

      updateVariance();

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
