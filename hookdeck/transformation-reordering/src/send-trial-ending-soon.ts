import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const url = process.env.HOOKDECK_ENDPOINT_URL;

  if (!url) {
    console.error('HOOKDECK_ENDPOINT_URL is not set in the .env file');
    process.exit(1);
  }

  // Calculate trial_end timestamp for 2 days from now
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 2);
  const trialEndTimestamp = Math.floor(trialEndDate.getTime() / 1000);

  const postData = {
    type: 'subscription.updated',
    data: {
      id: 'sub_trial_ending',
      status: 'trialing',
      trial_end: trialEndTimestamp,
      pause: false,
      metadata: {},
    },
  };

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