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
├── user/                     # YOUR data (portable, backed up)
│   ├── identity/             # Who you are, your goals
│   ├── preferences/          # Settings, defaults
│   └── memory/               # What Shaka learns about you
│
├── system/                   # Framework (replaceable on upgrade)
│   ├── hooks/                # Event-driven automation
│   ├── skills/               # Reusable playbooks
│   ├── tools/                # Deterministic operations
│   └── agents/               # Specialized personas
│
└── config.yaml               # Single configuration file
```

### Key Principle: Separation of Data

| Directory | Owner | Upgrades          | Backup |
| --------- | ----- | ----------------- | ------ |
| `user/`   | You   | Never touched     | Yes    |
| `system/` | Shaka | Replaced entirely | No     |

When Shaka upgrades, `system/` can be wiped and reinstalled. Your `user/` data is never modified by upgrades.

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

```typescript
// Example: tools/git-status.ts
export default tool({
  description: "Get current git repository status",
  args: {},
  async execute() {
    const status = await $`git status --porcelain`;
    return JSON.stringify({ files: parseGitStatus(status) });
  },
});
```

### Commands

Atomic, slash-invoked operations. A command does **one thing**: invoke tools, add a prompt, and let the model respond. Markdown with YAML frontmatter.

```markdown
---
name: commit
description: Create a git commit with AI-generated message
tools: [git_status, git_diff]
---

Use the `git_status` tool to see what changed, then generate a conventional commit message.
```

Commands are the primary user interface. Type `/commit` and it runs.

### Skills

Domain containers for complex workflows. A skill is a **folder** containing a `SKILL.md`, related commands, and supporting context. Skills handle multi-step tasks that go beyond a single command.

```text
skills/code-review/
├── SKILL.md              # Workflow definition and domain knowledge
├── commands/
│   └── review-file.md    # Skill-specific command
├── context/
│   └── security-rules.md # Reference material
└── tools/
    └── lint-diff.ts      # Skill-specific tool
```

```markdown
# SKILL.md

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
3. Check against `context/security-rules.md`
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

| Provider    | Integration Method                |
| ----------- | --------------------------------- |
| Claude Code | CLAUDE.md + hooks in `~/.claude/` |
| opencode    | Plugin in `.opencode/`            |

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

Security through explicit capability grants, not permission prompts.

```yaml
# config.yaml
security:
  tools:
    read: allow # Always allow file reading
    write: ask # Prompt before writing
    bash: deny # Never allow arbitrary bash
    network: allow # Allow network requests

  directories:
    allow:
      - ~/Projects
      - ~/.config/shaka
    deny:
      - ~/.ssh
      - ~/.aws
```

## Roadmap

### Phase 0: Foundation

- [ ] CLI scaffold (`shaka init`, `shaka doctor`)
- [ ] Core tools (git, file, search)
- [ ] Basic hooks (session.start, session.end)
- [ ] Claude Code integration (CLAUDE.md)

### Phase 1: Skills & Agents

- [ ] Skill system with YAML frontmatter
- [ ] Agent definitions with tool restrictions
- [ ] opencode plugin integration

### Phase 2: Memory

- [ ] Session summaries
- [ ] Vector search (sqlite-vec)
- [ ] Preference learning

### Phase 3: Polish

- [ ] TUI with rich interface
- [ ] Multi-channel support (optional)
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
