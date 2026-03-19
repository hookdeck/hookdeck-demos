import fs from "node:fs/promises";
import path from "node:path";

const HOOKDECK_API_KEY = process.env.HOOKDECK_API_KEY;
const HOOKDECK_API_URL = "https://api.hookdeck.com/2025-01-01"; // Updated API version

if (!HOOKDECK_API_KEY) {
  console.error("Error: HOOKDECK_API_KEY is not defined in your .env file.");
  process.exit(1);
}

interface HookdeckResource {
  id: string;
  name?: string; // Optional, for logging
}

interface PaginatedResponse<T> {
  pagination: {
    order_by: string;
    dir: string;
    limit: number;
    next: string | null;
  };
  count: number;
  models: T[];
}

async function fetchAllPaginatedResources<T extends HookdeckResource>(
  resourceType: "sources" | "destinations"
): Promise<T[]> {
  let allResources: T[] = [];
  let nextCursor: string | null = null;
  let page = 1;

  console.log(`Fetching all ${resourceType} (page ${page})...`);

  do {
    const url = nextCursor
      ? `${HOOKDECK_API_URL}/${resourceType}?next=${nextCursor}`
      : `${HOOKDECK_API_URL}/${resourceType}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${HOOKDECK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(
        `Error fetching page ${page} of ${resourceType}: ${response.status} ${response.statusText}`,
        errorData
      );
      throw new Error(`Failed to fetch ${resourceType}`);
    }

    const paginatedResponse = (await response.json()) as PaginatedResponse<T>;
    allResources = allResources.concat(paginatedResponse.models);
    nextCursor = paginatedResponse.pagination.next;

    if (nextCursor) {
      page++;
      console.log(
        `Fetching all ${resourceType} (page ${page}, using cursor ${nextCursor})...`
      );
    }
  } while (nextCursor);

  console.log(
    `Fetched a total of ${allResources.length} ${resourceType} across ${page} page(s).`
  );
  return allResources;
}

async function deleteAllSources() {
  console.log("Processing sources...");
  try {
    const sources = await fetchAllPaginatedResources<HookdeckResource>(
      "sources"
    );

    if (!sources || sources.length === 0) {
      console.log("No sources found to delete.");
      return;
    }

    console.log(`Found ${sources.length} sources. Deleting them...`);

    for (const source of sources) {
      try {
        const deleteResponse = await fetch(
          `${HOOKDECK_API_URL}/sources/${source.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${HOOKDECK_API_KEY}`,
            },
          }
        );

        if (deleteResponse.ok) {
          console.log(
            `Successfully deleted source: ${source.name || source.id}`
          );
        } else {
          const errorData = await deleteResponse.json();
          console.error(
            `Error deleting source ${source.name || source.id} (ID: ${
              source.id
            }): ${deleteResponse.status} ${deleteResponse.statusText}`,
            errorData
          );
        }
      } catch (error) {
        console.error(
          `An unexpected error occurred while deleting source ${
            source.name || source.id
          } (ID: ${source.id}):`,
          error
        );
      }
    }
    console.log("Finished deleting sources.");
  } catch (error) {
    console.error(
      "An unexpected error occurred while fetching/deleting sources:",
      error
    );
  }
}

async function deleteAllDestinations() {
  console.log("\nProcessing destinations...");
  try {
    const destinations = await fetchAllPaginatedResources<HookdeckResource>(
      "destinations"
    );

    if (!destinations || destinations.length === 0) {
      console.log("No destinations found to delete.");
      return;
    }

    console.log(`Found ${destinations.length} destinations. Deleting them...`);

    for (const destination of destinations) {
      try {
        const deleteResponse = await fetch(
          `${HOOKDECK_API_URL}/destinations/${destination.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${HOOKDECK_API_KEY}`,
            },
          }
        );

        if (deleteResponse.ok) {
          console.log(
            `Successfully deleted destination: ${
              destination.name || destination.id
            }`
          );
        } else {
          const errorData = await deleteResponse.json();
          console.error(
            `Error deleting destination ${
              destination.name || destination.id
            } (ID: ${destination.id}): ${deleteResponse.status} ${
              deleteResponse.statusText
            }`,
            errorData
          );
        }
      } catch (error) {
        console.error(
          `An unexpected error occurred while deleting destination ${
            destination.name || destination.id
          } (ID: ${destination.id}):`,
          error
        );
      }
    }
    console.log("Finished deleting destinations.");
  } catch (error) {
    console.error(
      "An unexpected error occurred while fetching/deleting destinations:",
      error
    );
  }
}

async function deleteTerraformStateFiles() {
  console.log("\nDeleting Terraform state files...");
  const filesToDelete = [
    path.join("terraform", "terraform.tfstate"),
    path.join("terraform", ".terraform.lock.hcl"),
    path.join("terraform", "terraform.tfstate.backup"),
  ];

  for (const file of filesToDelete) {
    try {
      await fs.unlink(file);
      console.log(`Successfully deleted Terraform state file: ${file}`);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        console.log(
          `Terraform state file not found (already deleted?): ${file}`
        );
      } else {
        console.error(`Error deleting Terraform state file ${file}:`, error);
      }
    }
  }
  console.log("Finished deleting Terraform state files.");
}

async function main() {
  console.log("Starting deletion script...");
  await deleteAllSources();
  await deleteAllDestinations();
  await deleteTerraformStateFiles();
  console.log("\nDeletion script finished.");
}

main().catch((error) => {
  console.error("Unhandled error in main execution:", error);
  process.exit(1);
});
