/**
 * CLI handler for `shaka update` command.
 *
 * Safe upgrade path using git tags as release points.
 * Checks latest tag BEFORE changing any files. Warns on major version bumps.
 *
 * Flow: git fetch --tags → find latest vX.Y.Z tag → compare → confirm if major
 *       → git checkout <tag> → bun install → shaka init
 */

import { createInterface } from "node:readline";
import { Command } from "commander";
import { findLatestTag, getCurrentVersion, isMajorUpgrade, parseSemver } from "../domain/version";

interface UpdateInfo {
  localVersion: string;
  latestTag: string | null;
  latestVersion: string | null;
  isMajor: boolean;
}

async function run(args: string[], cwd: string): Promise<{ stdout: string; ok: boolean }> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { stdout: stdout.trim(), ok: exitCode === 0 };
}

async function getRepoRoot(): Promise<string | null> {
  const { stdout, ok } = await run(["git", "rev-parse", "--show-toplevel"], ".");
  return ok ? stdout : null;
}

async function checkForUpdate(repoRoot: string): Promise<UpdateInfo> {
  const localVersion = getCurrentVersion();

  // Fetch tags from remote
  const fetchResult = await run(["git", "fetch", "--tags"], repoRoot);
  if (!fetchResult.ok) {
    return { localVersion, latestTag: null, latestVersion: null, isMajor: false };
  }

  const latestTag = await findLatestTag(repoRoot);
  if (!latestTag) {
    return { localVersion, latestTag: null, latestVersion: null, isMajor: false };
  }

  const latestVersion = latestTag.startsWith("v") ? latestTag.slice(1) : latestTag;

  return {
    localVersion,
    latestTag,
    latestVersion,
    isMajor: isMajorUpgrade(localVersion, latestVersion),
  };
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function confirmMajorUpgrade(info: UpdateInfo): Promise<boolean> {
  const remoteVer = parseSemver(info.latestVersion ?? "");
  const localVer = parseSemver(info.localVersion);
  const majorLabel = localVer && remoteVer ? `${localVer.major}.x → ${remoteVer.major}.x` : "";

  console.log(`⚠️  Major version upgrade (${majorLabel})`);
  console.log("   system/ will be updated. user/, memory/, and customizations/ are preserved.");
  console.log("   Review the changelog before upgrading.\n");

  const ok = await confirm("   Continue? [y/N] ");
  if (!ok) {
    console.log("\nUpgrade cancelled. Your installation is unchanged.");
  }
  return ok;
}

async function checkoutAndInit(repoRoot: string, tag: string): Promise<boolean> {
  console.log(`Checking out ${tag}...`);
  const checkoutResult = await run(["git", "checkout", tag], repoRoot);
  if (!checkoutResult.ok) {
    console.error("ERROR: git checkout failed. Stash or commit local changes first.");
    return false;
  }

  console.log("Installing dependencies...");
  const installResult = await run(["bun", "install"], repoRoot);
  if (!installResult.ok) {
    console.error("ERROR: bun install failed.");
    return false;
  }

  console.log("Re-initializing...\n");
  const { createInitCommand } = await import("./init");
  const initCmd = createInitCommand();
  await initCmd.parseAsync(["node", "shaka", "init", "--all"], { from: "user" });
  return true;
}

export function createUpdateCommand(): Command {
  return new Command("update")
    .description("Update Shaka to the latest stable release")
    .option("--force", "Skip major version confirmation")
    .action(async (options) => {
      const repoRoot = await getRepoRoot();
      if (!repoRoot) {
        console.error("ERROR: Not in a git repository. Run this from the shaka directory.");
        process.exit(1);
      }

      console.log("Checking for updates...\n");
      const info = await checkForUpdate(repoRoot);

      if (!info.latestTag || !info.latestVersion) {
        console.error("ERROR: No release tags found. Check your git remote.");
        process.exit(1);
      }

      if (info.localVersion === info.latestVersion) {
        console.log(`Already up to date (v${info.localVersion}).`);
        return;
      }

      console.log(`  Current: v${info.localVersion}`);
      console.log(`  Latest:  v${info.latestVersion} (${info.latestTag})\n`);

      if (info.isMajor && !options.force) {
        const confirmed = await confirmMajorUpgrade(info);
        if (!confirmed) return;
        console.log();
      }

      const success = await checkoutAndInit(repoRoot, info.latestTag);
      if (!success) process.exit(1);

      console.log(`\n✅ Shaka updated: v${info.localVersion} → v${info.latestVersion}`);
    });
}
