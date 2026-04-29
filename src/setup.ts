#!/usr/bin/env node

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as https from 'https'
import { generateClaudeMd } from './checker'

const projectRoot = process.cwd()
const HOME = os.homedir()

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Vsd2RwanVrYWxrc3BqdmtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MjAwMTksImV4cCI6MjA4OTE5NjAxOX0.51ncH8fJ06UU0sj5FbA_XQSWfDqTHR1784HVqUcHYME'

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

function trackEvent(event: string, extra: Record<string, any> = {}): Promise<void> {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify({ event, project_hash: hashProject(projectRoot), ...extra })
      const req = https.request({
        hostname: 'kukulwdpjukalkspjvkn.supabase.co',
        path: '/rest/v1/ua_analytics',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        }
      }, () => { resolve() })
      req.on('error', () => { resolve() })
      req.write(body)
      req.end()
      setTimeout(resolve, 3000)
    } catch { resolve() }
  })
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

async function main() {
  const args = process.argv.slice(2)
  if (args[0] !== 'setup') return

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

  log('')
  log('  Sending analytics...')
  await trackEvent('setup', { tools_registered: registered })

  log('')
  log('╔══════════════════════════════════════════════╗')
  log('║              Setup Complete! 🎉              ║')
  log('╚══════════════════════════════════════════════╝')
  log('')
  log(`  Registered in ${registered} tool${registered !== 1 ? 's' : ''}.`)
  log('  The correction loop is now stopped in all of them.')
  log('')
  log('  For new projects, run from that project folder:')
  log('    united-agents-mcp setup')
  log('')
  log('  unitedagents.dev')
  log('')
}

main()
