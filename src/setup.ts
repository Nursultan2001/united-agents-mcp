#!/usr/bin/env node

/**
 * United Agents Setup Wizard
 * 
 * Run once from your project folder:
 *   npx united-agents-mcp setup
 * 
 * That's it. Never think about it again.
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { generateClaudeMd } from './checker'

const projectRoot = process.cwd()

function log(msg: string) {
  console.log(msg)
}

function success(msg: string) {
  console.log(`✅ ${msg}`)
}

function warn(msg: string) {
  console.log(`⚠️  ${msg}`)
}

function error(msg: string) {
  console.log(`❌ ${msg}`)
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch (e: any) {
    return e.message || ''
  }
}

function checkClaudeCode(): boolean {
  const result = run('which claude')
  return result.includes('claude') && !result.includes('not found')
}

function getMcpBinary(): string {
  // Find where united-agents-mcp is installed
  const result = run('which united-agents-mcp')
  if (result && !result.includes('not found')) {
    return result
  }

  // Fallback — use node with the dist path
  const distPath = path.join(__dirname, 'index.js')
  if (fs.existsSync(distPath)) {
    return `node ${distPath}`
  }

  return ''
}

function addMcpServer(binary: string): boolean {
  // Check if already added
  const existing = run('claude mcp list')
  if (existing.includes('united-agents')) {
    return true // already configured
  }

  let cmd = ''
  if (binary.startsWith('node ')) {
    const nodePath = binary.replace('node ', '')
    cmd = `claude mcp add united-agents node ${nodePath} --scope user`
  } else {
    cmd = `claude mcp add united-agents ${binary} --scope user`
  }

  const result = run(cmd)
  return result.includes('Added') || result.includes('already')
}

function writeClaudeMd(): boolean {
  try {
    const claudeMdPath = path.join(projectRoot, 'CLAUDE.md')
    const content = generateClaudeMd()

    if (fs.existsSync(claudeMdPath)) {
      const existing = fs.readFileSync(claudeMdPath, 'utf-8')
      if (existing.includes('United Agents')) {
        return true // already set up
      }
      fs.writeFileSync(claudeMdPath, existing + '\n\n' + content)
    } else {
      fs.writeFileSync(claudeMdPath, content)
    }
    return true
  } catch {
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)

  // Only run setup wizard if "setup" argument is passed
  if (args[0] !== 'setup') {
    // Default behavior — run as MCP server
    // This should not happen as index.ts handles MCP mode
    return
  }

  log('')
  log('╔═══════════════════════════════════════╗')
  log('║        United Agents Setup            ║')
  log('║   Stops the Claude Code loop once     ║')
  log('╚═══════════════════════════════════════╝')
  log('')
  log(`📂 Project: ${projectRoot}`)
  log('')

  // Step 1 — Check Claude Code
  log('Step 1/3 — Checking Claude Code...')
  if (!checkClaudeCode()) {
    error('Claude Code not found. Install it first: npm install -g @anthropic-ai/claude-code')
    process.exit(1)
  }
  success('Claude Code found')

  // Step 2 — Add MCP server globally
  log('')
  log('Step 2/3 — Adding United Agents to Claude Code (global)...')
  const binary = getMcpBinary()
  if (!binary) {
    error('Could not find united-agents-mcp binary. Try: npm install -g united-agents-mcp')
    process.exit(1)
  }

  const mcpAdded = addMcpServer(binary)
  if (mcpAdded) {
    success('United Agents MCP server registered globally')
    log('         Available in ALL your projects automatically')
  } else {
    warn('Could not auto-register MCP server. Run manually:')
    log(`         claude mcp add united-agents ${binary} --scope user`)
  }

  // Step 3 — Write CLAUDE.md rules to project
  log('')
  log('Step 3/3 — Writing enforcement rules to CLAUDE.md...')
  const claudeMdWritten = writeClaudeMd()
  if (claudeMdWritten) {
    success('CLAUDE.md rules written to project')
    log('         Claude will now follow the trace → execute → verify loop')
  } else {
    error('Could not write CLAUDE.md. Check folder permissions.')
    process.exit(1)
  }

  // Done
  log('')
  log('╔═══════════════════════════════════════╗')
  log('║           Setup Complete! 🎉          ║')
  log('╚═══════════════════════════════════════╝')
  log('')
  log('What happens now:')
  log('  • Open Claude Code in this project')
  log('  • Give Claude any task as normal')
  log('  • Claude automatically maps dependencies first')
  log('  • Claude cannot say "done" until all files are addressed')
  log('  • The correction loop is gone')
  log('')
  log('For new projects, run from that folder:')
  log('  npx united-agents-mcp setup')
  log('')
  log('unitedagents.dev')
  log('')
}

main()
