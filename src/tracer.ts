import * as fs from 'fs'
import * as path from 'path'

export interface DependencyNode {
  file: string
  reason: string
  type: 'direct' | 'connected' | 'parent' | 'api' | 'db'
}

export interface DependencyMap {
  target: string
  nodes: DependencyNode[]
  scannedAt: string
}

// Extract all imports from a file
function extractImports(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const imports: string[] = []

    // Match: import ... from '...'
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1])
    }

    // Match: require('...')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1])
    }

    return imports
  } catch {
    return []
  }
}

// Resolve @/ alias to actual path
function resolveAlias(importPath: string, projectRoot: string): string | null {
  if (importPath.startsWith('@/')) {
    return path.join(projectRoot, 'src', importPath.slice(2))
  }
  return null
}

// Find all files that import the target file
function findFilesImporting(targetFile: string, allFiles: string[], projectRoot: string): string[] {
  const importers: string[] = []
  const targetBase = targetFile.replace(path.join(projectRoot, 'src') + '/', '@/')

  for (const file of allFiles) {
    const imports = extractImports(file)
    for (const imp of imports) {
      const resolved = resolveAlias(imp, projectRoot)
      if (resolved && targetFile.startsWith(resolved)) {
        importers.push(file)
        break
      }
      // Also check by name
      if (targetFile.includes(imp.replace('@/', ''))) {
        importers.push(file)
        break
      }
    }
  }

  return importers
}

// Get all TypeScript/JavaScript files in project
function getAllProjectFiles(projectRoot: string): string[] {
  const files: string[] = []
  const srcDir = path.join(projectRoot, 'src')

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.name === 'node_modules') continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          files.push(fullPath)
        }
      }
    } catch {}
  }

  walk(srcDir)
  return files
}

// Find API routes connected to a component
function findConnectedApiRoutes(filePath: string, projectRoot: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const routes: string[] = []

    // Match fetch('/api/...') calls
    const fetchRegex = /fetch\s*\(\s*['"`](\/api\/[^'"`]+)['"`]/g
    let match
    while ((match = fetchRegex.exec(content)) !== null) {
      const apiPath = match[1]
      // Find the actual file
      const routePath = path.join(projectRoot, 'src', 'app', apiPath, 'route.ts')
      const routePathJs = path.join(projectRoot, 'src', 'app', apiPath, 'route.js')
      if (fs.existsSync(routePath)) routes.push(routePath)
      else if (fs.existsSync(routePathJs)) routes.push(routePathJs)
    }

    return routes
  } catch {
    return []
  }
}

// Find Supabase table references
function findSupabaseConnections(filePath: string, projectRoot: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const connections: string[] = []

    // If file uses supabase client, flag service.ts and client.ts
    if (content.includes('supabase') || content.includes('createClient')) {
      const clientPath = path.join(projectRoot, 'src', 'lib', 'supabase', 'client.ts')
      const serverPath = path.join(projectRoot, 'src', 'lib', 'supabase', 'server.ts')
      const servicePath = path.join(projectRoot, 'src', 'lib', 'supabase', 'service.ts')
      if (fs.existsSync(clientPath)) connections.push(clientPath)
      if (fs.existsSync(serverPath)) connections.push(serverPath)
      if (fs.existsSync(servicePath)) connections.push(servicePath)
    }

    return connections
  } catch {
    return []
  }
}

// Main tracer function
export function traceDepedencies(targetFileName: string, projectRoot: string): DependencyMap {
  const allFiles = getAllProjectFiles(projectRoot)

  // Find the target file
  const targetFile = allFiles.find(f =>
    f.includes(targetFileName) ||
    f.endsWith(targetFileName)
  )

  if (!targetFile) {
    return {
      target: targetFileName,
      nodes: [],
      scannedAt: new Date().toISOString()
    }
  }

  const nodes: DependencyNode[] = []
  const seen = new Set<string>()

  // Add target itself
  nodes.push({
    file: targetFile.replace(projectRoot + '/', ''),
    reason: 'Target file — direct change required',
    type: 'direct'
  })
  seen.add(targetFile)

  // Find what target imports (dependencies)
  const imports = extractImports(targetFile)
  for (const imp of imports) {
    const resolved = resolveAlias(imp, projectRoot)
    if (resolved) {
      // Try with extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '']
      for (const ext of extensions) {
        const full = resolved + ext
        if (fs.existsSync(full) && !seen.has(full)) {
          seen.add(full)
          nodes.push({
            file: full.replace(projectRoot + '/', ''),
            reason: `Imported by target — changes here may affect behavior`,
            type: 'connected'
          })
          break
        }
      }
    }
  }

  // Find files that import the target (parents)
  const importers = findFilesImporting(targetFile, allFiles, projectRoot)
  for (const importer of importers) {
    if (!seen.has(importer)) {
      seen.add(importer)
      nodes.push({
        file: importer.replace(projectRoot + '/', ''),
        reason: `Imports target — may need updates if interface changes`,
        type: 'parent'
      })
    }
  }

  // Find connected API routes
  const apiRoutes = findConnectedApiRoutes(targetFile, projectRoot)
  for (const route of apiRoutes) {
    if (!seen.has(route)) {
      seen.add(route)
      nodes.push({
        file: route.replace(projectRoot + '/', ''),
        reason: `API route called by target — must be checked for completeness`,
        type: 'api'
      })
    }
  }

  // Find Supabase connections
  const dbConnections = findSupabaseConnections(targetFile, projectRoot)
  for (const db of dbConnections) {
    if (!seen.has(db)) {
      seen.add(db)
      nodes.push({
        file: db.replace(projectRoot + '/', ''),
        reason: `Database layer used by target — schema/RLS changes may be needed`,
        type: 'db'
      })
    }
  }

  return {
    target: targetFile.replace(projectRoot + '/', ''),
    nodes,
    scannedAt: new Date().toISOString()
  }
}
