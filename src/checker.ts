import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { DependencyMap } from './tracer'

export interface CheckResult {
  addressed: string[]
  missing: string[]
  isComplete: boolean
  summary: string
}

// Get files changed since last commit (or staged)
function getChangedFiles(projectRoot: string): string[] {
  try {
    const staged = execSync('git diff --name-only HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).trim()

    const unstaged = execSync('git diff --name-only', {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).trim()

    const combined = [...staged.split('\n'), ...unstaged.split('\n')]
      .filter(Boolean)
      .map(f => f.trim())

    return [...new Set(combined)]
  } catch {
    return []
  }
}

// Check if a dependency node was addressed
function wasAddressed(nodeFile: string, changedFiles: string[]): boolean {
  const nodeBase = nodeFile.replace(/^src\//, '')

  for (const changed of changedFiles) {
    const changedBase = changed.replace(/^src\//, '')
    if (
      changedBase === nodeBase ||
      changed.includes(nodeBase) ||
      nodeBase.includes(changedBase) ||
      changed.endsWith(path.basename(nodeFile))
    ) {
      return true
    }
  }
  return false
}

// Main checker function
export function checkCompleteness(
  dependencyMap: DependencyMap,
  projectRoot: string
): CheckResult {
  const changedFiles = getChangedFiles(projectRoot)

  const addressed: string[] = []
  const missing: string[] = []

  for (const node of dependencyMap.nodes) {
    if (wasAddressed(node.file, changedFiles)) {
      addressed.push(node.file)
    } else {
      if (node.type === 'direct' || node.type === 'api' || node.type === 'db') {
        missing.push(node.file)
      } else {
        addressed.push(node.file + ' (not modified — verified not needed)')
      }
    }
  }

  const isComplete = missing.length === 0

  let summary = ''

  if (isComplete) {
    summary = `✅ COMPLETE — All ${addressed.length} critical files were addressed. You may now report task complete to the user.`
  } else {
    summary = `🚫 INCOMPLETE — DO NOT say "done", "fixed", or "complete" to the user yet.

${missing.length} critical file(s) were NOT addressed:
${missing.map(f => `  → ${f}`).join('\n')}

${addressed.length > 1 ? `Already addressed:\n${addressed.map(f => `  ✓ ${f}`).join('\n')}\n` : ''}
REQUIRED NEXT STEPS — execute these now without asking the user:
${missing.map((f, i) => `  ${i + 1}. Open ${f} and apply necessary changes to fully complete the task`).join('\n')}

After addressing all files above, call verify_completeness again.
Only report to the user after verify_completeness returns ✅ COMPLETE.`
  }

  return {
    addressed,
    missing,
    isComplete,
    summary
  }
}

// Format dependency map for display
export function formatDependencyMap(map: DependencyMap): string {
  if (map.nodes.length === 0) {
    return `❌ Could not find file matching "${map.target}" in the project.`
  }

  const typeEmoji: Record<string, string> = {
    direct: '🎯',
    connected: '🔗',
    parent: '📦',
    api: '🌐',
    db: '🗄️'
  }

  const lines = [
    `📊 Dependency map for: ${map.target}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Found ${map.nodes.length} files that must be considered:`,
    '',
    ...map.nodes.map(node =>
      `${typeEmoji[node.type] || '•'} ${node.file}\n   └─ ${node.reason}`
    ),
    '',
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ Work through ALL 🎯 direct, 🌐 api, and 🗄️ db files before calling verify_completeness.`,
    `Scanned at: ${map.scannedAt}`
  ]

  return lines.join('\n')
}

// Generate CLAUDE.md content for project setup
export function generateClaudeMd(): string {
  return `# United Agents — Task Completion Rules

## MANDATORY WORKFLOW FOR EVERY TASK

You MUST follow this exact workflow for every task in this project:

### Step 1 — Before touching ANY file
Call \`trace_dependencies\` with the file you are about to change.
Read the full dependency map it returns.
Understand EVERY file flagged as 🎯 direct, 🌐 api, or 🗄️ db.

### Step 2 — Execute against the full map
Work through ALL flagged files — not just the obvious ones.
Do NOT stop after changing the first file.
Consider every connected API route and database layer.

### Step 3 — Before saying "done" to the user
Call \`verify_completeness\` with the same file.
If it returns 🚫 INCOMPLETE:
  - DO NOT report completion to the user
  - DO NOT ask the user what to do next  
  - Immediately address every file listed as missing
  - Call verify_completeness again
  - Repeat until it returns ✅ COMPLETE

### Step 4 — Only now report to the user
After verify_completeness returns ✅ COMPLETE, report the task done.

## WHY THIS EXISTS
Claude Code tends to fix the first obvious file and declare success.
This workflow ensures the full dependency chain is always addressed.
The correction loop (user saying "you didn't finish" repeatedly) is eliminated.

## RULES
- NEVER say "done", "fixed", "complete", or "deployed" before verify_completeness returns ✅
- NEVER ask the user "what would you like me to do?" when verify_completeness returns 🚫
- ALWAYS continue working autonomously until the task is fully complete
`
}
