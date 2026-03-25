import { app, BrowserWindow, shell, ipcMain, dialog, clipboard } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'

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
    // Production: use bundled Node.js runtime
    const bundled = path.join(process.resourcesPath, 'node-runtime', 'bin', 'node')
    if (existsSync(bundled)) return bundled
    console.error('[server] Bundled Node.js not found at:', bundled)
  }
  // Dev mode or fallback: system Node.js
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

// Start Next.js standalone server in production
async function startServer(): Promise<number> {
  const port = await getFreePort()
  const resourcesPath = process.resourcesPath
  const serverScript = path.join(resourcesPath, 'standalone', 'server.js')
  const cwd = path.join(resourcesPath, 'standalone')

  // Use system Node.js to run the standalone server
  // This avoids needing to rebuild native modules (better-sqlite3) for Electron's ABI
  const nodeBin = findNodeBinary()
  console.log(`[server] Using Node.js: ${nodeBin}`)
  serverProcess = spawn(nodeBin, [serverScript], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      FORGE_DATA_DIR: path.join(os.homedir(), '.forge'),
      FORGE_RESOURCES_PATH: resourcesPath,
      HOME: os.homedir(),
    },
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[server] ${data.toString().trim()}`)
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[server] ${data.toString().trim()}`)
  })

  serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`)
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
