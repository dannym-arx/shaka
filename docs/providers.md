# Provider Support

Shaka integrates with two AI coding assistants, treating both as first-class:

| Provider    | Tools                          | Hooks                      | Context    |
| ----------- | ------------------------------ | -------------------------- | ---------- |
| Claude Code | MCP server (`shaka mcp serve`) | Subprocess in `~/.claude/` | AGENTS.md  |
| opencode    | Native (`.opencode/tools/`)    | In-process plugin          | .opencode/ |

## Hook Abstraction

Claude Code and opencode have different hook mechanisms:

- **Claude Code**: Subprocess hooks — spawns a new process per event
- **opencode**: In-process plugins — runs within the same process

Shaka abstracts this: you write hook logic once in `system/hooks/`, and provider-specific adapters translate events automatically.

```text
┌─────────────────────────────────────────────────────────┐
│                    Shaka Hooks                          │
│         ~/.config/shaka/system/hooks/                   │
│  (SessionStart, PreToolUse, etc. — one implementation)  │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌─────────────────────┐      ┌─────────────────────┐
│ Claude Code Adapter │      │  opencode Adapter   │
│ ~/.claude/hooks/    │      │  .opencode/plugin   │
│ (subprocess shim)   │      │  (in-process shim)  │
└─────────────────────┘      └─────────────────────┘
```

### Event Mapping

Shaka uses canonical event names internally. Each provider maps them to its native format:

| Shaka Event     | Claude Code Event  | opencode Hook                        |
| --------------- | ------------------ | ------------------------------------ |
| `session.start` | `SessionStart`     | Plugin load (no direct equivalent)   |
| `prompt.submit` | `UserPromptSubmit` | `experimental.chat.system.transform` |
| `tool.before`   | `PreToolUse`       | `tool.execute.before`                |
| `tool.after`    | `PostToolUse`      | `tool.execute.after`                 |

### How Hooks Are Installed

**Claude Code:** `shaka init` registers hooks in `~/.claude/settings.json`. Each hook entry points to `bun run <hook-path>` as a subprocess command.

**opencode:** `shaka init` generates an in-process plugin file at `.opencode/plugin.ts` that imports and calls the same hook logic directly.

## Tool Integration

Tools use [opencode's format](https://opencode.ai/docs/custom-tools/) as the canonical definition. For Claude Code, Shaka runs an MCP server that exposes the same tools via JSON-RPC over stdio.

### Setup

```bash
# Claude Code: register the MCP server
claude mcp add shaka --transport stdio -- shaka mcp serve

# opencode: tools are symlinked automatically during init
# ~/.config/shaka/system/tools/ → .opencode/tools/
```

### MCP Server

The MCP server (`shaka mcp serve`) implements:

- `initialize` — Handshake with Claude Code
- `tools/list` — Enumerate available tools from `system/tools/`
- `tools/call` — Execute a tool and return results

Tools are discovered dynamically from the `system/tools/` directory (with `customizations/tools/` overrides).
