import { describe, expect, test } from "bun:test";
import { McpServer } from "../../../src/mcp/server";
import type { JsonRpcRequest, ToolDefinition } from "../../../src/mcp/types";

describe("McpServer", () => {
  describe("handleRequest", () => {
    test("returns null for notifications (no id)", async () => {
      const server = new McpServer();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      };

      const response = await server.handleRequest(request);
      expect(response).toBeNull();
    });

    test("responds to initialize with protocol version and capabilities", async () => {
      const server = new McpServer();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      };

      const response = await server.handleRequest(request);

      expect(response).not.toBeNull();
      expect(response?.id).toBe(1);
      expect(response?.error).toBeUndefined();
      expect(response?.result).toMatchObject({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "shaka", version: "0.1.0" },
      });
    });

    test("returns empty tools list when no tools registered", async () => {
      const server = new McpServer();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      };

      const response = await server.handleRequest(request);

      expect(response?.result).toMatchObject({ tools: [] });
    });

    test("returns registered tools in tools/list", async () => {
      const server = new McpServer();
      const testTool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "A message" },
          },
        },
        execute: async () => "test result",
      };

      server.registerTool(testTool);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      };

      const response = await server.handleRequest(request);
      const result = response?.result as { tools: Array<{ name: string }> };

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe("test-tool");
      expect(result.tools[0]).toMatchObject({
        name: "test-tool",
        description: "A test tool",
      });
    });

    test("returns error for unknown method", async () => {
      const server = new McpServer();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 4,
        method: "unknown/method",
      };

      const response = await server.handleRequest(request);

      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32601);
      expect(response?.error?.message).toContain("Method not found");
    });
  });

  describe("tools/call", () => {
    test("executes registered tool and returns result", async () => {
      const server = new McpServer();
      const testTool: ToolDefinition = {
        name: "echo",
        description: "Echo the input",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
        execute: async (args) => `Echo: ${args.message}`,
      };

      server.registerTool(testTool);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: { message: "hello" },
        },
      };

      const response = await server.handleRequest(request);
      const result = response?.result as { content: Array<{ text: string }> };

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe("Echo: hello");
    });

    test("returns error for unknown tool", async () => {
      const server = new McpServer();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "nonexistent",
          arguments: {},
        },
      };

      const response = await server.handleRequest(request);

      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Unknown tool");
    });

    test("handles tool execution errors gracefully", async () => {
      const server = new McpServer();
      const failingTool: ToolDefinition = {
        name: "failing-tool",
        description: "A tool that always fails",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          throw new Error("Intentional failure");
        },
      };

      server.registerTool(failingTool);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "failing-tool",
          arguments: {},
        },
      };

      const response = await server.handleRequest(request);
      const result = response?.result as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Intentional failure");
    });
  });

  describe("registerTool", () => {
    test("allows registering multiple tools", async () => {
      const server = new McpServer();

      server.registerTool({
        name: "tool-a",
        description: "Tool A",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "A",
      });

      server.registerTool({
        name: "tool-b",
        description: "Tool B",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "B",
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/list",
      };

      const response = await server.handleRequest(request);
      const result = response?.result as { tools: Array<{ name: string }> };

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
    });

    test("overwrites tool with same name", async () => {
      const server = new McpServer();

      server.registerTool({
        name: "dupe",
        description: "First version",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "first",
      });

      server.registerTool({
        name: "dupe",
        description: "Second version",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "second",
      });

      const listRequest: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/list",
      };

      const listResponse = await server.handleRequest(listRequest);
      const listResult = listResponse?.result as { tools: Array<{ description: string }> };
      expect(listResult.tools).toHaveLength(1);
      expect(listResult.tools[0]?.description).toBe("Second version");

      const callRequest: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "dupe", arguments: {} },
      };

      const callResponse = await server.handleRequest(callRequest);
      const callResult = callResponse?.result as { content: Array<{ text: string }> };
      expect(callResult.content[0]?.text).toBe("second");
    });
  });
});
