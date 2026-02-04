import { describe, expect, test } from "bun:test";
import { ClaudeProviderConfigurer } from "../../../src/providers/claude/configurer";
import { OpencodeProviderConfigurer } from "../../../src/providers/opencode/configurer";
import { createProvider, getAllProviders } from "../../../src/providers/registry";

describe("Provider Registry", () => {
  describe("createProvider", () => {
    test("creates Claude provider", () => {
      const provider = createProvider("claude");
      expect(provider).toBeInstanceOf(ClaudeProviderConfigurer);
      expect(provider.name).toBe("claude");
    });

    test("creates opencode provider", () => {
      const provider = createProvider("opencode");
      expect(provider).toBeInstanceOf(OpencodeProviderConfigurer);
      expect(provider.name).toBe("opencode");
    });
  });

  describe("getAllProviders", () => {
    test("returns both providers", () => {
      const providers = getAllProviders();
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.name)).toContain("claude");
      expect(providers.map((p) => p.name)).toContain("opencode");
    });
  });
});
