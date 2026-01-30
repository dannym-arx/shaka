# Shaka

A personal AI assistant framework. Provider-agnostic. Clear architecture. Your data stays yours.

## Philosophy

Inspired by [PAI](https://github.com/danielmiessler/Personal_AI_Infrastructure), [Ren](https://github.com/erskingardner/ren), and [moltbot](https://github.com/moltbot/moltbot), but with a focus on:

1. **Deterministic First** — Do as much as possible in code before involving the model
2. **Local First** — No telemetry, no required cloud services, works with local models
3. **Incremental** — Ship working software at each phase
4. **Extensible** — Easy to add tools, skills, and agents
5. **Clear Boundaries** — Templates vs user files are never confused

## Architecture

```text
~/.config/shaka/              # XDG-compliant, provider-agnostic
├── user/                     # YOUR content (flat, portable, backed up)
│   ├── identity.md           # Who you are
│   ├── preferences.md        # Your defaults
│   ├── beliefs.md            # What you believe
│   ├── missions.md           # High-level aspirations
│   ├── goals.md              # Specific objectives
│   ├── projects.md           # Current work
│   └── challenges.md         # Problems you're tackling
│
├── memory/                   # What Shaka LEARNS about you (dynamic)
│   └── ...                   # Session summaries, patterns, etc.
│
├── customizations/           # Your OVERRIDES for system/
│   └── base-reasoning-framework.md  # (example) Your reasoning variant
│
├── system/                   # Framework (replaceable on upgrade)
│   ├── base-reasoning-framework.md  # Default reasoning framework
│   ├── hooks/                # Event-driven automation
│   ├── skills/               # Reusable playbooks
│   ├── tools/                # Deterministic operations
│   └── agents/               # Specialized personas
│
└── config.yaml               # Single configuration file
```

### Key Principle: Separation of Concerns

| Directory         | Purpose                          | Owner | Upgrades          | Backup |
| ----------------- | -------------------------------- | ----- | ----------------- | ------ |
| `user/`           | Who you are (you write it)       | You   | Never touched     | Yes    |
| `memory/`         | What Shaka learns (Shaka writes) | Shaka | Never touched     | Yes    |
| `customizations/` | Your overrides for system/       | You   | Never touched     | Yes    |
| `system/`         | Framework defaults               | Shaka | Replaced entirely | No     |

When Shaka upgrades, `system/` can be wiped and reinstalled. Everything else is preserved.

### Customization via Override

Files in `customizations/` override their `system/` counterparts:

```text
customizations/base-reasoning-framework.md  →  overrides  →  system/base-reasoning-framework.md
customizations/tools/foo.ts                 →  overrides  →  system/tools/foo.ts
```

**Resolution order:** Customization → System default

This lets you tweak the reasoning framework, add hooks, or replace tools without modifying `system/`. Your customizations survive upgrades.

## Base Reasoning Framework

Shaka uses a structured reasoning framework inspired by [PAI's Algorithm](https://github.com/danielmiessler/TheAlgorithm). It's loaded at session start via the SessionStart hook.

**The 7 Phases:**

```text
OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN
```

**Key mechanism: Ideal State Criteria (ISC)**

Before acting, define what success looks like as testable criteria:

- Exactly 8 words (forces precision)
- Binary yes/no (testable in <2 seconds)
- State-based ("X is true" not "do X")

Plus **anti-criteria** — what must NOT happen.

**Example:**

```text
Criterion: "All authentication tests pass after fix applied"
Anti-criterion: "No credentials exposed in git commit history"
```

The AI verifies all criteria before claiming "done." This prevents the common failure of solving one problem while creating another.

**Configuration:**

```yaml
# config.yaml
reasoning:
  enabled: true # Load base reasoning framework at session start (default: true)
```

To customize: copy `system/base-reasoning-framework.md` to `customizations/base-reasoning-framework.md` and edit.

## Core Concepts

Shaka uses a **progressive abstraction model** where each layer builds on the previous:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILLS      │ Multi-step workflows, domain expertise                   │
│              │ Folder with SKILL.md + commands + context                │
│              │ e.g., code-review/, deployment/                          │
├──────────────┼──────────────────────────────────────────────────────────┤
│  COMMANDS    │ Single-purpose prompt + tool invocation                  │
│              │ Slash-invoked, atomic operations                         │
│              │ e.g., /commit, /diff, /lint                              │
├──────────────┼──────────────────────────────────────────────────────────┤
│  TOOLS       │ Deterministic TypeScript functions                       │
│              │ Pure code, no LLM involvement                            │
│              │ e.g., git-status.ts, file-read.ts                        │
└──────────────┴──────────────────────────────────────────────────────────┘
```

**Key distinctions:**

| Aspect     | Tools              | Commands                | Skills                      |
| ---------- | ------------------ | ----------------------- | --------------------------- |
| Purpose    | Execute code       | Single task             | Domain workflow             |
| Invocation | Called by commands | `/slash` by user        | Context or explicit         |
| Contains   | TypeScript         | Markdown + tool calls   | SKILL.md + commands + files |
| LLM        | Never              | Yes, for interpretation | Yes, orchestrates           |

A command can exist standalone (`/commit`) or as part of a skill (the `code-review` skill might use `/diff`, `/lint`, and custom analysis).

### Tools

Deterministic TypeScript functions that execute code, not prompts. Tools do the heavy lifting _before_ the LLM is involved.

Shaka adopts [opencode's tool format](https://opencode.ai/docs/custom-tools/) for consistency across providers. Tools are TypeScript files using the `tool()` helper:

```typescript
// Example: ~/.config/shaka/system/tools/git-status.ts
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Get current git repository status",
  args: {},
  async execute(args, context) {
    const output = await Bun.$`git status --porcelain`.text();
    return parseGitStatus(output);
  },
});
```

Tools are exposed to AI providers via:

- **opencode**: Symlinked to `.opencode/tools/` (native)
- **Claude Code**: Exposed via `shaka mcp serve` (MCP server)

### Commands

Atomic, slash-invoked operations. A command does **one thing**: invoke tools, add a prompt, and let the model respond. Markdown with YAML frontmatter.

```markdown
---
name: commit
description: Create a git commit with AI-generated message
---

Use the `git_status` tool to see what changed, then generate a conventional commit message.
```

Commands are the primary user interface. Type `/commit` and it runs.

### Skills

Domain containers for complex workflows. A skill is a **folder** with a `SKILL.md` and optional supporting files. Start flat; add structure only when needed.

```text
skills/code-review/
├── SKILL.md              # Workflow definition and domain knowledge
└── security-rules.md     # Optional supporting context
```

```markdown
---
name: code-review
description: Review code changes with security and quality checks
triggers:
  - user asks for code review
  - PR is opened (via hook)
---

## Workflow

1. Run `/diff` to see changes
2. Run `security_scan` tool for vulnerabilities
3. Check against `security-rules.md`
4. Synthesize findings into actionable feedback
```

Skills are invoked by context ("review this PR") or explicitly ("use the code-review skill").

### Agents

Specialized personas with restricted tool access. Safety through capability limitation.

```markdown
---
name: reviewer
description: Code review specialist (read-only)
tools:
  read: true
  write: false
  bash: false
---

You are a code reviewer. You analyze but never modify code.
```

### Hooks

Event-driven automation. TypeScript functions that run on specific events.

| Event              | Trigger                 |
| ------------------ | ----------------------- |
| `SessionStart`     | New conversation begins |
| `SessionEnd`       | Conversation ends       |
| `PreToolUse`       | Before a tool executes  |
| `PostToolUse`      | After a tool executes   |
| `UserPromptSubmit` | User sends a message    |
| `Stop`             | Session is terminated   |
| `SubagentStop`     | A sub-agent completes   |

### Memory

Persistent context that survives sessions. The exact architecture is intentionally TBD, but the approach combines:

- **Markdown files** — Human-readable, editable, version-controllable
- **Vector search** — Semantic retrieval for relevant context (likely sqlite-vec)

Inspiration: [PAI Memory System discussion](https://github.com/danielmiessler/Personal_AI_Infrastructure/discussions/527) proposes tiered memory with importance/stability scoring and intelligent decay. We'll iterate on what works.

## Provider Support

Shaka integrates with two AI coding assistants:

| Provider    | Tools                          | Hooks                      | Context    |
| ----------- | ------------------------------ | -------------------------- | ---------- |
| Claude Code | MCP server (`shaka mcp serve`) | Subprocess in `~/.claude/` | AGENTS.md  |
| opencode    | Native (`.opencode/tools/`)    | In-process plugin          | .opencode/ |

### Tool Integration

Tools use [opencode's format](https://opencode.ai/docs/custom-tools/) as the canonical definition. For Claude Code, Shaka runs an MCP server that exposes the same tools:

```bash
# For Claude Code: run the MCP server
claude mcp add shaka --transport stdio -- shaka mcp serve

# For opencode: tools are symlinked automatically
# ~/.config/shaka/system/tools/ → .opencode/tools/
```

### Hook Abstraction

Claude Code and opencode have different hook mechanisms:

- **Claude Code**: Subprocess hooks (spawns a new process per event)
- **opencode**: In-process plugins (runs within the same process)

Shaka abstracts this with a common event bus:

```text
┌─────────────────────────────────────────────────────────┐
│                    Shaka Event Bus                       │
│         ~/.config/shaka/system/hooks/                    │
│  (SessionStart, PreToolUse, etc. — one implementation)  │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌─────────────────────┐      ┌─────────────────────┐
│  Claude Code Adapter │      │  opencode Adapter   │
│  ~/.claude/hooks/    │      │  .opencode/plugin   │
│  (subprocess shim)   │      │  (in-process shim)  │
└─────────────────────┘      └─────────────────────┘
```

**How it works:**

1. You write hook handlers once in `~/.config/shaka/system/hooks/`
2. Thin adapters (~10 lines each) translate provider events to Shaka events
3. Same behavior regardless of which AI assistant you use

## Interfaces

### TUI (Primary)

```bash
shaka              # Launch interactive TUI
```

### CLI (Single-shot)

```bash
shaka run "summarize this file"
shaka skill list
shaka tool run git-status
shaka memory search "project architecture"
```

## Security Model

Security through explicit capability grants, not permission prompts. The detailed permission model is TBD, but the principle is: define what's allowed upfront rather than prompting at runtime.

```yaml
# config.yaml (Phase 1+)
security:
  directories:
    allow:
      - ~/Projects
      - ~/.config/shaka
    deny:
      - ~/.ssh
      - ~/.aws
```

For Phase 0, security relies on the underlying provider's permission system (Claude Code's tool permissions, opencode's sandbox).

## Roadmap

### Phase 0: Foundation

- [ ] CLI entry point (`shaka init`, `shaka doctor`)
- [ ] Directory structure (`~/.config/shaka/{user,system}`)
- [ ] One tool: `git-status` (proves the pattern)
- [ ] MCP server (`shaka mcp serve`) for Claude Code
- [ ] Event bus with SessionStart hook
- [ ] Claude Code adapter (subprocess shim)

### Phase 1: Skills & Commands

- [ ] Command system with YAML frontmatter
- [ ] Skill system (SKILL.md + context files)
- [ ] opencode hook adapter

### Phase 2: Agents & Memory

- [ ] Agent definitions with tool restrictions
- [ ] Session summaries (markdown)
- [ ] Vector search (sqlite-vec)

### Phase 3: Polish

- [ ] TUI with rich interface
- [ ] Preference learning
- [ ] Community skill repository

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run dev

# Run tests
bun test

# Build
bun run build
```

## Prior Art

This project learns from:

- **[PAI](https://github.com/danielmiessler/Personal_AI_Infrastructure)** — Hook system, skill patterns, memory architecture
- **[PAI-OpenCode](https://github.com/Steffen025/pai-opencode)** — PAI port to opencode, hooks→plugins conversion
- **[Ren](https://github.com/erskingardner/ren)** — Deterministic-first philosophy, clean directory structure
- **[moltbot](https://github.com/moltbot/moltbot)** — Gateway pattern, typed workflows, multi-channel approach
- **[opencode](https://github.com/anomalyco/opencode)** — Provider abstraction, plugin architecture

## License

MIT
