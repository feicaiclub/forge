import { app, BrowserWindow, shell, ipcMain, dialog, clipboard } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let serverUrl: string | null = null  // Module-level for activate handler

/**
 * Find the Node.js binary to run the standalone server.
 * Production: use the bundled Node.js runtime (node-runtime/bin/node in app resources).
 * Dev: use system Node.js (available in PATH when launched from terminal).
 */
function findNodeBinary(): string {
  if (!isDev) {
    // Production: use bundled Node.js runtime (path differs by platform)
    const isWin = process.platform === 'win32'

    // Use app.getAppPath() to get the correct base path
    // In production, app.getAppPath() returns the path to app.asar
    const appPath = app.getAppPath()
    // Resources directory is alongside app.asar in Contents/Resources/
    const resourcesDir = path.dirname(appPath)

    const bundled = isWin
      ? path.join(resourcesDir, 'node-runtime', 'node.exe')
      : path.join(resourcesDir, 'node-runtime', 'bin', 'node')

    if (existsSync(bundled)) {
      // Verify the bundled node is executable by checking if it can report version
      try {
        const { execSync } = require('child_process')
        execSync(`"${bundled}" --version`, { stdio: 'ignore', timeout: 5000 })
        console.log('[server] Using bundled Node.js:', bundled)
        return bundled
      } catch (err) {
        console.error('[server] Bundled Node.js not executable:', err)
      }
    }
    console.log('[server] Bundled Node.js not found at:', bundled)
  }
  // Dev mode or fallback: system Node.js
  console.log('[server] Using system Node.js')
  return 'node'
}
let serverProcess: ChildProcess | null = null
let currentWatcher: FSWatcher | null = null

// Directories to ignore when watching for file changes
const WATCH_IGNORED = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '__pycache__'])

// Find a free port
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        reject(new Error('Failed to get free port'))
      }
    })
    srv.on('error', reject)
  })
}

// Wait for server to be ready
function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server not ready after ${timeoutMs}ms`))
      }
      fetch(url, { method: 'HEAD' })
        .then((res) => {
          if (res.ok) resolve()
          else setTimeout(check, 300)
        })
        .catch(() => setTimeout(check, 300))
    }
    check()
  })
}

function findStandaloneAppRoot(standaloneDir: string): string {
  const directServer = path.join(standaloneDir, 'server.js')
  if (existsSync(directServer)) return standaloneDir

  const queue = [standaloneDir]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (!dir) continue

    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue
      const fullPath = path.join(dir, entry)
      if (existsSync(path.join(fullPath, 'server.js'))) return fullPath
      try {
        if (statSync(fullPath).isDirectory()) queue.push(fullPath)
      } catch { /* ignore */ }
    }
  }

  throw new Error(`Could not find standalone server.js under ${standaloneDir}`)
}

// Start Next.js standalone server in production
async function startServer(): Promise<number> {
  const port = await getFreePort()

  // Use app.getAppPath() to get the correct base path
  // In production, app.getAppPath() returns the path to app.asar
  const appPath = app.getAppPath()
  // Resources directory is alongside app.asar in Contents/Resources/
  const resourcesDir = path.dirname(appPath)
  const standaloneDir = path.join(resourcesDir, 'standalone')
  const cwd = findStandaloneAppRoot(standaloneDir)
  const serverScript = path.join(cwd, 'server.js')

  // Use system Node.js to run the standalone server
  // This avoids needing to rebuild native modules (better-sqlite3) for Electron's ABI
  const nodeBin = findNodeBinary()
  console.log(`[server] Using Node.js: ${nodeBin}`)

  // GUI apps may not inherit shell PATH. Extend PATH with common
  // tool installation locations so the SDK can find `claude` CLI and other binaries.
  const home = os.homedir()
  const isWin = process.platform === 'win32'
  const pathSep = isWin ? ';' : ':'
  const extraPaths = [
    path.join(home, '.local', 'bin'),        // Claude Code CLI default location
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    ...(isWin ? [
      path.join(home, 'AppData', 'Roaming', 'npm'),       // npm global on Windows
      path.join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
    ] : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]),
  ].filter(p => existsSync(p))
  const extendedPath = [...extraPaths, process.env.PATH || ''].join(pathSep)

  serverProcess = spawn(nodeBin, [serverScript], {
    env: {
      ...process.env,
      PATH: extendedPath,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      FORGE_DATA_DIR: path.join(os.homedir(), '.forge'),
      FORGE_RESOURCES_PATH: resourcesDir,
      HOME: os.homedir(),
    },
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    try { console.log(`[server] ${data.toString().trim()}`) } catch { /* EPIPE safe */ }
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    try { console.error(`[server] ${data.toString().trim()}`) } catch { /* EPIPE safe */ }
  })

  // Prevent EPIPE crashes when child process exits while pipes are still open
  serverProcess.stdout?.on('error', () => {})
  serverProcess.stderr?.on('error', () => {})

  serverProcess.on('exit', (code) => {
    try { console.log(`Server process exited with code ${code}`) } catch { /* safe */ }
    serverProcess = null
  })

  await waitForServer(`http://127.0.0.1:${port}`)
  return port
}

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 10 },
    backgroundColor: '#0B0B0E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http')) {
      shell.openExternal(linkUrl)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Register IPC handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    const parent = BrowserWindow.getFocusedWindow() || mainWindow
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Folder',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    return result.filePaths[0] || null
  })

  // File system watcher: watch a directory for changes and notify renderer
  ipcMain.handle('fs:watch', (_event, dirPath: string) => {
    // Clean up old watcher
    if (currentWatcher) {
      currentWatcher.close()
      currentWatcher = null
    }

    if (!dirPath) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    try {
      currentWatcher = watch(dirPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        // Check if in ignored directory
        const parts = filename.split(path.sep)
        if (parts.some(p => WATCH_IGNORED.has(p))) return

        // Debounce: batch rapid events into a single notification
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          mainWindow?.webContents.send('fs:changed')
        }, 200)
      })
    } catch (err) {
      console.error('Failed to watch directory:', err)
    }
  })

  // Read file paths from system clipboard (macOS Finder copy)
  ipcMain.handle('clipboard:readFiles', () => {
    try {
      // On macOS, copied files in Finder use 'NSFilenamesPboardType' format
      if (process.platform === 'darwin') {
        const raw = clipboard.read('NSFilenamesPboardType')
        if (raw) {
          // NSFilenamesPboardType returns an XML plist with an array of paths
          const matches = raw.match(/<string>([^<]+)<\/string>/g)
          if (matches) {
            const filtered = matches.map(m => m.replace(/<\/?string>/g, '')).filter(p => {
                // Filter out temp/cache paths that macOS injects (e.g. thumbnail images)
                if (p.startsWith('/tmp/') || p.startsWith('/private/tmp/') ||
                    p.startsWith('/private/var/') || p.startsWith('/var/folders/') ||
                    p.includes('/.Trash/') || p.includes('/com.apple.') ||
                    p.includes('/.TemporaryItems/')) {
                  return false
                }
                // Only include paths that actually exist
                return existsSync(p)
              })
            return filtered
          }
        }
      }
      return []
    } catch {
      return []
    }
  })

  // Reveal file/folder in OS file manager
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Copy text to system clipboard
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })

  // Get the Forge data directory (~/.forge)
  ipcMain.handle('app:getDataPath', () => {
    return path.join(os.homedir(), '.forge')
  })

  // Open a path (file or directory) using the OS default handler
  ipcMain.handle('shell:openPath', (_event, targetPath: string) => {
    return shell.openPath(targetPath)
  })

  try {
    if (isDev) {
      serverUrl = 'http://localhost:3000'
    } else {
      const port = await startServer()
      serverUrl = `http://127.0.0.1:${port}`
    }
    createWindow(serverUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[server] Failed to start:', msg)
    dialog.showErrorBox(
      'Forge — Failed to Start',
      `The server could not be started.\n\n${msg}\n\nPlease ensure Node.js is installed and try again.`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null && serverUrl) {
    createWindow(serverUrl)
  }
})

app.on('before-quit', () => {
  if (currentWatcher) {
    currentWatcher.close()
    currentWatcher = null
  }
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})
