/**
 * Init service for `shaka init` command.
 * Creates directories, copies default files, detects providers.
 */

import { mkdir } from "node:fs/promises";
import { type Result, err, ok } from "../domain/result";
import { type DetectedProviders, detectInstalledProviders } from "./provider-detection";

// Resolve defaults directory relative to this module
const DEFAULT_DEFAULTS_PATH = new URL("../../defaults", import.meta.url).pathname;

export interface InitServiceConfig {
  shakaHome: string;
  /** Path to defaults directory (for testing) */
  defaultsPath?: string;
  /** Override provider detection (for testing) */
  detectProviders?: () => Promise<DetectedProviders>;
}

export interface InitOptions {
  provider?: "claude" | "opencode";
  force?: boolean;
}

export interface InitResult {
  providers: {
    claude: { detected: boolean; installed: boolean };
    opencode: { detected: boolean; installed: boolean };
  };
  directories: string[];
  files: string[];
}

export class InitService {
  private readonly shakaHome: string;
  private readonly defaultsPath: string;
  private readonly detectProviders: () => Promise<DetectedProviders>;

  constructor(config: InitServiceConfig) {
    this.shakaHome = config.shakaHome;
    this.defaultsPath = config.defaultsPath ?? DEFAULT_DEFAULTS_PATH;
    this.detectProviders = config.detectProviders ?? detectInstalledProviders;
  }

  /**
   * Create all required directories.
   */
  async createDirectories(): Promise<Result<string[], Error>> {
    const directories = [
      this.shakaHome,
      `${this.shakaHome}/user`,
      `${this.shakaHome}/system`,
      `${this.shakaHome}/system/hooks`,
      `${this.shakaHome}/system/tools`,
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
   * Copy default configuration files from defaults/ directory.
   * Does not overwrite existing files.
   */
  async copyDefaultFiles(): Promise<Result<string[], Error>> {
    const files: string[] = [];

    // Copy config.json from defaults
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
   * Run full initialization.
   */
  async init(options: InitOptions = {}): Promise<Result<InitResult, Error>> {
    const detected = await this.detectProviders();

    // Determine which providers to install
    const toInstall: Array<"claude" | "opencode"> = [];

    if (options.provider) {
      // User specified a provider
      if (!detected[options.provider]) {
        return err(new Error(`Provider '${options.provider}' is not installed`));
      }
      toInstall.push(options.provider);
    } else {
      // Auto-detect
      if (detected.claude) toInstall.push("claude");
      if (detected.opencode) toInstall.push("opencode");
    }

    if (toInstall.length === 0) {
      return err(new Error("No AI providers detected. Install Claude Code or opencode first."));
    }

    // Create directories
    const directories = await this.createDirectories();
    if (!directories.ok) return directories;

    // Copy default files
    const files = await this.copyDefaultFiles();
    if (!files.ok) return files;

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
      files: files.value,
    };

    return ok(result);
  }
}
