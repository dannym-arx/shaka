/**
 * Provider registry and factory.
 * Central place to get provider configurers.
 */

import { ClaudeProviderConfigurer } from "./claude/configurer";
import { OpencodeProviderConfigurer } from "./opencode/configurer";
import type { ProviderConfigurer, ProviderName } from "./types";

export function createProvider(name: ProviderName): ProviderConfigurer {
  switch (name) {
    case "claude":
      return new ClaudeProviderConfigurer();
    case "opencode":
      return new OpencodeProviderConfigurer();
  }
}

export function getAllProviders(): ProviderConfigurer[] {
  return [new ClaudeProviderConfigurer(), new OpencodeProviderConfigurer()];
}
