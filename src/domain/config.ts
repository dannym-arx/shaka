/**
 * Shaka configuration types and utilities.
 *
 * The source of truth for default config is defaults/config.json.
 * This file defines the TypeScript interface and validation.
 */

import { type Result, err, ok } from "./result";

export interface ShakaConfig {
  readonly version: string;
  readonly reasoning: {
    readonly enabled: boolean;
  };
  readonly providers: {
    readonly claude: {
      readonly enabled: boolean;
    };
    readonly opencode: {
      readonly enabled: boolean;
    };
  };
  readonly assistant: {
    readonly name: string;
  };
  readonly principal: {
    readonly name: string;
  };
}

export function validateConfig(config: unknown): Result<ShakaConfig, Error> {
  if (!config || typeof config !== "object") {
    return err(new Error("Config must be an object"));
  }

  const c = config as Record<string, unknown>;

  if (typeof c.version !== "string") {
    return err(new Error("Config must have version string"));
  }

  if (!c.reasoning || typeof c.reasoning !== "object") {
    return err(new Error("Config must have reasoning section"));
  }

  if (!c.providers || typeof c.providers !== "object") {
    return err(new Error("Config must have providers section"));
  }

  if (!c.assistant || typeof c.assistant !== "object") {
    return err(new Error("Config must have assistant section"));
  }

  if (!c.principal || typeof c.principal !== "object") {
    return err(new Error("Config must have principal section"));
  }

  return ok(config as ShakaConfig);
}

export interface EnvVars {
  SHAKA_HOME?: string;
  XDG_CONFIG_HOME?: string;
  HOME?: string;
}

export function resolveShakaHome(env: EnvVars): string {
  // 1. Explicit SHAKA_HOME
  if (env.SHAKA_HOME) {
    return env.SHAKA_HOME;
  }

  // 2. XDG_CONFIG_HOME/shaka
  if (env.XDG_CONFIG_HOME) {
    return `${env.XDG_CONFIG_HOME}/shaka`;
  }

  // 3. ~/.config/shaka
  if (env.HOME) {
    return `${env.HOME}/.config/shaka`;
  }

  throw new Error("HOME environment variable not set");
}
