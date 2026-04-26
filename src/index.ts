#!/usr/bin/env node

/**
 * United Agents MCP Server
 * 
 * Stops the Claude Code correction loop by:
 * 1. Mapping all connected files BEFORE Claude starts
 * 2. Verifying ALL connected files were addressed AFTER Claude finishes
 * 3. Forcing Claude to continue until the task is truly complete
 * 
 * Install: npm install -g united-agents-mcp
 * Setup:   claude mcp add united-agents node $(which united-agents-mcp)
 */

import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import { traceDepedencies, DependencyMap } from './tracer'
import { checkCompleteness, formatDependencyMap, generateClaudeMd } from './checker'

// Store dependency maps between calls
const activeMaps = new Map<string, DependencyMap>()

// MCP Protocol handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

function sendResponse(id: any, result: any) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  })
  process.stdout.write(response + '\n')
}

function sendError(id: any, code: number, message: string) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  })
  process.stdout.write(response + '\n')
}

function handleRequest(request: any) {
  const { id, method, params } = request

  // MCP Initialization
  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'united-agents',
        version: '1.0.2'
      }
    })
    return
  }

  // List available tools
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
              file: {
                type: 'string',
                description: 'The file name or path you are about to change (e.g. "LeadPipeline.tsx")'
              },
              project_root: {
                type: 'string',
                description: 'Absolute path to the project root directory'
              },
              task: {
                type: 'string',
                description: 'Brief description of what you are trying to accomplish'
              }
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
              file: {
                type: 'string',
                description: 'The same file name you traced at the start of this task'
              },
              project_root: {
                type: 'string',
                description: 'Absolute path to the project root directory'
              }
            },
            required: ['file', 'project_root']
          }
        },
        {
          name: 'setup_project',
          description: `Run this ONCE when setting up United Agents in a new project.
Writes the CLAUDE.md rules file that enforces the full completion workflow.
After setup, Claude will automatically follow the trace → execute → verify loop.`,
          inputSchema: {
            type: 'object',
            properties: {
              project_root: {
                type: 'string',
                description: 'Absolute path to the project root directory'
              }
            },
            required: ['project_root']
          }
        }
      ]
    })
    return
  }

  // Handle tool calls
  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments || {}

    if (toolName === 'trace_dependencies') {
      const { file, project_root, task } = args

      if (!file || !project_root) {
        sendError(id, -32602, 'Missing required parameters: file and project_root')
        return
      }

      try {
        const map = traceDepedencies(file, project_root)
        activeMaps.set(file, map)

        const formatted = formatDependencyMap(map)
        const taskNote = task ? `\n🎯 Task: "${task}"\n` : ''

        sendResponse(id, {
          content: [{
            type: 'text',
            text: taskNote + formatted + '\n\n⚡ REQUIRED: Work through ALL 🎯 direct, 🌐 api, and 🗄️ db files before calling verify_completeness. Do not stop after the first file.'
          }]
        })
      } catch (err: any) {
        sendError(id, -32603, `Tracer error: ${err.message}`)
      }
      return
    }

    if (toolName === 'verify_completeness') {
      const { file, project_root } = args

      if (!file || !project_root) {
        sendError(id, -32602, 'Missing required parameters: file and project_root')
        return
      }

      let map = activeMaps.get(file)
      if (!map) {
        map = traceDepedencies(file, project_root)
        activeMaps.set(file, map)
      }

      try {
        const result = checkCompleteness(map, project_root)

        if (result.isComplete) {
          activeMaps.delete(file)
        }

        sendResponse(id, {
          content: [{
            type: 'text',
            text: result.summary
          }]
        })
      } catch (err: any) {
        sendError(id, -32603, `Checker error: ${err.message}`)
      }
      return
    }

    if (toolName === 'setup_project') {
      const { project_root } = args

      if (!project_root) {
        sendError(id, -32602, 'Missing required parameter: project_root')
        return
      }

      try {
        const claudeMdPath = path.join(project_root, 'CLAUDE.md')
        const claudeMdContent = generateClaudeMd()

        // Check if CLAUDE.md already exists
        if (fs.existsSync(claudeMdPath)) {
          const existing = fs.readFileSync(claudeMdPath, 'utf-8')
          if (existing.includes('United Agents')) {
            sendResponse(id, {
              content: [{
                type: 'text',
                text: `✅ United Agents rules already in CLAUDE.md at ${claudeMdPath}\n\nThe project is already set up. Claude will follow the trace → execute → verify loop automatically.`
              }]
            })
            return
          }
          // Append to existing CLAUDE.md
          fs.writeFileSync(claudeMdPath, existing + '\n\n' + claudeMdContent)
          sendResponse(id, {
            content: [{
              type: 'text',
              text: `✅ United Agents rules appended to existing CLAUDE.md at ${claudeMdPath}\n\nClaude will now automatically:\n1. Call trace_dependencies before touching files\n2. Work through ALL connected files\n3. Call verify_completeness before saying done\n4. Continue working if incomplete — without asking you`
            }]
          })
        } else {
          // Create new CLAUDE.md
          fs.writeFileSync(claudeMdPath, claudeMdContent)
          sendResponse(id, {
            content: [{
              type: 'text',
              text: `✅ Created CLAUDE.md at ${claudeMdPath}\n\nClaude will now automatically:\n1. Call trace_dependencies before touching files\n2. Work through ALL connected files\n3. Call verify_completeness before saying done\n4. Continue working if incomplete — without asking you\n\nThe correction loop is closed. Claude cannot declare a task done until verify_completeness confirms ✅ COMPLETE.`
            }]
          })
        }
      } catch (err: any) {
        sendError(id, -32603, `Setup error: ${err.message}`)
      }
      return
    }

    sendError(id, -32601, `Unknown tool: ${toolName}`)
    return
  }

  // Handle notifications (no response needed)
  if (method === 'notifications/initialized') {
    return
  }

  sendError(id, -32601, `Method not found: ${method}`)
}

// Process incoming messages
rl.on('line', (line: string) => {
  line = line.trim()
  if (!line) return

  try {
    const request = JSON.parse(line)
    handleRequest(request)
  } catch (err) {
    // Invalid JSON — ignore
  }
})

// Keep process alive
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
