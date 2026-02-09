/**
 * CLI handler for `shaka memory` command.
 * Search and list session summaries.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { searchMemory } from "../memory/search";
import { listSummaries } from "../memory/storage";

export function createMemoryCommand(): Command {
  const memory = new Command("memory").description("Search and browse session memory");

  memory
    .command("search <query>")
    .description("Search session summaries for a query")
    .action(async (query: string) => {
      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });
      const memoryDir = `${shakaHome}/memory`;

      const results = await searchMemory(query, memoryDir);

      if (results.length === 0) {
        console.log(`No results for "${query}"`);
        return;
      }

      console.log(
        `Found ${results.length} result${results.length > 1 ? "s" : ""} for "${query}":\n`,
      );

      for (const result of results) {
        console.log(`  ${result.date}  ${result.title}`);
        if (result.tags.length > 0) {
          console.log(`           tags: ${result.tags.join(", ")}`);
        }
        console.log(`           ${result.snippet}`);
        console.log();
      }
    });

  memory
    .command("list")
    .description("List recent session summaries")
    .option("-n, --limit <count>", "Number of summaries to show", "10")
    .action(async (options: { limit: string }) => {
      const shakaHome = resolveShakaHome({
        SHAKA_HOME: process.env.SHAKA_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        HOME: process.env.HOME,
      });
      const memoryDir = `${shakaHome}/memory`;

      const summaries = await listSummaries(memoryDir);

      if (summaries.length === 0) {
        console.log("No session summaries found.");
        return;
      }

      const limit = Math.min(Number.parseInt(options.limit, 10) || 10, summaries.length);
      const shown = summaries.slice(0, limit);

      console.log(
        `${summaries.length} session${summaries.length > 1 ? "s" : ""} total, showing ${shown.length}:\n`,
      );

      for (const s of shown) {
        console.log(`  ${s.date}  ${s.title}`);
        if (s.tags.length > 0) {
          console.log(`           tags: ${s.tags.join(", ")}`);
        }
        console.log(`           ${s.provider} | ${s.cwd}`);
        console.log();
      }
    });

  return memory;
}
