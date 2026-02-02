import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  detectInstalledProviders,
  isProviderInstalled,
  type DetectedProviders,
} from "../../../src/services/provider-detection";

describe("provider-detection", () => {
  describe("detectInstalledProviders", () => {
    test("returns object with claude and opencode properties", async () => {
      const result = await detectInstalledProviders();

      expect(result).toHaveProperty("claude");
      expect(result).toHaveProperty("opencode");
      expect(typeof result.claude).toBe("boolean");
      expect(typeof result.opencode).toBe("boolean");
    });

    test("result shape matches DetectedProviders interface", async () => {
      const result: DetectedProviders = await detectInstalledProviders();

      // TypeScript compilation verifies the shape
      expect(result).toBeDefined();
    });
  });

  describe("isProviderInstalled", () => {
    test("returns boolean for claude", async () => {
      const result = await isProviderInstalled("claude");
      expect(typeof result).toBe("boolean");
    });

    test("returns boolean for opencode", async () => {
      const result = await isProviderInstalled("opencode");
      expect(typeof result).toBe("boolean");
    });
  });
});
