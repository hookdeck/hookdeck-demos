import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Replace with your Trigger.dev project ref from the dashboard
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
