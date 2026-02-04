/**
 * CLI handler for `shaka mcp` commands.
 * Provides MCP server functionality for Claude Code integration.
 *
 * The MCP server is a thin availability layer - it discovers and exposes
 * tools from directories, but does not contain tool implementations itself.
 */

import { Command } from "commander";
import { resolveShakaHome } from "../domain/config";
import { McpServer } from "../mcp/server";
import { discoverToolsWithOverrides } from "../mcp/tool-discovery";

function createServeCommand(): Command {
  return new Command("serve")
    .description("Start MCP server for Claude Code integration (stdio transport)")
    .option("--tools-dir <dir>", "Additional tools directory to load")
    .action(async (options) => {
      const server = new McpServer();
      const shakaHome = resolveShakaHome();

      // Discover tools from system/tools and customizations/tools
      // Customization tools override system tools on name collision
      const systemToolsDir = `${shakaHome}/system/tools`;
      const customToolsDir = `${shakaHome}/customizations/tools`;

      const tools = await discoverToolsWithOverrides(systemToolsDir, customToolsDir);
      for (const tool of tools) {
        server.registerTool(tool);
      }

      if (tools.length > 0) {
        console.error(`[MCP] Loaded ${tools.length} tools (system + customizations)`);
      }

      // Load from additional directory if specified (these override everything)
      if (options.toolsDir) {
        const additionalCount = await server.loadToolsFromDirectory(options.toolsDir);
        if (additionalCount > 0) {
          console.error(
            `[MCP] Loaded ${additionalCount} additional tools from ${options.toolsDir}`,
          );
        }
      }

      // Start serving
      await server.serve();
    });
}

export function createMcpCommand(): Command {
  return new Command("mcp").description("MCP server commands").addCommand(createServeCommand());
}
