#!/usr/bin/env node

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { generateClaudeMd } from './checker'

const projectRoot = process.cwd()

// Supabase config — same project as united-agents platform
const SUPABASE_URL = 'https://kukulwdpjukalkspjvkn.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Vsd2RwanVrYWxrc3BqdmtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MjAwMTksImV4cCI6MjA4OTE5NjAxOX0.51ncH8fJ06UU0sj5FbA_XQSWfDqTHR1784HVqUcHYME'

function log(msg: string) { console.log(msg) }
function success(msg: string) { console.log(`✅ ${msg}`) }
function warn(msg: string) { console.log(`⚠️  ${msg}`) }
function error(msg: string) { console.log(`❌ ${msg}`) }

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch (e: any) {
    return e.message || ''
  }
}

// Anonymous hash of project path — no PII, just for counting unique projects
function hashProject(projectPath: string): string {
  return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
}

// Phone-home analytics — completely anonymous
async function trackEvent(event: string, extra: Record<string, any> = {}) {
  try {
    const body = JSON.stringify({
      event,
      project_hash: hashProject(projectRoot),
      ...extra
    })

    // Use node's built-in https
    const https = await import('https')
    const url = new URL(`${SUPABASE_URL}/rest/v1/ua_analytics`)

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      }
    }

    await new Promise<void>((resolve) => {
      const req = https.request(options, (res) => { resolve() })
      req.on('error', () => resolve()) // Silent fail — never block user
      req.write(body)
      req.end()
    })
  } catch {
    // Always silent — analytics should never break the tool
  }
}

function checkClaudeCode(): boolean {
  const result = run('which claude')
  return result.includes('claude') && !result.includes('not found')
}

function getMcpBinary(): string {
  const result = run('which united-agents-mcp')
  if (result && !result.includes('not found')) return result
  const distPath = path.join(__dirname, 'index.js')
  if (fs.existsSync(distPath)) return `node ${distPath}`
  return ''
}

function addMcpServer(binary: string): boolean {
  const existing = run('claude mcp list')
  if (existing.includes('united-agents')) return true
  let cmd = ''
  if (binary.startsWith('node ')) {
    cmd = `claude mcp add united-agents node ${binary.replace('node ', '')} --scope user`
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
      if (existing.includes('United Agents')) return true
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
  if (args[0] !== 'setup') return

  log('')
  log('╔═══════════════════════════════════════╗')
  log('║        United Agents Setup            ║')
  log('║   Stops the Claude Code loop once     ║')
  log('╚═══════════════════════════════════════╝')
  log('')
  log(`📂 Project: ${projectRoot}`)
  log('')

  log('Step 1/3 — Checking Claude Code...')
  if (!checkClaudeCode()) {
    error('Claude Code not found. Install it first: npm install -g @anthropic-ai/claude-code')
    process.exit(1)
  }
  success('Claude Code found')

  log('')
  log('Step 2/3 — Adding United Agents to Claude Code (global)...')
  const binary = getMcpBinary()
  if (!binary) {
    error('Could not find united-agents-mcp binary.')
    process.exit(1)
  }
  const mcpAdded = addMcpServer(binary)
  if (mcpAdded) {
    success('United Agents MCP server registered globally')
    log('         Available in ALL your projects automatically')
  } else {
    warn('Could not auto-register. Run manually:')
    log(`         claude mcp add united-agents ${binary} --scope user`)
  }

  log('')
  log('Step 3/3 — Writing enforcement rules to CLAUDE.md...')
  const claudeMdWritten = writeClaudeMd()
  if (claudeMdWritten) {
    success('CLAUDE.md rules written to project')
    log('         Claude will now follow the trace → execute → verify loop')
  } else {
    error('Could not write CLAUDE.md.')
    process.exit(1)
  }

  // Track setup event — anonymous, never blocks
  await trackEvent('setup')

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
  log('For new projects, run from that project folder:')
  log('  united-agents-mcp setup')
  log('')
  log('─────────────────────────────────────────')
  log('  Learn more: https://unitedagents.dev')
  log('─────────────────────────────────────────')
  log('')
}

main()
