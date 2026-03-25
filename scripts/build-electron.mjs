import { build } from 'esbuild'
import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

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

// Step 4: Strip developer machine paths from standalone build output.
// Next.js embeds the build machine's absolute path in compiled output
// (server.js, required-server-files.json, route bundles in .next/server/).
// Replace with /app to prevent privacy leaks.
// CRITICAL: Skip node_modules/ entirely — replacing paths there breaks module resolution.
function stripDevPaths(standaloneDir) {
  const projectRoot = process.cwd()
  let replaced = 0

  // Strip top-level server.js
  for (const name of ['server.js']) {
    const fp = join(standaloneDir, name)
    try {
      const content = readFileSync(fp, 'utf-8')
      if (content.includes(projectRoot)) {
        writeFileSync(fp, content.replaceAll(projectRoot, '/app'), 'utf-8')
        replaced++
      }
    } catch { /* skip */ }
  }

  // Strip .next/ directory recursively (compiled route bundles, metadata)
  // but NEVER touch node_modules/
  function walkAndStrip(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue  // CRITICAL: skip node_modules
      const fullPath = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          walkAndStrip(fullPath)
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
          const content = readFileSync(fullPath, 'utf-8')
          if (content.includes(projectRoot)) {
            writeFileSync(fullPath, content.replaceAll(projectRoot, '/app'), 'utf-8')
            replaced++
          }
        }
      } catch { /* skip unreadable */ }
    }
  }

  walkAndStrip(join(standaloneDir, '.next'))
  console.log(`✅ Stripped developer paths from ${replaced} file(s)`)
}

// Step 5: Remove .forge-data/ from standalone if it leaked in
function cleanForgeData(standaloneDir) {
  const forgeData = join(standaloneDir, '.forge-data')
  try {
    lstatSync(forgeData)
    rmSync(forgeData, { recursive: true, force: true })
    console.log('✅ Removed .forge-data/ from standalone (privacy)')
  } catch { /* doesn't exist, good */ }
}

// Step 6: Download and bundle Node.js runtime for the packaged app.
// Eliminates dependency on user having a specific Node.js version installed.
async function bundleNodeRuntime() {
  const NODE_VERSION = '22.22.2'
  const arch = process.arch  // arm64 or x64
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win' : 'linux'
  const ext = platform === 'win' ? 'zip' : 'tar.gz'
  const dirName = `node-v${NODE_VERSION}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${dirName}.${ext}`
  const dest = join(process.cwd(), 'node-runtime')

  // Skip if already downloaded
  const nodeBin = join(dest, 'bin', 'node')
  if (existsSync(nodeBin)) {
    const ver = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
    if (ver === `v${NODE_VERSION}`) {
      console.log(`✅ Node.js runtime already bundled (${ver})`)
      return
    }
  }

  console.log(`⬇️  Downloading Node.js ${NODE_VERSION} (${platform}-${arch})...`)
  rmSync(dest, { recursive: true, force: true })

  const tarball = join(process.cwd(), `node-runtime.${ext}`)
  execSync(`curl -sL "${url}" -o "${tarball}"`)
  mkdirSync(dest, { recursive: true })
  execSync(`tar -xzf "${tarball}" --strip-components=1 -C "${dest}"`)
  rmSync(tarball, { force: true })

  // Remove unnecessary files to reduce size (keep only bin/node)
  for (const dir of ['include', 'share', 'lib']) {
    rmSync(join(dest, dir), { recursive: true, force: true })
  }
  // Remove npm/npx/corepack from bin (only need node)
  const binDir = join(dest, 'bin')
  for (const entry of readdirSync(binDir)) {
    if (entry !== 'node') {
      rmSync(join(binDir, entry), { force: true })
    }
  }

  const finalVer = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
  console.log(`✅ Node.js runtime bundled (${finalVer})`)
}

// Step 7: Rebuild better-sqlite3 against the bundled Node.js version
function rebuildNativeModules() {
  const nodeBin = join(process.cwd(), 'node-runtime', 'bin', 'node')
  if (!existsSync(nodeBin)) {
    console.log('⚠️  No bundled Node.js found — skipping native module rebuild')
    return
  }

  const nodeVersion = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
  const currentVersion = process.version

  if (nodeVersion === currentVersion) {
    console.log(`✅ Native modules already built for ${nodeVersion}`)
    return
  }

  console.log(`🔨 Rebuilding better-sqlite3 for ${nodeVersion}...`)
  // Use the bundled Node's headers for native module compilation
  const nodeDir = join(process.cwd(), 'node-runtime')
  try {
    execSync(`npx --yes node-gyp rebuild --release --target=${nodeVersion.replace('v','')} --nodedir="${nodeDir}"`, {
      cwd: join(process.cwd(), 'node_modules', '.pnpm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3'),
      stdio: 'pipe',
      env: { ...process.env, npm_config_nodedir: nodeDir },
    })
    console.log(`✅ better-sqlite3 rebuilt for ${nodeVersion}`)
  } catch (err) {
    // Fallback: try prebuild-install
    console.log(`⚠️  node-gyp failed, trying prebuild-install...`)
    try {
      execSync(`npx --yes prebuild-install --runtime=node --target=${nodeVersion.replace('v','')}`, {
        cwd: join(process.cwd(), 'node_modules', '.pnpm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3'),
        stdio: 'pipe',
      })
      console.log(`✅ better-sqlite3 prebuild installed for ${nodeVersion}`)
    } catch {
      console.log(`⚠️  Could not rebuild better-sqlite3 for ${nodeVersion} — using current build`)
    }
  }
}

// Main
await buildElectron()
await bundleNodeRuntime()
rebuildNativeModules()

const standaloneDir = join(process.cwd(), '.next', 'standalone')
try {
  lstatSync(standaloneDir)
  resolveSymlinks(standaloneDir)
  cleanForgeData(standaloneDir)
  copyTemplates(standaloneDir)
  stripDevPaths(standaloneDir)
} catch {
  console.log('⚠️  No .next/standalone found — skipping symlink resolution (dev build?)')
}
