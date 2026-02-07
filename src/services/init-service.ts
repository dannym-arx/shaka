/**
 * Init service for `shaka init` command.
 *
 * Creates user-owned directories, symlinks system/ to the repo's defaults,
 * copies user templates (per-file, never overwrites), links the shaka library,
 * and tracks the installed version.
 */

import { lstat, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import { type Result, err, ok } from "../domain/result";
import { getCurrentVersion } from "../domain/version";
import {
  type DetectedProviders,
  type ProviderName,
  detectInstalledProviders,
} from "./provider-detection";

// Resolve defaults directory relative to this module
const DEFAULT_DEFAULTS_PATH = new URL("../../defaults", import.meta.url).pathname;
const DEFAULT_REPO_ROOT = new URL("../..", import.meta.url).pathname;

export interface InitServiceConfig {
  shakaHome: string;
  /** Path to defaults directory (for testing) */
  defaultsPath?: string;
  /** Path to repo root (for bun link; for testing) */
  repoRoot?: string;
  /** Override provider detection (for testing) */
  detectProviders?: () => Promise<DetectedProviders>;
  /** Override bun link execution (for testing) */
  runBunLink?: (cwd: string, args: string[]) => Promise<Result<void, Error>>;
}

export interface InitOptions {
  /** Specific providers to install. If empty/undefined, installs all detected. */
  providers?: ProviderName[];
  force?: boolean;
}

export interface InitResult {
  providers: {
    claude: { detected: boolean; installed: boolean };
    opencode: { detected: boolean; installed: boolean };
  };
  directories: string[];
  files: string[];
  symlinks: string[];
  currentVersion: string;
}

/** Default bun link runner using Bun.spawn. */
async function defaultRunBunLink(cwd: string, args: string[]): Promise<Result<void, Error>> {
  try {
    const proc = Bun.spawn(["bun", "link", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return err(
        new Error(`bun link ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`),
      );
    }
    return ok(undefined);
  } catch (e) {
    return err(new Error(`bun link failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export class InitService {
  private readonly shakaHome: string;
  private readonly defaultsPath: string;
  private readonly repoRoot: string;
  private readonly detectProviders: () => Promise<DetectedProviders>;
  private readonly runBunLink: (cwd: string, args: string[]) => Promise<Result<void, Error>>;

  constructor(config: InitServiceConfig) {
    this.shakaHome = config.shakaHome;
    this.defaultsPath = config.defaultsPath ?? DEFAULT_DEFAULTS_PATH;
    this.repoRoot = config.repoRoot ?? DEFAULT_REPO_ROOT;
    this.detectProviders = config.detectProviders ?? detectInstalledProviders;
    this.runBunLink = config.runBunLink ?? defaultRunBunLink;
  }

  /**
   * Create user-owned directories (never replaced on upgrade).
   * system/ is handled separately via symlink.
   */
  async createDirectories(): Promise<Result<string[], Error>> {
    const directories = [
      this.shakaHome,
      `${this.shakaHome}/user`,
      `${this.shakaHome}/memory`,
      `${this.shakaHome}/customizations`,
    ];

    for (const dir of directories) {
      try {
        await mkdir(dir, { recursive: true });
      } catch (e) {
        return err(
          new Error(
            `Failed to create directory '${dir}': ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    }

    return ok(directories);
  }

  /**
   * Create symlink: ~/.config/shaka/system → <repo>/defaults/system
   *
   * Handles four cases:
   * 1. No system/ exists → create symlink
   * 2. system/ is already a correct symlink → no-op
   * 3. system/ is a symlink to wrong target → replace
   * 4. system/ is a real directory → error (user must resolve manually)
   */
  async linkSystem(): Promise<Result<string[], Error>> {
    const linkPath = `${this.shakaHome}/system`;
    const target = `${this.defaultsPath}/system`;
    const symlinks: string[] = [];

    try {
      let exists = false;
      let isLink = false;

      try {
        const stats = await lstat(linkPath);
        exists = true;
        isLink = stats.isSymbolicLink();
      } catch {
        // Does not exist — will create
      }

      if (exists && !isLink) {
        return err(
          new Error(
            `${linkPath} exists as a real directory. Move any custom files to customizations/ and remove system/, then re-run init.`,
          ),
        );
      }

      if (exists && isLink) {
        const currentTarget = await readlink(linkPath);
        if (currentTarget === target) {
          // Already correct
          return ok(symlinks);
        }
        // Wrong target — remove and re-create
        await rm(linkPath);
      }

      await symlink(target, linkPath, "dir");
      symlinks.push(`${linkPath} → ${target}`);

      return ok(symlinks);
    } catch (e) {
      return err(
        new Error(`Failed to link system/: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  /**
   * Copy user templates from defaults/user/ to shakaHome/user/.
   * Copies each file individually. Never overwrites existing files.
   * This means new templates added in future versions get deployed
   * to existing installations.
   */
  async copyUserTemplates(): Promise<Result<string[], Error>> {
    const files: string[] = [];
    const sourceDir = `${this.defaultsPath}/user`;
    const targetDir = `${this.shakaHome}/user`;

    try {
      let entries: string[];
      try {
        entries = await readdir(sourceDir);
      } catch {
        // No user templates in defaults — that's fine
        return ok(files);
      }

      for (const entry of entries) {
        const targetPath = `${targetDir}/${entry}`;
        if (await Bun.file(targetPath).exists()) {
          continue; // Don't overwrite existing user files
        }

        const sourceFile = Bun.file(`${sourceDir}/${entry}`);
        if (await sourceFile.exists()) {
          const content = await sourceFile.text();
          await Bun.write(targetPath, content);
          files.push(targetPath);
        }
      }

      return ok(files);
    } catch (e) {
      return err(
        new Error(`Failed to copy user templates: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  /**
   * Copy default config.json if it doesn't exist.
   * Never overwrites existing config.
   */
  async copyDefaultConfig(): Promise<Result<string[], Error>> {
    const files: string[] = [];
    const configPath = `${this.shakaHome}/config.json`;

    if (!(await Bun.file(configPath).exists())) {
      const defaultConfigPath = `${this.defaultsPath}/config.json`;
      const defaultConfig = Bun.file(defaultConfigPath);

      if (!(await defaultConfig.exists())) {
        return err(new Error(`Default config not found at ${defaultConfigPath}`));
      }

      const content = await defaultConfig.text();
      await Bun.write(configPath, content);
      files.push(configPath);
    }

    return ok(files);
  }

  /**
   * Link the shaka library so hooks can `import from "shaka"`.
   *
   * Step 1: `bun link` from repo root — registers package globally
   * Step 2: `bun link shaka` from shakaHome — creates node_modules/shaka symlink
   */
  async linkLibrary(): Promise<Result<void, Error>> {
    // Step 1: Register globally
    const registerResult = await this.runBunLink(this.repoRoot, []);
    if (!registerResult.ok) return registerResult;

    // Step 2: Link at shakaHome
    const linkResult = await this.runBunLink(this.shakaHome, ["shaka"]);
    if (!linkResult.ok) return linkResult;

    return ok(undefined);
  }

  /**
   * Read the installed version from .shaka-version file.
   * Returns null if file doesn't exist or can't be read.
   */
  async readInstalledVersion(): Promise<string | null> {
    const versionPath = `${this.shakaHome}/.shaka-version`;
    const file = Bun.file(versionPath);

    if (!(await file.exists())) return null;

    try {
      return (await file.text()).trim();
    } catch {
      return null;
    }
  }

  /**
   * Write the current version to .shaka-version file.
   */
  async writeInstalledVersion(): Promise<Result<void, Error>> {
    try {
      const version = getCurrentVersion();
      await Bun.write(`${this.shakaHome}/.shaka-version`, `${version}\n`);
      return ok(undefined);
    } catch (e) {
      return err(
        new Error(`Failed to write version: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  /**
   * Determine which providers to install based on selection and detection.
   */
  private resolveProviders(
    selected: ProviderName[] | undefined,
    detected: DetectedProviders,
  ): ProviderName[] {
    if (selected && selected.length > 0) {
      return selected.filter((p) => detected[p]);
    }
    const all: ProviderName[] = [];
    if (detected.claude) all.push("claude");
    if (detected.opencode) all.push("opencode");
    return all;
  }

  /**
   * Run full initialization.
   */
  async init(options: InitOptions = {}): Promise<Result<InitResult, Error>> {
    const detected = await this.detectProviders();
    const currentVersion = getCurrentVersion();

    const toInstall = this.resolveProviders(options.providers, detected);

    if (toInstall.length === 0) {
      return err(new Error("No AI providers detected. Install Claude Code or opencode first."));
    }

    // 1. Create user-owned directories
    const directories = await this.createDirectories();
    if (!directories.ok) return directories;

    // 2. Symlink system/ → defaults/system
    const symlinks = await this.linkSystem();
    if (!symlinks.ok) return symlinks;

    // 3. Link library for import resolution
    const linkResult = await this.linkLibrary();
    if (!linkResult.ok) {
      return err(new Error(`Library link failed: ${linkResult.error.message}`));
    }

    // 4. Copy user templates (per-file, no overwrite)
    const userFiles = await this.copyUserTemplates();
    if (!userFiles.ok) return userFiles;

    // 5. Copy config.json (no overwrite)
    const configFiles = await this.copyDefaultConfig();
    if (!configFiles.ok) return configFiles;

    // 6. Write installed version (best-effort — non-critical)
    await this.writeInstalledVersion();

    const result: InitResult = {
      providers: {
        claude: {
          detected: detected.claude,
          installed: toInstall.includes("claude"),
        },
        opencode: {
          detected: detected.opencode,
          installed: toInstall.includes("opencode"),
        },
      },
      directories: directories.value,
      files: [...userFiles.value, ...configFiles.value],
      symlinks: symlinks.value,
      currentVersion,
    };

    return ok(result);
  }
}
