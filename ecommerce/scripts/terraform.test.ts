import { describe, expect, test } from "bun:test";

import { apiKeyHash, stateBackendPath } from "./terraform";

describe("API-key-scoped Terraform state", () => {
  test("uses a full SHA-256 digest without embedding the API key", () => {
    const apiKey = "test-api-key";
    const hash = apiKeyHash(apiKey);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(apiKey);
    expect(stateBackendPath(apiKey)).toBe(`.state/${hash}/terraform.tfstate`);
  });

  test("selects different state for different API keys", () => {
    expect(stateBackendPath("project-a-key")).not.toBe(
      stateBackendPath("project-b-key"),
    );
  });
});
