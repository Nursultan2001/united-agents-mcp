#!/usr/bin/env node

import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import * as crypto from 'crypto'
import { traceDepedencies, DependencyMap } from './tracer'
import { checkCompleteness, formatDependencyMap, generateClaudeMd } from './checker'

// Deterministic project fingerprint — SHA-256 of absolute path, first 16 chars.
// Used by the United Agents registry to link MCP-tracked task data to a claimed agent.
function hashProject(p: string): string {
  return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16)
}

const activeMaps = new Map<string, DependencyMap>()

const SUPABASE_HOST = 'fdypwnhvpqqbuoxhrkuq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeXB3bmh2cHFxYnVveGhya3VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNjMxMDgsImV4cCI6MjA5MjczOTEwOH0.nNc80UDse_yB6WixTjl8xMpCN0B2Zph56R4xn5hwPzk'

// ─── HISTORY LOG ────────────────────────────────────────────────────────────

interface HistoryEntry {
  timestamp: string
  event: 'task_complete' | 'task_incomplete' | 'setup'
  project_hash?: string
  file?: string
  task?: string
  files_in_map?: number
  missing?: number
  result: 'complete' | 'incomplete' | 'setup'
}

function getHistoryPath(project_root: string): string {
  return path.join(project_root, '.ua-history.json')
}

function readHistory(project_root: string): HistoryEntry[] {
  try {
    const p = getHistoryPath(project_root)
    if (!fs.existsSync(p)) return []
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { return [] }
}

function writeHistory(project_root: string, entry: HistoryEntry) {
  try {
    const p = getHistoryPath(project_root)
    const history = readHistory(project_root)
    // Always stamp project_hash so the United Agents registry can link this file
    // to a claimed agent without the user computing SHA-256 by hand.
    if (!entry.project_hash) entry.project_hash = hashProject(project_root)
    history.push(entry)
    // Keep last 100 entries
    if (history.length > 100) history.splice(0, history.length - 100)
    fs.writeFileSync(p, JSON.stringify(history, null, 2))
  } catch {}
}

function formatHistory(history: HistoryEntry[]): string {
  if (history.length === 0) {
    return '📭 No history yet.\n\nUnited Agents will log every task here once you start using it.'
  }

  const lines: string[] = ['📋 United Agents — Task History', '─'.repeat(48), '']

  // Show most recent first
  const recent = [...history].reverse().slice(0, 20)

  for (const entry of recent) {
    const date = new Date(entry.timestamp)
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

    if (entry.event === 'setup') {
      lines.push(`${dateStr} ${timeStr}  🔧 setup         project configured`)
      continue
    }

    const icon = entry.result === 'complete' ? '✅' : '🔄'
    const status = entry.result === 'complete' ? 'complete' : 'incomplete'
    const fileStr = (entry.file ? (entry.file.split('/').pop() ?? entry.file) : 'unknown')
    const filesStr = entry.files_in_map ? `${entry.files_in_map} files` : ''
    const taskStr = entry.task ? `  "${entry.task}"` : ''

    lines.push(`${dateStr} ${timeStr}  ${icon} ${fileStr.padEnd(28)} ${filesStr.padEnd(10)} ${status}${taskStr}`)
  }

  if (history.length > 20) {
    lines.push('')
    lines.push(`... and ${history.length - 20} more entries. See .ua-history.json for full log.`)
  }

  lines.push('')
  lines.push(`Total tasks: ${history.filter(e => e.event !== 'setup').length} | Completed: ${history.filter(e => e.result === 'complete').length} | Project setups: ${history.filter(e => e.event === 'setup').length}`)

  return lines.join('\n')
}

// ─── ANALYTICS ──────────────────────────────────────────────────────────────

function trackEvent(event: string, extra: Record<string, any> = {}) {
  try {
    const body = JSON.stringify({ event, ...extra })
    const req = https.request({
      hostname: SUPABASE_HOST,
      path: '/rest/v1/ua_analytics',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      }
    }, () => {})
    req.on('error', () => {})
    req.write(body)
    req.end()
  } catch {}
}

// ─── MCP SERVER ─────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

function sendResponse(id: any, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(id: any, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

function handleRequest(request: any) {
  const { id, method, params } = request

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'united-agents', version: '1.0.14' }
    })
    return
  }

  if (method === 'tools/list') {
    sendResponse(id, {
      tools: [
        {
          name: 'trace_dependencies',
          description: `ALWAYS call this BEFORE making any changes to a file.
Maps every connected file that must be addressed to fully complete the task.
Prevents the "I said done but missed connected files" loop.
Returns a dependency map showing all files Claude must touch.`,
          inputSchema: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'The file name or path you are about to change' },
              project_root: { type: 'string', description: 'Absolute path to the project root directory' },
              task: { type: 'string', description: 'Brief description of what you are trying to accomplish' }
            },
            required: ['file', 'project_root']
          }
        },
        {
          name: 'verify_completeness',
          description: `ALWAYS call this BEFORE saying "done", "fixed", or "complete".
Checks if Claude actually addressed all the connected files from the dependency map.
If INCOMPLETE — Claude MUST continue working immediately without asking the user.
Claude only reports task complete after this returns COMPLETE.`,
          inputSchema: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'The same file name you traced at the start of this task' },
              project_root: { type: 'string', description: 'Absolute path to the project root directory' }
            },
            required: ['file', 'project_root']
          }
        },
        {
          name: 'setup_project',
          description: `Run this ONCE when setting up United Agents in a new project.
Writes the CLAUDE.md rules file that enforces the full completion workflow.`,
          inputSchema: {
            type: 'object',
            properties: {
              project_root: { type: 'string', description: 'Absolute path to the project root directory' }
            },
            required: ['project_root']
          }
        },
        {
          name: 'get_history',
          description: `Show the history of all tasks United Agents has tracked in this project.
Use this when the user asks "what did you do?", "show history", "what tasks were completed?",
or any question about past work in this project.`,
          inputSchema: {
            type: 'object',
            properties: {
              project_root: { type: 'string', description: 'Absolute path to the project root directory' }
            },
            required: ['project_root']
          }
        }
      ]
    })
    return
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments || {}

    if (toolName === 'trace_dependencies') {
      const { file, project_root, task } = args
      if (!file || !project_root) { sendError(id, -32602, 'Missing required parameters'); return }
      try {
        const map = traceDepedencies(file, project_root)
        activeMaps.set(file, map)
        const formatted = formatDependencyMap(map)
        const taskNote = task ? `\n🎯 Task: "${task}"\n` : ''
        // Store task description for history
        if (task) activeMaps.set(`${file}:task`, { nodes: [], edges: [], task } as any)
        sendResponse(id, {
          content: [{
            type: 'text',
            text: taskNote + formatted + '\n\n⚡ REQUIRED: Work through ALL 🎯 direct, 🌐 api, and 🗄️ db files before calling verify_completeness.'
          }]
        })
      } catch (err: any) { sendError(id, -32603, `Tracer error: ${err.message}`) }
      return
    }

    if (toolName === 'verify_completeness') {
      const { file, project_root } = args
      if (!file || !project_root) { sendError(id, -32602, 'Missing required parameters'); return }
      let map = activeMaps.get(file)
      if (!map) { map = traceDepedencies(file, project_root); activeMaps.set(file, map) }
      try {
        const result = checkCompleteness(map, project_root)
        const taskMeta = activeMaps.get(`${file}:task`) as any

        if (result.isComplete) {
          activeMaps.delete(file)
          activeMaps.delete(`${file}:task`)
          const projectHash = hashProject(project_root)
          trackEvent('task_complete', { files_in_map: map.nodes.length, project_hash: projectHash })
          writeHistory(project_root, {
            timestamp: new Date().toISOString(),
            event: 'task_complete',
            project_hash: projectHash,
            file,
            task: taskMeta?.task,
            files_in_map: map.nodes.length,
            result: 'complete'
          })
        } else {
          const projectHash = hashProject(project_root)
          trackEvent('task_incomplete', { files_in_map: map.nodes.length, missing: result.missing.length, project_hash: projectHash })
          writeHistory(project_root, {
            timestamp: new Date().toISOString(),
            event: 'task_incomplete',
            project_hash: projectHash,
            file,
            task: taskMeta?.task,
            files_in_map: map.nodes.length,
            missing: result.missing.length,
            result: 'incomplete'
          })
        }
        sendResponse(id, { content: [{ type: 'text', text: result.summary }] })
      } catch (err: any) { sendError(id, -32603, `Checker error: ${err.message}`) }
      return
    }

    if (toolName === 'setup_project') {
      const { project_root } = args
      if (!project_root) { sendError(id, -32602, 'Missing required parameter: project_root'); return }
      try {
        const projectHash = hashProject(project_root)
        const claudeMdPath = path.join(project_root, 'CLAUDE.md')
        const claudeMdContent = generateClaudeMd()
        if (fs.existsSync(claudeMdPath)) {
          const existing = fs.readFileSync(claudeMdPath, 'utf-8')
          if (existing.includes('United Agents')) {
            sendResponse(id, { content: [{ type: 'text', text: `✅ United Agents already set up in this project.\n\n📌 Project hash: ${projectHash}\n   (use this to claim your agent at unitedagents.dev/claim)` }] })
            return
          }
          fs.writeFileSync(claudeMdPath, existing + '\n\n' + claudeMdContent)
        } else {
          fs.writeFileSync(claudeMdPath, claudeMdContent)
        }
        trackEvent('setup', { project_hash: projectHash })
        writeHistory(project_root, {
          timestamp: new Date().toISOString(),
          event: 'setup',
          project_hash: projectHash,
          result: 'setup'
        })
        sendResponse(id, {
          content: [{
            type: 'text',
            text: `✅ Created CLAUDE.md at ${claudeMdPath}\n\n📌 Project hash: ${projectHash}\n   (use this to claim your agent at unitedagents.dev/claim)\n\nClaude will now:\n1. Call trace_dependencies before touching files\n2. Work through ALL connected files\n3. Call verify_completeness before saying done\n4. Continue working if incomplete\n\nRun get_history anytime to see what United Agents has done in this project.`
          }]
        })
      } catch (err: any) { sendError(id, -32603, `Setup error: ${err.message}`) }
      return
    }

    if (toolName === 'get_history') {
      const { project_root } = args
      if (!project_root) { sendError(id, -32602, 'Missing required parameter: project_root'); return }
      try {
        const history = readHistory(project_root)
        const formatted = formatHistory(history)
        sendResponse(id, { content: [{ type: 'text', text: formatted }] })
      } catch (err: any) { sendError(id, -32603, `History error: ${err.message}`) }
      return
    }

    sendError(id, -32601, `Unknown tool: ${toolName}`)
    return
  }

  if (method === 'notifications/initialized') return
  sendError(id, -32601, `Method not found: ${method}`)
}

rl.on('line', (line: string) => {
  line = line.trim()
  if (!line) return
  try { handleRequest(JSON.parse(line)) } catch {}
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
