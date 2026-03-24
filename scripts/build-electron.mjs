import { build } from 'esbuild'
import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Step 1: Build electron main + preload with esbuild
async function buildElectron() {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['electron'],
    sourcemap: true,
    minify: false,
  }

  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.js',
    format: 'cjs',
  })

  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.js',
    format: 'cjs',
  })

  console.log('✅ Electron main + preload built')
}

// Step 2: Resolve symlinks in .next/standalone
// electron-builder cannot package symlinks — replace them with real file copies
function resolveSymlinks(dir) {
  let resolved = 0
  function walk(d) {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name)
      try {
        const stat = lstatSync(fullPath)
        if (stat.isSymbolicLink()) {
          const realPath = resolve(d, readlinkSync(fullPath))
          rmSync(fullPath, { force: true })
          try {
            const realStat = lstatSync(realPath)
            if (realStat.isDirectory()) {
              cpSync(realPath, fullPath, { recursive: true })
            } else {
              cpSync(realPath, fullPath)
            }
            resolved++
          } catch {
            // Target doesn't exist, just remove the dangling symlink
          }
        } else if (stat.isDirectory()) {
          walk(fullPath)
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }
  walk(dir)
  console.log(`✅ Resolved ${resolved} symlinks in standalone`)
}

// Step 3: Copy templates/ to .next/standalone/ for production server access
function copyTemplates(standaloneDir) {
  const src = join(process.cwd(), 'templates')
  const dest = join(standaloneDir, 'templates')
  try {
    lstatSync(src)
    cpSync(src, dest, { recursive: true })
    console.log('✅ Copied templates/ to standalone')
  } catch {
    console.log('⚠️  No templates/ directory found — skipping')
  }
}

// Main
await buildElectron()

const standaloneDir = join(process.cwd(), '.next', 'standalone')
try {
  lstatSync(standaloneDir)
  resolveSymlinks(standaloneDir)
  copyTemplates(standaloneDir)
} catch {
  console.log('⚠️  No .next/standalone found — skipping symlink resolution (dev build?)')
}
