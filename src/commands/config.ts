/**
 * CLI handler for `shaka config` command.
 *
 * Manages shaka configuration values with get/set subcommands.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";

/**
 * Get a value at a dot-notation path in an object.
 *
 * @example getPath({ a: { b: { c: "value" } } }, "a.b.c") => "value"
 * @example getPath({ a: { b: 1 } }, "a.b.c") => undefined
 */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a value at a dot-notation path in an object.
 * Creates intermediate objects as needed.
 *
 * Returns an error message if the operation would overwrite an existing object
 * with a primitive value (destructive overwrite).
 *
 * @example setPath({}, "a.b.c", "value") => { a: { b: { c: "value" } } }
 */
export function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string;
    const existing = current[key];

    if (existing === undefined || existing === null) {
      // Create intermediate object
      current[key] = {};
    } else if (typeof existing !== "object" || Array.isArray(existing)) {
      // Can't traverse through a primitive or array
      const partialPath = keys.slice(0, i + 1).join(".");
      return {
        ok: false,
        error: `Cannot set "${path}": "${partialPath}" is not an object`,
      };
    }

    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1] as string;
  const existingValue = current[finalKey];

  // Prevent destructive overwrites: don't replace an object with a primitive
  if (
    existingValue !== undefined &&
    existingValue !== null &&
    typeof existingValue === "object" &&
    !Array.isArray(existingValue) &&
    Object.keys(existingValue).length > 0 &&
    (typeof value !== "object" || value === null)
  ) {
    return {
      ok: false,
      error: `Cannot set "${path}": would overwrite an object with ${Object.keys(existingValue).length} keys. Use a more specific path or remove the object first.`,
    };
  }

  current[finalKey] = value;
  return { ok: true };
}

/**
 * Parse a value string, attempting to convert to appropriate type.
 * - "true"/"false" => boolean
 * - numeric strings => number
 * - everything else => string
 */
export function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;

  // Only parse as number if it looks like a simple decimal number
  // Avoid parsing hex (0x), octal (0o), or scientific notation unexpectedly
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }

  return value;
}

export function createConfigCommand(): Command {
  const config = new Command("config").description("Manage Shaka configuration");

  config
    .command("get <key>")
    .description("Get a configuration value (e.g., providers.opencode.summarization_model)")
    .action(async (key: string) => {
      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });

      const configPath = `${shakaHome}/config.json`;
      const file = Bun.file(configPath);

      if (!(await file.exists())) {
        console.error("ERROR: config.json not found. Run `shaka init` first.");
        process.exit(1);
      }

      const configData = (await file.json()) as Record<string, unknown>;
      const value = getPath(configData, key);

      if (value === undefined) {
        console.error(`ERROR: Key "${key}" not found in config`);
        process.exit(1);
      }

      // Pretty print objects, raw value for primitives
      if (typeof value === "object" && value !== null) {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    });

  config
    .command("set <key=value>")
    .description("Set a configuration value (e.g., providers.opencode.summarization_model=...)")
    .action(async (assignment: string) => {
      const eqIndex = assignment.indexOf("=");
      if (eqIndex === -1) {
        console.error("ERROR: Invalid format. Use: shaka config set key=value");
        process.exit(1);
      }

      const key = assignment.slice(0, eqIndex);
      const value = assignment.slice(eqIndex + 1);

      if (!key) {
        console.error("ERROR: Key cannot be empty");
        process.exit(1);
      }

      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });

      const configPath = `${shakaHome}/config.json`;
      const file = Bun.file(configPath);

      if (!(await file.exists())) {
        console.error("ERROR: config.json not found. Run `shaka init` first.");
        process.exit(1);
      }

      const configData = (await file.json()) as Record<string, unknown>;
      const parsedValue = parseValue(value);

      const result = setPath(configData, key, parsedValue);
      if (!result.ok) {
        console.error(`ERROR: ${result.error}`);
        process.exit(1);
      }

      await Bun.write(configPath, `${JSON.stringify(configData, null, 2)}\n`);
      console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
    });

  return config;
}
