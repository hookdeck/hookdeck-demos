import { exec, spawn } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

const hookdeckApiKey = process.env.HOOKDECK_API_KEY;
if (!hookdeckApiKey) {
  console.error("HOOKDECK_API_KEY is not defined in your .env file.");
  process.exit(1);
}

async function getConnectionByName(name: string): Promise<any> {
  try {
    const response = await fetch(
      "https://api.hookdeck.com/2025-01-01/connections",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${hookdeckApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log("Fetched connections:", data);
    const connection = data.models.find((conn: any) => conn.name === name);

    if (!connection) {
      console.error(`Connection with name "${name}" not found`);
      return null;
    }

    return connection;
  } catch (error) {
    console.error("Error fetching connection:", error);
    throw error;
  }
}

const args = process.argv.slice(2);
const connectionName = args[0];

if (!connectionName) {
  console.error("Connection name is required");
  process.exit(1);
}

// Execute the function
getConnectionByName(connectionName)
  .then((connection) => {
    console.log("Connection found:", connection);
  })
  .catch((error) => {
    console.error("Failed to get connection:", error);
    process.exit(1);
  });
