#!/usr/bin/env node

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { generateClaudeMd } from './checker'

const projectRoot = process.cwd()
const HOME = os.homedir()

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeXB3bmh2cHFxYnVveGhya3VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNjMxMDgsImV4cCI6MjA5MjczOTEwOH0.nNc80UDse_yB6WixTjl8xMpCN0B2Zph56R4xn5hwPzk'
const SUPABASE_HOST = 'fdypwnhvpqqbuoxhrkuq.supabase.co'

function log(msg: string) { console.log(msg) }
function success(msg: string) { console.log(`  ✅ ${msg}`) }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`) }
function skip(msg: string) { console.log(`  ⚪ ${msg}`) }
function error(msg: string) { console.log(`  ❌ ${msg}`) }

function run(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim() }
  catch { return '' }
}

function hashProject(p: string): string {
  return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16)
}

function trackEvent(event: string) {
  try {
    const body = JSON.stringify({ event, project_hash: hashProject(projectRoot) })
    const escaped = body.replace(/'/g, "'\\''")
    run(
      `curl -s -o /dev/null -X POST ` +
      `'https://${SUPABASE_HOST}/rest/v1/ua_analytics' ` +
      `-H 'Content-Type: application/json' ` +
      `-H 'apikey: ${ANON_KEY}' ` +
      `-H 'Authorization: Bearer ${ANON_KEY}' ` +
      `-H 'Prefer: return=minimal' ` +
      `-d '${escaped}'`
    )
  } catch {}
}

function commandExists(cmd: string): boolean { return run(`which ${cmd}`).length > 0 }

function getMcpBinary(): string {
  const r = run('which united-agents-mcp')
  if (r) return r
  const distPath = path.join(__dirname, 'index.js')
  if (fs.existsSync(distPath)) return `node ${distPath}`
  return ''
}

function readJson(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch { return null }
}

function writeJson(filePath: string, data: any): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch { return false }
}

function readToml(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf-8')
  } catch { return '' }
}

function setupClaudeCode(binary: string): 'ok' | 'skip' | 'fail' {
  if (!commandExists('claude')) return 'skip'
  const existing = run('claude mcp list')
  if (existing.includes('united-agents')) return 'ok'
  const cmd = binary.startsWith('node ')
    ? `claude mcp add united-agents node ${binary.replace('node ', '')} --scope user`
    : `claude mcp add united-agents ${binary} --scope user`
  run(cmd)
  return 'ok'
}

function setupCursor(binary: string): 'ok' | 'skip' | 'fail' {
  const cursorDir = path.join(HOME, '.cursor')
  if (!fs.existsSync(cursorDir) && !commandExists('cursor')) return 'skip'
  const configPath = path.join(cursorDir, 'mcp.json')
  const existing = readJson(configPath) || {}
  if (existing?.mcpServers?.['united-agents']) return 'ok'
  return writeJson(configPath, {
    ...existing,
    mcpServers: { ...(existing.mcpServers || {}), 'united-agents': { command: binary, type: 'stdio' } }
  }) ? 'ok' : 'fail'
}

function setupWindsurf(binary: string): 'ok' | 'skip' | 'fail' {
  const windsurfDir = path.join(HOME, '.codeium', 'windsurf')
  if (!fs.existsSync(windsurfDir) && !commandExists('windsurf')) return 'skip'
  const configPath = path.join(windsurfDir, 'mcp_config.json')
  const existing = readJson(configPath) || {}
  if (existing?.mcpServers?.['united-agents']) return 'ok'
  return writeJson(configPath, {
    ...existing,
    mcpServers: { ...(existing.mcpServers || {}), 'united-agents': { command: binary, type: 'stdio' } }
  }) ? 'ok' : 'fail'
}

function setupCopilot(binary: string): 'ok' | 'skip' | 'fail' {
  if (!commandExists('code') && !fs.existsSync(path.join(HOME, '.vscode'))) return 'skip'
  const configPath = path.join(projectRoot, '.vscode', 'mcp.json')
  const existing = readJson(configPath) || {}
  if (existing?.servers?.['united-agents']) return 'ok'
  return writeJson(configPath, {
    ...existing,
    servers: { ...(existing.servers || {}), 'united-agents': { command: binary, type: 'stdio' } }
  }) ? 'ok' : 'fail'
}

function setupCodex(binary: string): 'ok' | 'skip' | 'fail' {
  const codexDir = path.join(HOME, '.codex')
  if (!fs.existsSync(codexDir) && !commandExists('codex')) return 'skip'
  const configPath = path.join(codexDir, 'config.toml')
  const existing = readToml(configPath)
  if (existing.includes('[mcp_servers.united-agents]')) return 'ok'
  try {
    fs.mkdirSync(codexDir, { recursive: true })
    fs.appendFileSync(configPath, `\n[mcp_servers.united-agents]\ncommand = "${binary}"\nargs = []\n`)
    return 'ok'
  } catch { return 'fail' }
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
  } catch { return false }
}

// ─── HISTORY COMMAND ────────────────────────────────────────────────────────

function showHistory() {
  const historyPath = path.join(projectRoot, '.ua-history.json')

  if (!fs.existsSync(historyPath)) {
    log('')
    log('  📭 No history yet.')
    log('  United Agents will log every task here as you use it.')
    log('')
    return
  }

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
    if (history.length === 0) {
      log('\n  📭 No history yet.\n')
      return
    }

    log('')
    log('  📋 United Agents — Task History')
    log('  ' + '─'.repeat(56))
    log(`  📌 Project hash: ${hashProject(projectRoot)}`)
    log('  ' + '─'.repeat(56))
    log('')

    const recent = [...history].reverse().slice(0, 20)
    for (const entry of recent) {
      const date = new Date(entry.timestamp)
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

      if (entry.event === 'setup') {
        log(`  ${dateStr} ${timeStr}  🔧 setup`)
        continue
      }

      const icon = entry.result === 'complete' ? '✅' : '🔄'
      const fileStr = ((entry.file || 'unknown').split('/').pop() || '').padEnd(30)
      const filesStr = entry.files_in_map ? `${entry.files_in_map} files` : ''
      const taskStr = entry.task ? `\n              💬 "${entry.task}"` : ''
      log(`  ${dateStr} ${timeStr}  ${icon} ${fileStr} ${filesStr}${taskStr}`)
    }

    if (history.length > 20) {
      log('')
      log(`  ... and ${history.length - 20} more. See .ua-history.json for full log.`)
    }

    log('')
    const tasks = history.filter((e: any) => e.event !== 'setup')
    const done = history.filter((e: any) => e.result === 'complete')
    log(`  Total tasks: ${tasks.length}  |  Completed: ${done.length}  |  Setups: ${history.filter((e: any) => e.event === 'setup').length}`)
    log(`  Full log: ${historyPath}`)
    log('')
  } catch {
    log('\n  ❌ Could not read history file.\n')
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  // united-agents-mcp hash — print this project's deterministic fingerprint.
  // Pass --with-path to also print the absolute project root (useful for debugging
  // why two installations of the same project have different hashes).
  if (args[0] === 'hash') {
    const withPath = args.includes('--with-path')
    if (withPath) {
      log(`hash: ${hashProject(projectRoot)}`)
      log(`path: ${projectRoot}`)
    } else {
      log(hashProject(projectRoot))
    }
    return
  }

  // united-agents-mcp history
  if (args[0] === 'history') {
    showHistory()
    return
  }

  if (args[0] !== 'setup') {
    log('')
    log('  United Agents MCP')
    log('')
    log('  Commands:')
    log('    united-agents-mcp setup    — set up this project')
    log('    united-agents-mcp history  — show task history for this project')
    log('    united-agents-mcp hash     — print this project\'s registry fingerprint')
    log('')
    return
  }

  log('')
  log('╔══════════════════════════════════════════════╗')
  log('║           United Agents Setup                ║')
  log('║   Stops the AI coding correction loop        ║')
  log('╚══════════════════════════════════════════════╝')
  log('')
  log(`📂 Project: ${projectRoot}`)
  log('')

  const binary = getMcpBinary()
  if (!binary) {
    error('Could not find united-agents-mcp binary. Try: npm install -g united-agents-mcp')
    process.exit(1)
  }

  log('Step 1/2 — Registering in detected AI coding tools...')
  log('')

  const tools = [
    { name: 'Claude Code',              fn: () => setupClaudeCode(binary) },
    { name: 'Cursor',                   fn: () => setupCursor(binary) },
    { name: 'Windsurf',                 fn: () => setupWindsurf(binary) },
    { name: 'GitHub Copilot (VS Code)', fn: () => setupCopilot(binary) },
    { name: 'Codex (OpenAI)',           fn: () => setupCodex(binary) },
  ]

  let registered = 0
  for (const tool of tools) {
    const result = tool.fn()
    if (result === 'ok') { success(`${tool.name}`); registered++ }
    else if (result === 'skip') { skip(`${tool.name} — not detected, skipped`) }
    else { warn(`${tool.name} — could not configure automatically`) }
  }

  log('')
  if (registered === 0) {
    warn('No AI tools detected.')
    process.exit(1)
  }

  log('Step 2/2 — Writing enforcement rules to CLAUDE.md...')
  if (writeClaudeMd()) {
    success('CLAUDE.md written — enforcement rules active for this project')
  } else {
    warn('Could not write CLAUDE.md. Check folder permissions.')
  }

  trackEvent('setup')

  const projectHash = hashProject(projectRoot)
  log('')
  log('╔══════════════════════════════════════════════╗')
  log('║              Setup Complete! 🎉              ║')
  log('╚══════════════════════════════════════════════╝')
  log('')
  log(`  Registered in ${registered} tool${registered !== 1 ? 's' : ''}.`)
  log('  The correction loop is now stopped in all of them.')
  log('')
  log(`  📌 Project hash: ${projectHash}`)
  log('     (use this to claim your agent at unitedagents.dev/claim)')
  log('')
  log('  Useful commands:')
  log('    united-agents-mcp history   — see what UA did in this project')
  log('    united-agents-mcp hash      — print this project\'s registry fingerprint')
  log('    united-agents-mcp setup     — set up a new project')
  log('')
  log('  unitedagents.dev')
  log('')
}

main()
