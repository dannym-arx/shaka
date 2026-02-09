/**
 * Memory Search Tool for MCP
 *
 * Exposes session memory search as an MCP tool so coding assistants
 * can look up past decisions, context, and work history.
 */

import { resolveShakaHome, searchMemory } from "shaka";

export default {
  name: "memory-search",
  description:
    "Search past session summaries for context, decisions, and work history. " +
    "Returns matching sessions with snippets.",

  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "Search query (case-insensitive substring match)",
      },
    },
    required: ["query"],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    if (!query) return "Error: query is required";

    const shakaHome = resolveShakaHome();
    const memoryDir = `${shakaHome}/memory`;
    const results = await searchMemory(query, memoryDir);

    if (results.length === 0) {
      return `No session memories found matching "${query}"`;
    }

    const formatted = results.map((r) => {
      const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
      return `### ${r.title}\n*${r.date}*${tags}\n\n${r.snippet}`;
    });

    return `Found ${results.length} matching session${results.length > 1 ? "s" : ""}:\n\n${formatted.join("\n\n---\n\n")}`;
  },
};
