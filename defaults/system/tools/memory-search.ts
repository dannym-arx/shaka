/**
 * Memory Search Tool for MCP
 *
 * Exposes memory search as an MCP tool so coding assistants
 * can look up past decisions, learnings, and work history.
 */

import { join } from "node:path";
import { type SearchFilter, resolveShakaHome, searchMemory } from "shaka";

export default {
  name: "memory-search",
  description:
    "Search past session summaries and learnings for context, decisions, and work history. " +
    "Returns matching sessions and learnings with snippets.",

  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "Search query (case-insensitive substring match)",
      },
      category: {
        type: "string" as const,
        description: "Filter learnings by category (correction/preference/pattern/fact)",
      },
      cwd: {
        type: "string" as const,
        description: "Filter by working directory (substring match)",
      },
      type: {
        type: "string" as const,
        enum: ["session", "learning"],
        description: "Filter by result type",
      },
    },
    required: ["query"],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    if (!query) return "Error: query is required";

    const filter: SearchFilter | undefined =
      args.category || args.cwd || args.type
        ? {
            category: args.category as string | undefined,
            cwd: args.cwd as string | undefined,
            type: args.type as "session" | "learning" | undefined,
          }
        : undefined;

    const shakaHome = resolveShakaHome();
    const memoryDir = join(shakaHome, "memory");
    const results = await searchMemory(query, memoryDir, filter);

    if (results.length === 0) {
      return `No session memories found matching "${query}"`;
    }

    const formatted = results.map((r) => {
      const typeLabel = r.type === "learning" ? "[learning]" : "[session]";
      const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
      return `### ${typeLabel} ${r.title}\n*${r.date}*${tags}\n\n${r.snippet}`;
    });

    return `Found ${results.length} matching result${results.length > 1 ? "s" : ""}:\n\n${formatted.join("\n\n---\n\n")}`;
  },
};
