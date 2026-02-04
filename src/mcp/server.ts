/**
 * MCP Server implementation for Claude Code integration.
 * Handles JSON-RPC over stdio transport.
 */

import { discoverTools } from "./tool-discovery";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeResult,
  McpToolResult,
  McpToolsListResult,
  ToolDefinition,
} from "./types";

const MCP_VERSION = "2024-11-05";
const SERVER_NAME = "shaka";
const SERVER_VERSION = "0.1.0";

export class McpServer {
  private tools = new Map<string, ToolDefinition>();

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Discover and register tools from a directory.
   * All .ts files in the directory are treated as potential tools.
   */
  async loadToolsFromDirectory(toolsDir: string): Promise<number> {
    const tools = await discoverTools(toolsDir);
    for (const tool of tools) {
      this.registerTool(tool);
    }
    return tools.length;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params = {} } = request;

    // Notifications (no id) don't get responses
    if (id === undefined) {
      return null;
    }

    try {
      const result = await this.dispatch(method, params);
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      const err = error as { code?: number; message?: string };
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: err.code ?? -32603,
          message: err.message ?? "Internal error",
        },
      };
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handleInitialize();
      case "tools/list":
        return this.handleToolsList();
      case "tools/call":
        return this.handleToolsCall(params);
      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  }

  private handleInitialize(): McpInitializeResult {
    return {
      protocolVersion: MCP_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }

  private handleToolsList(): McpToolsListResult {
    const tools = [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { tools };
  }

  private async handleToolsCall(params: Record<string, unknown>): Promise<McpToolResult> {
    const name = params.name as string;
    const args = (params.arguments as Record<string, unknown>) ?? {};

    const tool = this.tools.get(name);
    if (!tool) {
      throw { code: -32602, message: `Unknown tool: ${name}` };
    }

    try {
      const text = await tool.execute(args);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }

  /**
   * Start the server, reading from stdin and writing to stdout.
   * This is the main entry point for Claude Code integration.
   */
  async serve(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of Bun.stdin.stream()) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete lines
      for (
        let newlineIndex = buffer.indexOf("\n");
        newlineIndex !== -1;
        newlineIndex = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as JsonRpcRequest;
          const response = await this.handleRequest(request);
          if (response) {
            console.log(JSON.stringify(response));
          }
        } catch {
          console.log(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }),
          );
        }
      }
    }
  }
}
