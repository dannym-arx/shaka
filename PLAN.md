# PR #3 Comment Resolution Plan

## 1) Comment collection status

- Tried to run `pr-comments help` as requested.
- Result: command not available in this environment (`command not found: pr-comments`).
- Fallback used: `gh api graphql` against PR `#3` (`jgmontoya/shaka`) to pull all review threads/comments.
- Pulled set:
  - 17 review threads (GitHub shows all 17 as unresolved)
  - 3 top-level issue comments (non-actionable; bot trigger/status)
  - 3 review events (`CHANGES_REQUESTED` + comments)

## 2) Thread-by-thread audit (resolved vs unresolved in code)

Legend:
- **Resolved in code**: code already addresses the concern; thread just needs manual resolve/reply.
- **Needs code change**: still open technically, should be fixed in follow-up commits.
- **Partial**: concern partly addressed; still needs a small fix.

| # | Location | Reviewer | Audit status | Why |
|---|---|---|---|---|
| 1 | `README.md` | jgmontoya | **Needs code change** | Docs still show `--force`/`--safe-only` while CLI uses `--yolo` (`README.md:388`, `src/commands/skill.ts:37`). |
| 2 | `src/services/skill-source/index.ts` | jgmontoya | **Resolved in code** | Module side effects removed; providers now lazily registered via `registerDefaultProviders()` from entrypoint (`src/services/skill-source/index.ts:19`, `src/index.ts:198`). |
| 3 | `src/services/skill-update-service.ts` | jgmontoya | **Resolved in code** | Update path now validates and runs security checks (warn-only) before deploy (`src/services/skill-update-service.ts:72-83`). |
| 4 | `src/services/skill-update-service.ts` | jgmontoya | **Resolved in code** | `updateAllSkills` now aggregates successes + failures (`src/services/skill-update-service.ts:119-132`, `src/commands/skill.ts:136-146`). |
| 5 | `src/services/skill-source/github.ts` | jgmontoya | **Resolved in code** | `resolveLatestVersion` dead-code concern no longer applies (method not present in provider interface/impl now). |
| 6 | `src/services/skill-source/github.ts` | jgmontoya | **Resolved in code** | Style nit (`.then` vs `await`) no longer present in current implementation. |
| 7 | `src/services/skill-install-service.ts` | jgmontoya | **Resolved in code** | Security checks were refactored to single-pass file collection/reads (`src/services/skill-install-service.ts:169-216`). |
| 8 | `src/services/skill-install-service.ts` | jgmontoya | **Resolved in code** | `\u200C`/`\u200D` excluded from invisible-char regex, with explanatory note (`src/services/skill-install-service.ts:159-163`). |
| 9 | `src/commands/skill.ts` | jgmontoya | **Partial** | Timeout now aborts (`"n"`), but stdin resume is still missing (`src/commands/skill.ts:223-234`). |
| 10 | `src/services/skill-install-service.ts` | jgmontoya | **Resolved in code** | Uses stdlib `path.extname` import (`src/services/skill-install-service.ts:9`). |
| 11 | `src/services/skill-pipeline.ts` | jgmontoya | **Needs code change** | Frontmatter parsing still hand-rolled/fragile; should use YAML parser (`src/services/skill-pipeline.ts:88-103`). |
| 12 | `src/services/skill-source/clawdhub.ts` | jgmontoya | **Needs code change** | Naming still uses `clawdhub` across provider/type names; request is `clawhub` user-facing naming. |
| 13 | `src/commands/skill.ts` | coderabbitai | **Needs code change** | Same stdin concern as #9: add `process.stdin.resume()` before waiting for input. |
| 14 | `src/services/skill-install-service.ts` | coderabbitai | **Needs code change** | Install flow can throw/partially install; lacks atomic rollback + strict `Result` contract (`src/services/skill-install-service.ts:117-127`). |
| 15 | `src/services/skill-install-service.ts` | coderabbitai | **Needs code change** | Extensionless files currently classified as safe (`ext === ""`) and can hide executables (`src/services/skill-install-service.ts:143`). |
| 16 | `src/services/skill-install-service.ts` | coderabbitai | **Needs code change** | `loadManifest` failure is ignored in collision check (possible partial install path) (`src/services/skill-install-service.ts:267-269`). |
| 17 | `src/services/skill-source/clawdhub.ts` | coderabbitai | **Needs code change** | ZIP extraction uses `unzip`, which is not reliably available on native Windows (`src/services/skill-source/clawdhub.ts:131`). |

## 3) Proposed fix sequence (subsequent commits)

### Commit A — `fix(skill-cli): align docs and harden interactive install prompt`

Scope:
- Fix README install flags/examples to match CLI (`--yolo`, remove stale `--force`/`--safe-only` examples).
- Add `process.stdin.resume()` in `readLine()`.
- Keep timeout behavior as explicit abort (`"n"`).

Comments addressed:
- #1, #9, #13

Verification:
- `bun test test/unit/services/skill-update-service.test.ts`
- `bun test` (quick confidence pass if no command tests are added)

---

### Commit B — `fix(skills/install): make install atomic and propagate failures`

Scope:
- In install flow, wrap deploy/link/persist steps and convert thrown exceptions into `err(...)` results.
- Add rollback on deploy/link/persist failure (remove copied skill dir; best-effort unlink provider links).
- Propagate manifest read failure in `checkNameCollision` instead of ignoring it.
- Reclassify extensionless files: safe only via basename allowlist; otherwise `unknown`.

Comments addressed:
- #14, #15, #16

Verification:
- `bun test test/unit/services/skill-install-service.test.ts`
- `bun test test/unit/services/skill-update-service.test.ts`

---

### Commit C — `fix(skills/pipeline): parse SKILL frontmatter with YAML`

Scope:
- Replace hand-rolled `parseFrontmatter` with YAML parsing (already in deps).
- Keep validation strict for required `name` while tolerating richer YAML syntax.

Comments addressed:
- #11

Verification:
- `bun test test/unit/services/skill-install-service.test.ts`

---

### Commit D — `fix(skills/source): clawhub naming + cross-platform zip extraction`

Scope:
- Rename user-facing wording from `clawdhub` to `clawhub`.
- Keep backward compatibility:
  - accept legacy `--clawdhub` as alias (or map old name internally),
  - support old manifest provider value during update flows.
- Replace hard dependency on `unzip` with platform-aware extraction:
  - Windows: PowerShell `Expand-Archive`
  - Unix-like: existing `unzip` path (with clear error if missing)

Comments addressed:
- #12, #17

Verification:
- `bun test test/unit/services/skill-source/clawdhub.test.ts`
- `bun test test/unit/services/skill-source/github.test.ts`

---

### Commit E — `fix(cli): remove duplicate command registrations`

Scope:
- Remove duplicated `program.addCommand(...)` entries introduced during rebase conflict resolution (`src/index.ts:211-217` currently repeated).

Note:
- Not a PR comment, but needed for branch cleanliness and to avoid duplicate CLI registration behavior.

Verification:
- `bun test`

## 4) Parallelization plan (execution waves)

### Wave 1 (can run in parallel)

- **Lane A (high risk):** Commit B (`skill-install-service` atomicity/rollback/manifest propagation/extensionless policy)
- **Lane B (medium risk):** Commit C (`skill-pipeline` YAML frontmatter parsing)
- **Lane C (low risk):** Commit E (`src/index.ts` duplicate command registration cleanup)

Why parallel-safe:
- Lane A and Lane B touch different service files (`skill-install-service` vs `skill-pipeline`) with minimal overlap.
- Lane C only touches CLI wiring in `src/index.ts`, independent of skill service internals.

Wave-1 merge strategy:
1. Land Lane C first (lowest conflict surface).
2. Land Lane B second.
3. Rebase Lane A on top (most likely to need minor conflict resolution if parser/validation contracts shift).

### Wave 2 (sequential)

- **Commit A** then **Commit D**.

Why sequential:
- Both likely touch `src/commands/skill.ts` and `README.md` (flag naming/help text), so parallel work would create avoidable conflicts.

### Verification parallelization

- During Wave 1: run focused suites per lane.
  - Lane A: `bun test test/unit/services/skill-install-service.test.ts test/unit/services/skill-update-service.test.ts`
  - Lane B: `bun test test/unit/services/skill-install-service.test.ts`
  - Lane C: `bun test`
- After each wave merge: run `bun test` once as integration gate.

## 5) WIP commit removal plan

Current top commit is `70740bd wip`.

After commits A–E are done and green:

1. Interactive rebase from `origin/master`.
2. Fold `70740bd wip` into the appropriate fix commit (or split + squash) so no `wip` commit remains.
3. Ensure final history has descriptive commit messages only.
4. Re-run full suite: `bun test`.
5. Push with lease: `git push --force-with-lease`.

## 6) Thread closure protocol after code lands

- For already-resolved threads (#2, #3, #4, #5, #6, #7, #8, #10): reply with file+line evidence, then resolve in GitHub.
- For newly fixed threads (#1, #9, #11, #12, #13, #14, #15, #16, #17): reply with commit SHA + test evidence, then resolve.
- Final check: no unresolved review threads before merge.
