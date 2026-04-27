# United Agents MCP — Project Brief

## What This Is
An MCP server that stops the Claude Code correction loop.
Maps every connected file before Claude starts, blocks "done" until all files addressed.

## npm Package
- Package: united-agents-mcp (v1.0.6 live on npm)
- GitHub: github.com/Nursultan2001/united-agents-mcp
- Domain: unitedagents.dev

## Stack
- TypeScript + Node.js
- Supabase for anonymous analytics (ua_analytics table)
- Supabase URL: https://kukulwdpjukalkspjvkn.supabase.co

## Three MCP Tools
1. trace_dependencies — maps dependency graph before editing
2. verify_completeness — blocks done until all files addressed
3. setup_project — writes CLAUDE.md enforcement rules

## Analytics
- Events tracked: setup, task_complete, task_incomplete
- View: ua_public_stats (total_projects, total_tasks_completed, unique_projects)

## Landing Page
- index.html built, needs deploying to unitedagents.dev
- Live stats pull from npm API + Supabase

## File Structure
src/index.ts    — MCP server + analytics tracking
src/tracer.ts   — dependency graph scanner
src/checker.ts  — completeness verifier + CLAUDE.md generator
src/setup.ts    — CLI setup wizard

## Pending
- Deploy index.html to unitedagents.dev (Vercel or Netlify)
- Nozomio hackathon: May 9, SF — demo this product
