# United Agents MCP

> Stop telling Claude "you didn't finish." United Agents enforces complete task execution automatically.

## The Problem

You ask Claude Code to fix something. It touches one file, says "done." But the bug required changes in 4 connected files. You say "you didn't finish." Claude fixes another file, says "done." Still broken. You repeat this 3-5 times, burning tokens on every round.

This happens because Claude doesn't map the full dependency chain before starting — and declares success after the first file it touches.

## The Solution

United Agents is an MCP server that:

1. **Maps every connected file** before Claude starts (API routes, DB layers, components)
2. **Blocks premature "done"** — Claude cannot report completion until all files are addressed
3. **Forces autonomous continuation** — if incomplete, Claude keeps working without asking you

The correction loop stops. Tasks complete in one round.

## Install

```bash
npm install -g united-agents-mcp
```

## Setup (one time)

**Add to Claude Code:**
```bash
claude mcp add united-agents node $(which united-agents-mcp) --scope user
```

**Set up your project** (run once per project in Claude Code):
```
Use the setup_project tool with project_root "/your/project/path"
```

This writes a CLAUDE.md into your project with the enforcement rules. After this — you're done. The loop runs automatically on every task.

## How It Works

```
You give Claude a task
        ↓
Claude calls trace_dependencies → maps all connected files
        ↓
Claude works through every file in the map
        ↓
Claude calls verify_completeness before saying "done"
        ↓
🚫 INCOMPLETE → Claude continues automatically (no asking you)
        ↓
✅ COMPLETE → Claude reports done
        ↓
You never had to say "you didn't finish"
```

## Tools

### `trace_dependencies`
Maps every file connected to the one you want to change.

```
file: "LeadPipeline.tsx"
project_root: "/Users/you/your-project"
```

Returns:
- 🎯 Direct files — must change
- 🌐 API routes — called by the file
- 🗄️ DB layers — Supabase/Prisma connections
- 🔗 Connected imports — shared utilities

### `verify_completeness`
Checks git diff against the dependency map. If anything is missing — Claude continues automatically.

### `setup_project`
Writes CLAUDE.md enforcement rules into your project. Run once per project.

## Stack Support

Currently optimized for:
- Next.js + TypeScript
- Supabase
- Vercel deployments

More stacks coming soon.

## Real Example

**Before United Agents** — fixing a drag bug in KanbanPipeline.tsx:
- Round 1: Claude fixes component, says done. Bug persists.
- Round 2: Claude fixes event handler, says done. Bug persists.
- Round 3: Claude finds DB layer issue, says done. Bug persists.
- Round 4: Claude fixes RLS policy, says done. Finally works.
- **4 rounds. 4x token cost. 45 minutes wasted.**

**After United Agents:**
- trace_dependencies maps 7 connected files immediately
- Claude works through all 7 in one pass
- verify_completeness confirms complete
- **1 round. Done.**

## License

MIT

## Author

Nursultan Orynbassar — [unitedagents.dev](https://unitedagents.dev)
