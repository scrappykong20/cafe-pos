const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

// Teclado virtual para pantallas táctiles Windows
app.commandLine.appendSwitch('enable-features', 'VirtualKeyboard')

// ── Auto-updater ─────────────────────────────────────────────────────────────
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload = true          // descarga en segundo plano sin preguntar
  autoUpdater.autoInstallOnAppQuit = true  // instala cuando el usuario cierre la app
  autoUpdater.logger = null                // silencioso
} catch (_) {
  // en desarrollo electron-updater puede no estar disponible
}

// ── Ruta base ────────────────────────────────────────────────────────────────
const BASE = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..')

let printServerProcess = null
let mainWindow = null

// ── Matar servidor de impresión sin doble-kill ───────────────────────────────
function killPrintServer () {
  if (!printServerProcess) return
  try { printServerProcess.kill() } catch (_) {}
  printServerProcess = null
}

// ── Servidor de impresión en segundo plano ───────────────────────────────────
function startPrintServer () {
  const serverPath = path.join(BASE, 'print-server', 'server.cjs')
  if (!fs.existsSync(serverPath)) {
    console.warn('[print-server] No encontrado en:', serverPath)
    return
  }

  // ELECTRON_RUN_AS_NODE=1 hace que el binario de Electron se comporte como Node.js
  // sin este flag, spawn(process.execPath) lanzaría una segunda instancia de Electron
  printServerProcess = spawn(process.execPath, [serverPath], {
    cwd: path.join(BASE, 'print-server'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    detached: false,
  })

  printServerProcess.on('error', (err) => {
    console.error('[print-server] Error al iniciar:', err.message)
    printServerProcess = null
  })

  printServerProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn('[print-server] Proceso terminó con código:', code)
    }
    printServerProcess = null
  })
}

// ── Ventana principal ────────────────────────────────────────────────────────
function createWindow () {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,               // oculta hasta que cargue — sin parpadeo blanco
    backgroundColor: '#0D0D0D',
    icon: path.join(BASE, 'public', 'logo.png'),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,  // false para que preload corra en el mismo mundo que la página
                                // (necesario para que el override de navigator.serviceWorker funcione)
      webSecurity: false,       // necesario para cargar recursos de Supabase desde file://
      preload: path.join(__dirname, 'preload.js'),
      enableBlinkFeatures: 'VirtualKeyboard',
    },
  })

  // Bloquear service worker y workbox ANTES de cargar la página.
  // Usamos <all_urls> con filtro en callback porque los patrones file://**
  // no funcionan con rutas de disco en la API webRequest de Electron.
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const u = details.url
      if (u.endsWith('/sw.js') || u.includes('/workbox-') || u.endsWith('/registerSW.js')) {
        callback({ cancel: true })
      } else {
        callback({})
      }
    }
  )

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const indexPath = path.join(BASE, 'dist', 'index.html')
  mainWindow.loadFile(indexPath)
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startPrintServer()
  createWindow()

  // Verificar actualizaciones 8 segundos después de abrir (para no retrasar el inicio)
  if (autoUpdater && app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})

      autoUpdater.on('update-downloaded', () => {
        // Notificar al usuario que hay una actualización lista
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Actualización lista',
          message: '¡Hay una nueva versión de Café POS!',
          detail: 'Se instalará automáticamente cuando cierres la aplicación.',
          buttons: ['Instalar ahora', 'Después'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(false, true)
        })
      })
    }, 8000)
  }
})

// before-quit y window-all-closed ambos pueden dispararse — killPrintServer
// maneja el caso de doble llamada de forma segura (null-check + try/catch)
app.on('window-all-closed', () => {
  killPrintServer()
  app.quit()
})

app.on('before-quit', killPrintServer)
