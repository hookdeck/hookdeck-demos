import * as dotenv from 'dotenv';

dotenv.config();

const postData = {
  type: 'subscription.updated',
  data: {
    id: 'sub_paused',
    status: 'active',
    trial_end: null,
    pause: true,
    metadata: {},
  },
};

async function main() {
  const url = process.env.HOOKDECK_ENDPOINT_URL;

  if (!url) {
    console.error('HOOKDECK_ENDPOINT_URL is not set in the .env file');
    process.exit(1);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postData),
    });

    console.log(`STATUS: ${response.status}`);
    const responseBody = await response.text();
    console.log(`BODY: ${responseBody}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`problem with request: ${error.message}`);
    } else {
      console.error('An unknown error occurred');
    }
  }
}

main();