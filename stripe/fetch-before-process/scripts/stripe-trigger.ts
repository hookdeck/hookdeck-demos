import { spawn } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

const stripeApiKey = process.env.STRIPE_API_KEY;
if (!stripeApiKey) {
  console.error("STRIPE_API_KEY is not defined in your .env file.");
  process.exit(1);
}

// Get user-provided arguments, excluding the node executable and script path.
const args = process.argv.slice(2);

let times = 1;
const timeFlagIndex = args.findIndex((arg) => arg.startsWith("--times"));

if (timeFlagIndex !== -1) {
  const timeArg = args[timeFlagIndex];
  let timeValueString;
  let itemsToRemove = 1;

  if (timeArg.includes("=")) {
    timeValueString = timeArg.split("=")[1];
  } else {
    timeValueString = args[timeFlagIndex + 1];
    itemsToRemove = 2;
  }

  if (timeValueString) {
    const timeValue = parseInt(timeValueString, 10);
    if (!isNaN(timeValue) && timeValue > 0) {
      times = Math.min(timeValue, 50);
    }
  }

  // Remove the --times flag and its value from the arguments
  args.splice(timeFlagIndex, itemsToRemove);
}

const stripeArgs: string[] = ["trigger", ...args, "--api-key", stripeApiKey];

const runCommand = (iteration: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log(
      `[${iteration}/${times}] Running: stripe ${stripeArgs.join(" ")}`
    );

    const stripeProcess = spawn("stripe", stripeArgs, {
      stdio: "inherit",
      shell: true,
    });

    stripeProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    stripeProcess.on("error", (err) => {
      console.error(
        "Failed to start stripe process. Make sure the Stripe CLI is installed."
      );
      reject(err);
    });
  });
};

const run = async () => {
  for (let i = 1; i <= times; i++) {
    try {
      await runCommand(i);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }
  process.exit(0);
};

run();
