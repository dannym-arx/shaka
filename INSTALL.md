# Installing Shaka

Get Shaka running in under 5 minutes.

## Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- At least one AI coding assistant:
  - [Claude Code](https://claude.ai/download) (`claude` CLI)
  - [opencode](https://opencode.ai/) (`opencode` CLI)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/shaka.git
cd shaka

# Install dependencies
bun install

# Initialize Shaka
bun run src/index.ts init

# Verify installation
bun run src/index.ts doctor
```

## What `shaka init` Does

1. **Creates directories** at `~/.config/shaka/`:

   - `user/` — Your personal context files
   - `system/` — Framework defaults (hooks, tools, reasoning)
   - `customizations/` — Your overrides (survives upgrades)
   - `memory/` — Session data (created as needed)

2. **Detects providers** (Claude Code, opencode)

3. **Installs hooks** for detected providers:
   - Claude Code: Adds entries to `~/.claude/settings.json`
   - opencode: Creates plugin at `.opencode/plugins/shaka.ts`

## Verifying Installation

Run the doctor command to check everything is working:

```bash
bun run src/index.ts doctor
```

Expected output:

```text
Shaka Doctor

Checking system health...

Shaka home: /Users/you/.config/shaka
  ✓ config.json exists

Provider status:

  claude:
    CLI installed: ✓ yes
    Hooks configured: ✓ yes

  opencode:
    CLI installed: ✓ yes
    Hooks configured: ✓ yes

────────────────────────────────────────
✅ All systems operational.
```

## Configuration

Edit `~/.config/shaka/config.json` to customize:

```json
{
  "identity": {
    "principal": { "name": "Your Name" },
    "assistant": { "name": "Shaka" }
  },
  "contextFiles": [
    "user/about-me.md",
    "user/goals.md",
    "system/base-reasoning-framework.md"
  ]
}
```

### Context Files

Files listed in `contextFiles` are loaded at session start. Common patterns:

| File                                 | Purpose                      |
| ------------------------------------ | ---------------------------- |
| `user/about-me.md`                   | Who you are, your background |
| `user/goals.md`                      | Current objectives           |
| `user/tech-stack.md`                 | Your preferred technologies  |
| `system/base-reasoning-framework.md` | The 7-phase reasoning system |

## Customization

Override any system file by copying it to `customizations/`:

```bash
# Customize the reasoning framework
cp ~/.config/shaka/system/base-reasoning-framework.md \
   ~/.config/shaka/customizations/base-reasoning-framework.md

# Edit your version
$EDITOR ~/.config/shaka/customizations/base-reasoning-framework.md
```

Files in `customizations/` take precedence over `system/`.

## Upgrading

When upgrading Shaka:

```bash
cd shaka
git pull
bun install
bun run src/index.ts init --force
```

The `--force` flag updates `system/` files. Your `user/`, `customizations/`, and `memory/` directories are preserved.

## Troubleshooting

### "Hooks not configured"

Run `shaka init` to install hooks:

```bash
bun run src/index.ts init
```

### "config.json not found"

Run `shaka init` to create the directory structure:

```bash
bun run src/index.ts init
```

### Provider not detected

Ensure the CLI is in your PATH:

```bash
# Claude Code
which claude

# opencode
which opencode
```

### Hooks not firing

Check the provider-specific configuration:

```bash
# Claude Code - check settings.json
cat ~/.claude/settings.json | grep -A 10 hooks

# opencode - check plugins directory
ls -la .opencode/plugins/
```

## Uninstalling

```bash
# Remove hooks from providers
# Claude Code: Remove shaka entries from ~/.claude/settings.json
# opencode: Delete .opencode/plugins/shaka.ts

# Remove Shaka configuration (optional - preserves your user/ data)
rm -rf ~/.config/shaka/system

# Remove everything (warning: deletes your customizations and memory)
rm -rf ~/.config/shaka
```

## Next Steps

- Edit `~/.config/shaka/user/about-me.md` to tell Shaka about yourself
- Run `claude` or `opencode` and see the context injection in action
- Explore `~/.config/shaka/system/` to understand available hooks and tools
