#!/usr/bin/env node
/**
 * CafePOS-Setup.exe  — Instalador autocontenido
 * Compilado con pkg: los archivos de la app van embebidos en el .exe
 *
 * Lo que hace:
 *  1. Extrae dist/, print-server/, public/, serve-pos.cjs → C:\CafePOS\
 *  2. Descarga e instala Node.js 20 LTS si no está presente
 *  3. Descarga NSSM y crea los servicios CafePOS y CafePrintServer
 *  4. Configura el modo kiosco (Chrome/Edge pantalla completa, sin barra)
 *  5. Bloquea el gestor de tareas y shortcuts del sistema
 *  6. Crea tarea de inicio automático: Windows arranca → POS en pantalla completa
 *  7. Acceso directo en el Escritorio
 */

'use strict'
const fs       = require('fs')
const path     = require('path')
const https    = require('https')
const http     = require('http')
const os       = require('os')
const readline = require('readline')
const { execFileSync, execSync, spawnSync } = require('child_process')

const INSTALL_DIR = 'C:\\CafePOS'
const NODE_URL    = 'https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi'
const NSSM_URL    = 'https://nssm.cc/release/nssm-2.24.zip'

const C = {
  reset:  '\x1b[0m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
}

function log(msg)   { console.log(`  ${msg}`) }
function step(msg)  { console.log(`\n${C.cyan}  >> ${msg}${C.reset}`) }
function ok(msg)    { console.log(`${C.green}     OK  ${msg}${C.reset}`) }
function warn(msg)  { console.log(`${C.yellow}     AVISO: ${msg}${C.reset}`) }
function err(msg)   { console.log(`${C.red}     ERROR: ${msg}${C.reset}`) }

// ── Descarga con barra de progreso ────────────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const file  = fs.createWriteStream(dest)
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        try { fs.unlinkSync(dest) } catch {}
        return download(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        return reject(new Error(`HTTP ${res.statusCode} para ${url}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0
      res.on('data', (chunk) => {
        received += chunk.length
        if (total > 0) {
          const pct = Math.floor((received / total) * 100)
          process.stdout.write(`\r     Descargando... ${pct}%   `)
        }
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve() })
      file.on('error', reject)
    }).on('error', reject)
  })
}

// ── Copiar directorio embebido (snapshot pkg → filesystem real) ───────────────
function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
  let entries
  try { entries = fs.readdirSync(src, { withFileTypes: true }) }
  catch { return }
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else {
      try {
        const data = fs.readFileSync(s)   // lee del snapshot (virtual)
        fs.writeFileSync(d, data)          // escribe al filesystem real
      } catch {}
    }
  }
}

// ── Ejecutar PowerShell ───────────────────────────────────────────────────────
function ps(cmd, opts = {}) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
    timeout: opts.timeout || 30000,
    stdio: opts.silent ? 'pipe' : 'inherit',
  })
}

// ── Localizar node.exe en el sistema ─────────────────────────────────────────
function findNode() {
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]
  // También buscar en PATH
  try {
    const r = spawnSync('where', ['node'], { timeout: 3000 })
    if (r.status === 0) {
      const first = r.stdout.toString().split('\n')[0].trim()
      if (first) candidates.unshift(first)
    }
  } catch {}

  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { timeout: 3000 })
      if (r.status === 0) {
        const ver   = r.stdout.toString().trim()
        const major = parseInt(ver.replace('v', '').split('.')[0], 10)
        if (major >= 18) return { path: c, version: ver }
      }
    } catch {}
  }
  return null
}

// ── Servicio Windows con NSSM ─────────────────────────────────────────────────
function installService(nssmExe, name, displayName, desc, nodeExe, scriptPath) {
  // Eliminar servicio si ya existe
  try { execFileSync('sc', ['stop',   name], { stdio: 'pipe', timeout: 8000 }) } catch {}
  try { execFileSync('sc', ['delete', name], { stdio: 'pipe', timeout: 8000 }) } catch {}
  // Pequeña espera para que sc.exe libere el nombre
  const t = Date.now() + 1500; while (Date.now() < t) {}

  if (fs.existsSync(nssmExe)) {
    const cmds = [
      ['install',    name, nodeExe],
      ['set', name, 'AppParameters',  scriptPath],
      ['set', name, 'DisplayName',    displayName],
      ['set', name, 'Description',    desc],
      ['set', name, 'Start',          'SERVICE_AUTO_START'],
      ['set', name, 'AppDirectory',   INSTALL_DIR],
      ['set', name, 'AppStdout',      path.join(INSTALL_DIR, 'logs', `${name}.log`)],
      ['set', name, 'AppStderr',      path.join(INSTALL_DIR, 'logs', `${name}-err.log`)],
      ['set', name, 'AppRotateFiles', '1'],
      ['set', name, 'AppRotateBytes', '1048576'],
    ]
    for (const args of cmds) {
      try { execFileSync(nssmExe, args, { stdio: 'pipe', timeout: 8000 }) } catch {}
    }
  } else {
    // Fallback: sc.exe
    const binPath = `"${nodeExe}" "${scriptPath}"`
    try {
      execFileSync('sc', ['create', name,
        `binPath= ${binPath}`,
        `DisplayName= ${displayName}`,
        'start= auto',
      ], { stdio: 'pipe', timeout: 10000 })
      execFileSync('sc', ['description', name, desc], { stdio: 'pipe', timeout: 5000 })
    } catch {}
  }
}

// ── Configurar Modo Kiosco ────────────────────────────────────────────────────
function configurarKiosco() {
  step('Configurando modo kiosco...')

  // 1. Bloquear Gestor de Tareas (Ctrl+Alt+Del → Administrador de Tareas)
  try {
    ps(`
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name DisableTaskMgr -Value 1 -Type DWord -Force
`, { silent: true })
    ok('Gestor de tareas bloqueado')
  } catch { warn('No se pudo bloquear gestor de tareas') }

  // 2. Ocultar la barra de tareas automáticamente
  try {
    ps(`
$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3'
if (Test-Path $regPath) {
  $val = (Get-ItemProperty -Path $regPath -Name Settings).Settings
  $val[8] = 3   # bit de auto-ocultar
  Set-ItemProperty -Path $regPath -Name Settings -Value $val
}
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Start-Process explorer
`, { silent: true })
    ok('Barra de tareas en auto-ocultar')
  } catch { warn('No se pudo configurar barra de tareas') }

  // 3. Fondo de pantalla negro (para que no se vea el escritorio si el kiosco falla)
  try {
    const logoSrc = path.join(INSTALL_DIR, 'public', 'logo.png')
    ps(`
Add-Type -TypeDefinition '
using System;using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
'
[Wallpaper]::SystemParametersInfo(20, 0, "${logoSrc.replace(/\\/g, '\\\\')}", 3)
`, { silent: true })
    ok('Fondo de pantalla configurado')
  } catch { warn('No se pudo cambiar fondo de pantalla') }

  // 4. Deshabilitar el menú contextual del escritorio
  try {
    ps(`
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name NoViewContextMenu -Value 1 -Type DWord -Force
`, { silent: true })
    ok('Menú contextual desactivado')
  } catch {}

  // 5. Tarea programada: al iniciar sesión → Chrome/Edge en kiosco
  try {
    const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Delay>PT5S</Delay>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Priority>4</Priority>
  </Settings>
  <Actions>
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c start "" "chrome" --kiosk --app=http://localhost:3000 --disable-infobars --no-first-run --disable-translate --autoplay-policy=no-user-gesture-required 2>nul || start "" "msedge" --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run 2>nul</Arguments>
    </Exec>
  </Actions>
</Task>`

    const taskPath = path.join(os.tmpdir(), 'cafePOS_kiosk.xml')
    fs.writeFileSync(taskPath, taskXml, 'utf16le')
    execFileSync('schtasks', [
      '/create', '/tn', 'CafePOS_Kiosk', '/xml', taskPath, '/f'
    ], { stdio: 'pipe', timeout: 15000 })
    try { fs.unlinkSync(taskPath) } catch {}
    ok('Kiosco: tarea de inicio registrada (abre POS al iniciar sesión)')
  } catch (e) { warn(`Tarea de inicio: ${e.message}`) }

  // 6. Desactivar hot-keys del sistema en Chrome que podrían escapar del kiosco
  // (Se hace vía flags de Chrome ya incluidos en el comando arriba)
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.clear()
  console.log()
  console.log(`${C.yellow}${C.bold}  ╔══════════════════════════════════════════════╗${C.reset}`)
  console.log(`${C.yellow}${C.bold}  ║   CAFE POS — INSTALADOR v2.0                 ║${C.reset}`)
  console.log(`${C.yellow}${C.bold}  ║   El Cafe del Constructor                    ║${C.reset}`)
  console.log(`${C.yellow}${C.bold}  ╚══════════════════════════════════════════════╝${C.reset}`)
  console.log()

  // ── 1. Verificar directorio de archivos embebidos ────────────────────────
  // En el exe compilado con pkg, __dirname es la ruta virtual del snapshot
  // Los assets están en path.join(__dirname, '..') porque setup.js está en installer/
  const ASSETS_ROOT = path.join(__dirname, '..')
  const DIST_SRC    = path.join(ASSETS_ROOT, 'dist')
  const PS_SRC      = path.join(ASSETS_ROOT, 'print-server')
  const PUB_SRC     = path.join(ASSETS_ROOT, 'public')
  const SERVE_SRC   = path.join(ASSETS_ROOT, 'serve-pos.cjs')

  if (!fs.existsSync(DIST_SRC)) {
    err(`No se encontró: ${DIST_SRC}`)
    err('El ejecutable está incompleto. Descárgalo de nuevo.')
    await pause()
    process.exit(1)
  }

  // ── 2. Node.js ────────────────────────────────────────────────────────────
  step('Verificando Node.js...')
  let nodeInfo = findNode()
  let nodeExe

  if (nodeInfo) {
    ok(`Node.js ${nodeInfo.version} detectado`)
    nodeExe = nodeInfo.path
  } else {
    step('Descargando Node.js 20 LTS...')
    const msiPath = path.join(os.tmpdir(), 'node20_installer.msi')
    await download(NODE_URL, msiPath)
    step('Instalando Node.js (puede tardar 1–2 minutos)...')
    execFileSync('msiexec', ['/i', msiPath, '/qn', 'ADDLOCAL=ALL'], { timeout: 180000 })
    try { fs.unlinkSync(msiPath) } catch {}
    // Refrescar y buscar de nuevo
    nodeInfo = findNode()
    nodeExe  = nodeInfo ? nodeInfo.path : 'C:\\Program Files\\nodejs\\node.exe'
    ok(`Node.js instalado → ${nodeExe}`)
  }
  // Normalizar a ruta completa
  if (nodeExe === 'node' || !path.isAbsolute(nodeExe)) {
    nodeExe = 'C:\\Program Files\\nodejs\\node.exe'
  }

  // ── 3. Extraer archivos a C:\CafePOS\ ────────────────────────────────────
  step(`Instalando en ${INSTALL_DIR} ...`)

  // Detener servicios existentes antes de copiar
  for (const svc of ['CafePOS', 'CafePrintServer']) {
    try { execFileSync('sc', ['stop', svc], { stdio: 'pipe', timeout: 8000 }) } catch {}
  }
  const wait = Date.now() + 2000; while (Date.now() < wait) {}

  if (!fs.existsSync(INSTALL_DIR)) fs.mkdirSync(INSTALL_DIR, { recursive: true })
  fs.mkdirSync(path.join(INSTALL_DIR, 'logs'), { recursive: true })

  log(`${C.gray}  dist/ ...${C.reset}`)
  copyDir(DIST_SRC, path.join(INSTALL_DIR, 'dist'))

  log(`${C.gray}  print-server/ ...${C.reset}`)
  copyDir(PS_SRC, path.join(INSTALL_DIR, 'print-server'))

  if (fs.existsSync(PUB_SRC)) {
    log(`${C.gray}  public/ ...${C.reset}`)
    copyDir(PUB_SRC, path.join(INSTALL_DIR, 'public'))
  }

  log(`${C.gray}  serve-pos.cjs ...${C.reset}`)
  const serveData = fs.readFileSync(SERVE_SRC)
  fs.writeFileSync(path.join(INSTALL_DIR, 'serve-pos.cjs'), serveData)

  ok('Archivos copiados')

  // ── 4. Descargar NSSM ─────────────────────────────────────────────────────
  step('Preparando gestor de servicios...')
  const nssmExe = path.join(INSTALL_DIR, 'nssm.exe')

  if (!fs.existsSync(nssmExe)) {
    try {
      const nssmZip = path.join(os.tmpdir(), 'nssm.zip')
      const nssmTmp = path.join(os.tmpdir(), 'nssm_ext')
      await download(NSSM_URL, nssmZip)
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${nssmZip}' -DestinationPath '${nssmTmp}' -Force`
      ], { timeout: 30000 })

      // Buscar nssm.exe recursivamente
      const findFile = (dir, name) => {
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) { const r = findFile(path.join(dir, e.name), name); if (r) return r }
            else if (e.name === name) return path.join(dir, e.name)
          }
        } catch {}
        return null
      }
      // Preferir win64
      const nssm64 = path.join(nssmTmp, 'nssm-2.24', 'win64', 'nssm.exe')
      const nssmSrc = fs.existsSync(nssm64) ? nssm64 : findFile(nssmTmp, 'nssm.exe')

      if (nssmSrc) {
        fs.copyFileSync(nssmSrc, nssmExe)
        ok('NSSM listo')
      } else {
        warn('NSSM no encontrado en el ZIP — servicios via sc.exe')
      }
      try { fs.unlinkSync(nssmZip) } catch {}
      try { fs.rmSync(nssmTmp, { recursive: true, force: true }) } catch {}
    } catch (e) {
      warn(`NSSM: ${e.message} — se usará sc.exe`)
    }
  } else {
    ok('NSSM ya presente')
  }

  // ── 5. Crear servicios ────────────────────────────────────────────────────
  step('Registrando servicios Windows (inicio automático)...')

  installService(
    nssmExe,
    'CafePOS', 'Cafe POS — Servidor Web',
    'Sirve el POS en http://localhost:3000',
    nodeExe,
    path.join(INSTALL_DIR, 'serve-pos.cjs')
  )
  ok('Servicio CafePOS registrado')

  installService(
    nssmExe,
    'CafePrintServer', 'Cafe POS — Servidor de Impresion',
    'ESC/POS en http://localhost:3002',
    nodeExe,
    path.join(INSTALL_DIR, 'print-server', 'server.cjs')
  )
  ok('Servicio CafePrintServer registrado')

  // ── 6. Iniciar servicios ──────────────────────────────────────────────────
  step('Iniciando servicios...')
  try { execFileSync('sc', ['start', 'CafePOS'],         { stdio: 'pipe', timeout: 12000 }); ok('CafePOS corriendo') }         catch { warn('CafePOS: inicia al reiniciar Windows') }
  try { execFileSync('sc', ['start', 'CafePrintServer'], { stdio: 'pipe', timeout: 12000 }); ok('CafePrintServer corriendo') } catch { warn('CafePrintServer: inicia al reiniciar Windows') }

  // ── 7. Modo Kiosco ────────────────────────────────────────────────────────
  configurarKiosco()

  // ── 8. Scripts de administración ──────────────────────────────────────────
  step('Creando scripts de administración...')

  fs.writeFileSync(path.join(INSTALL_DIR, 'actualizar.bat'), [
    '@echo off',
    'echo.',
    'echo  CAFE POS - Actualizador',
    'echo  ========================',
    'if "%~1"=="" (',
    '  echo Arrastra la nueva carpeta dist sobre este archivo.',
    '  pause & exit /b 1',
    ')',
    'if not exist "%~1\\index.html" (',
    '  echo ERROR: La carpeta no contiene index.html',
    '  pause & exit /b 1',
    ')',
    'net stop CafePOS >nul 2>&1',
    'timeout /t 2 /nobreak >nul',
    `rd /s /q "${INSTALL_DIR}\\dist" 2>nul`,
    `xcopy /e /i /y "%~1" "${INSTALL_DIR}\\dist\\"`,
    'net start CafePOS',
    'echo.',
    'echo  Actualizado. Recarga el navegador (F5).',
    'pause',
  ].join('\r\n'), 'ascii')

  fs.writeFileSync(path.join(INSTALL_DIR, 'iniciar-cafe-pos.bat'), [
    '@echo off',
    'title Cafe POS',
    'net start CafePOS >nul 2>&1',
    'net start CafePrintServer >nul 2>&1',
    'timeout /t 3 /nobreak >nul',
    'start "" "chrome" --kiosk --app=http://localhost:3000 --disable-infobars --no-first-run 2>nul',
    'if errorlevel 1 start "" "msedge" --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run 2>nul',
    'if errorlevel 1 start http://localhost:3000',
  ].join('\r\n'), 'ascii')

  ok('Scripts de administración creados')

  // ── 9. Auto-login de Windows (sin contraseña al encender) ───────────────
  step('Configurando inicio de sesión automático...')
  try {
    // Obtener el usuario actual
    const whoami = execSync('whoami', { timeout: 3000 }).toString().trim()
    const username = whoami.includes('\\') ? whoami.split('\\')[1] : whoami

    ps(`
$winlogon = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
Set-ItemProperty -Path $winlogon -Name AutoAdminLogon     -Value '1'    -Type String -Force
Set-ItemProperty -Path $winlogon -Name DefaultUsername    -Value '${username}' -Type String -Force
Set-ItemProperty -Path $winlogon -Name DefaultPassword    -Value ''     -Type String -Force
Set-ItemProperty -Path $winlogon -Name DefaultDomainName  -Value '.'    -Type String -Force
`, { silent: true })
    ok(`Auto-login configurado para usuario: ${username}`)
    log(`${C.gray}    Al encender: Windows inicia solo → servicios arrancan → POS abre automáticamente${C.reset}`)
  } catch (e) {
    warn(`Auto-login: ${e.message}`)
    warn('Configúralo manualmente en: Panel de control → Cuentas de usuario → Quitar contraseña')
  }

  // ── 10. Accesos directos ──────────────────────────────────────────────────
  step('Creando accesos directos...')
  const desktop = 'C:\\Users\\Public\\Desktop'
  try {
    ps(`
$ws = New-Object -ComObject WScript.Shell

$s = $ws.CreateShortcut('${desktop}\\Cafe POS.lnk')
$s.TargetPath       = '${INSTALL_DIR}\\iniciar-cafe-pos.bat'
$s.WorkingDirectory = '${INSTALL_DIR}'
$s.Description      = 'El Cafe del Constructor - Sistema POS'
$s.WindowStyle      = 1
$s.Save()

$u = $ws.CreateShortcut('${desktop}\\Actualizar Cafe POS.lnk')
$u.TargetPath       = '${INSTALL_DIR}\\actualizar.bat'
$u.WorkingDirectory = '${INSTALL_DIR}'
$u.Description      = 'Actualiza el Cafe POS sin reinstalar'
$u.WindowStyle      = 1
$u.Save()
`, { silent: true })
    ok('Accesos directos en Escritorio (todos los usuarios)')
  } catch (e) { warn(`Accesos directos: ${e.message}`) }

  // ── RESUMEN ────────────────────────────────────────────────────────────────
  console.log()
  console.log(`${C.green}${C.bold}  ╔══════════════════════════════════════════════════╗${C.reset}`)
  console.log(`${C.green}${C.bold}  ║   INSTALACION COMPLETADA                         ║${C.reset}`)
  console.log(`${C.green}${C.bold}  ╠══════════════════════════════════════════════════╣${C.reset}`)
  console.log(`${C.green}  ║  POS:       http://localhost:3000                 ║${C.reset}`)
  console.log(`${C.green}  ║  Impresion: http://localhost:3002                 ║${C.reset}`)
  console.log(`${C.green}  ║                                                   ║${C.reset}`)
  console.log(`${C.green}  ║  Servicios inician AUTOMATICAMENTE con Windows    ║${C.reset}`)
  console.log(`${C.green}  ║  El POS abre solo al encender el panel tactil     ║${C.reset}`)
  console.log(`${C.green}  ║                                                   ║${C.reset}`)
  console.log(`${C.green}  ║  Para actualizar sin reinstalar:                  ║${C.reset}`)
  console.log(`${C.green}  ║  Arrastra la nueva carpeta 'dist' sobre:          ║${C.reset}`)
  console.log(`${C.green}  ║  "Actualizar Cafe POS" del Escritorio             ║${C.reset}`)
  console.log(`${C.green}${C.bold}  ╚══════════════════════════════════════════════════╝${C.reset}`)
  console.log()

  // Abrir POS en navegador
  try { execSync('start http://localhost:3000', { stdio: 'ignore' }) } catch {}

  await pause()
}

function pause() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('  Presiona Enter para cerrar...\n', () => { rl.close(); resolve() })
  })
}

main().catch(e => {
  console.error(`\n${C.red}  ERROR FATAL: ${e.message}${C.reset}`)
  pause().then(() => process.exit(1))
})
