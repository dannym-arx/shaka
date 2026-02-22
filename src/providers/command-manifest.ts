/**
 * Command manifest I/O.
 *
 * Tracks which commands Shaka installed to provider directories.
 * Used during clean-then-install to remove orphaned commands.
 */

import { join } from "node:path";

const MANIFEST_FILE = "commands-manifest.json";

export interface CommandManifest {
  global: string[];
  scoped: Record<string, string[]>;
}

/** Read manifest from shakaHome. Returns empty manifest if file doesn't exist. */
export async function readManifest(shakaHome: string): Promise<CommandManifest> {
  const file = Bun.file(join(shakaHome, MANIFEST_FILE));
  if (!(await file.exists())) return { global: [], scoped: {} };
  try {
    const raw = (await file.json()) as Record<string, unknown>;
    return {
      global: Array.isArray(raw.global) ? raw.global : [],
      scoped:
        raw.scoped && typeof raw.scoped === "object" && !Array.isArray(raw.scoped)
          ? (Object.fromEntries(
              Object.entries(raw.scoped as Record<string, unknown>).filter(([, v]) =>
                Array.isArray(v),
              ),
            ) as Record<string, string[]>)
          : {},
    };
  } catch {
    return { global: [], scoped: {} };
  }
}

/** Write manifest to shakaHome. Overwrites existing. */
export async function writeManifest(shakaHome: string, manifest: CommandManifest): Promise<void> {
  await Bun.write(join(shakaHome, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}
