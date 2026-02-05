# Architecture Decisions

Decisions made during Shaka's development, capturing rationale and trade-offs.

---

## ADR-001: External Templates over Embedded Strings

**Status:** Accepted

**Context:** Should template content (config, hooks, reasoning framework) be embedded as string literals in TypeScript, or kept as external files?

**Decision:** Use external files in `defaults/` directory, deployed during `shaka init`.

**Rationale:**

| Factor          | Embedded Strings          | External Files      |
| --------------- | ------------------------- | -------------------- |
| Maintainability | Edit TypeScript to change | Edit files directly  |
| Editor support  | No syntax highlighting    | Full highlighting    |
| Version control | Noisy diffs               | Clean diffs          |
| Testing         | Hard to test content      | File existence tests |

**Consequences:** `shaka init` must deploy files from `defaults/`. Template changes don't require code changes.

---

## ADR-005: Source Directory Structure

**Status:** Accepted

**Context:** How should `src/` be organized?

**Decision:** Flat four-layer structure:

```
src/
├── domain/      # Pure types and functions (no I/O)
├── services/    # Business logic with Bun I/O
├── providers/   # Claude Code / opencode abstraction
└── commands/    # CLI handlers
```

**Rationale:** Premature separation adds complexity. The domain layer stays pure (no Bun imports), services use Bun APIs directly (no `FileSystemPort` abstraction), and providers are the only port interface. Refactor into deeper structure only when it earns its complexity.

**Consequences:** Simple to navigate. May need splitting if Phase 1+ adds significant infrastructure.

---

## ADR-006: Two-Tier Override Pattern

**Status:** Accepted

**Context:** How should users customize framework behavior without editing framework files?

**Decision:** Resolution order: `customizations/` -> `system/`

A file at `customizations/base-reasoning-framework.md` replaces `system/base-reasoning-framework.md`. Same pattern applies to hooks, tools, and any other system file.

**Rationale:** Matches PAI's SYSTEM/USER pattern. `system/` is framework-owned and replaced on upgrade. `customizations/` is user-owned and never touched by upgrades. Clear ownership boundaries.

**Consequences:** All file loading must check `customizations/` first. Users can fully customize without editing system files.

---

## ADR-008: Dependencies at Root Level

**Status:** Accepted

**Context:** Runtime dependencies (`eta`, `yaml`) were initially installed in `defaults/system/node_modules/`. This meant `defaults/` contained megabytes of packages that would need to be copied on every init.

**Decision:** Move all dependencies to the root `package.json`. No `package.json` or `node_modules/` inside `defaults/`.

**Rationale:** `defaults/` should be pure content (markdown, TypeScript source, YAML config). It gets symlinked to `~/.config/shaka/system/` -- having `node_modules` there conflates content with installed packages. The root `package.json` handles all dependencies, and `bun link` makes them available to hooks at runtime.

**Consequences:** Clean `defaults/` directory. Hooks resolve imports via `bun link shaka` (handled automatically by `shaka init`).

---

## ADR-009: Runtime Libraries in defaults/

**Status:** Accepted

**Context:** Hooks need shared code (e.g., `inference.ts`) at runtime. Should this live in `src/` or `defaults/`?

**Decision:** Runtime libraries used by hooks live in `defaults/system/tools/`, not `src/`.

**Rationale:** The key distinction is **CLI code vs deployed runtime**:

- `src/` = CLI tool code (`init`, `doctor`, `update`) -- NOT deployed to `~/.config/shaka/`
- `defaults/` = content that gets symlinked to `~/.config/shaka/system/` -- must be self-contained

Since hooks run at `~/.config/shaka/` (not in the repo), any code they import must travel with them. Putting `inference.ts` in `src/` would break hooks because `src/` isn't deployed.

**Consequences:** `inference.ts` lives at `defaults/system/tools/inference.ts`. Hooks import via relative path or the `shaka` package name (resolved by `bun link`).
