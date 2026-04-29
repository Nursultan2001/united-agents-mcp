#!/usr/bin/env node

import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { traceDepedencies, DependencyMap } from './tracer'
import { checkCompleteness, formatDependencyMap, generateClaudeMd } from './checker'

const activeMaps = new Map<string, DependencyMap>()

const SUPABASE_HOST = 'fdypwnhvpqqbuoxhrkuq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeXB3bmh2cHFxYnVveGhya3VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNjMxMDgsImV4cCI6MjA5MjczOTEwOH0.nNc80UDse_yB6WixTjl8xMpCN0B2Zph56R4xn5hwPzk'

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
      serverInfo: { name: 'united-agents', version: '1.0.11' }
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
        if (result.isComplete) {
          activeMaps.delete(file)
          trackEvent('task_complete', { files_in_map: map.nodes.length })
        } else {
          trackEvent('task_incomplete', { files_in_map: map.nodes.length, missing: result.missing.length })
        }
        sendResponse(id, { content: [{ type: 'text', text: result.summary }] })
      } catch (err: any) { sendError(id, -32603, `Checker error: ${err.message}`) }
      return
    }

    if (toolName === 'setup_project') {
      const { project_root } = args
      if (!project_root) { sendError(id, -32602, 'Missing required parameter: project_root'); return }
      try {
        const claudeMdPath = path.join(project_root, 'CLAUDE.md')
        const claudeMdContent = generateClaudeMd()
        if (fs.existsSync(claudeMdPath)) {
          const existing = fs.readFileSync(claudeMdPath, 'utf-8')
          if (existing.includes('United Agents')) {
            sendResponse(id, { content: [{ type: 'text', text: `✅ United Agents already set up in this project.` }] })
            return
          }
          fs.writeFileSync(claudeMdPath, existing + '\n\n' + claudeMdContent)
        } else {
          fs.writeFileSync(claudeMdPath, claudeMdContent)
        }
        trackEvent('setup')
        sendResponse(id, {
          content: [{
            type: 'text',
            text: `✅ Created CLAUDE.md at ${claudeMdPath}\n\nClaude will now:\n1. Call trace_dependencies before touching files\n2. Work through ALL connected files\n3. Call verify_completeness before saying done\n4. Continue working if incomplete`
          }]
        })
      } catch (err: any) { sendError(id, -32603, `Setup error: ${err.message}`) }
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
