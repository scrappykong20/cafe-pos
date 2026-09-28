/**
 * Servidor local de impresión ESC/POS
 * - Impresoras USB/locales: Windows winspool.drv RAW (sin GDI, sin borrosidad)
 * - Impresoras de red:      TCP socket puerto 9100 (ESC/POS directo)
 * Puerto: 3002
 */
const http = require('http')
const net  = require('net')
const { execFileSync } = require('child_process')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const PORT = 3002

// ── Impresión por red TCP (IP:9100) ──────────────────────────────────────────
function imprimirRawTCP(ip, base64Data, puerto = 9100) {
  return new Promise((resolve) => {
    const buffer = Buffer.from(base64Data, 'base64')
    const client = new net.Socket()
    let done = false

    const finish = (ok) => {
      if (done) return
      done = true
      try { client.destroy() } catch {}
      resolve(ok)
    }

    client.setTimeout(6000)
    client.connect(puerto, ip, () => {
      client.write(buffer, (err) => finish(!err))
    })
    client.on('error', (err) => {
      console.error(`[tcp] Error ${ip}:${puerto} —`, err.message)
      finish(false)
    })
    client.on('timeout', () => {
      console.error(`[tcp] Timeout ${ip}:${puerto}`)
      finish(false)
    })
  })
}

// Imprime bytes RAW directamente a una impresora Windows (sin GDI)
function imprimirRaw(printerName, base64Data) {
  const psScript = `
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
  public struct DocInfo1 { public string pDocName; public string pOutputFile; public string pDatatype; }
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr h, int level, ref DocInfo1 di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  public static bool PrintRaw(string name, byte[] data) {
    IntPtr hPrinter;
    if (!OpenPrinter(name, out hPrinter, IntPtr.Zero)) return false;
    DocInfo1 di = new DocInfo1(); di.pDocName="ESC/POS"; di.pOutputFile=null; di.pDatatype="RAW";
    if (StartDocPrinter(hPrinter, 1, ref di) == 0) { ClosePrinter(hPrinter); return false; }
    StartPagePrinter(hPrinter);
    int w; WritePrinter(hPrinter, data, data.Length, out w);
    EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
    return true;
  }
}
'@
} catch {}
$bytes = [System.Convert]::FromBase64String('${base64Data.replace(/'/g, "''")}')
$ok = [RawPrinterHelper]::PrintRaw('${printerName.replace(/'/g, "''")}', $bytes)
if ($ok) { Write-Output "OK" } else { Write-Output "ERROR" }
`

  const tmpPs = path.join(os.tmpdir(), `escpos_${Date.now()}.ps1`)
  fs.writeFileSync(tmpPs, psScript, 'utf8')
  try {
    const result = execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs
    ], { timeout: 10000 }).toString().trim()
    return result.includes('OK')
  } catch (e) {
    console.error('Print error:', e.message)
    return false
  } finally {
    try { fs.unlinkSync(tmpPs) } catch {}
  }
}

// Listar impresoras instaladas
function listarImpresoras() {
  try {
    const result = execFileSync('powershell', [
      '-NoProfile', '-Command',
      'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json'
    ], { timeout: 5000 }).toString().trim()
    const parsed = JSON.parse(result)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

// Orígenes permitidos para CORS
// 'null' = app Electron empaquetada (carga file:// → origen opaco "null")
// https://localhost / capacitor://localhost = app Android/iOS (Capacitor)
const ORIGENES_PERMITIDOS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'app://.',
  'null',
  'https://localhost',
  'capacitor://localhost',
]

function esNombreImpresoraSeguro(nombre) {
  // Permite los caracteres comunes en nombres de impresora Windows (& + / @ # :).
  // Se siguen excluyendo comillas (' "), punto y coma, $ y backtick para no
  // romper la interpolación en los scripts PowerShell (imprimirRaw / clear-queue
  // ya escapan ' → '', pero mejor no dejarlos entrar).
  return typeof nombre === 'string' && /^[\w\s\-\.\(\)&+\/@#:áéíóúÁÉÍÓÚñÑ,]+$/.test(nombre) && nombre.length < 200
}

// Servidor HTTP
const server = http.createServer(async (req, res) => {
  // CORS restrictivo — solo orígenes conocidos. Sin header Origin (curl,
  // herramientas locales) se responde con el primero de la lista; el servidor
  // solo escucha en 127.0.0.1, así que el riesgo es mínimo.
  const origin = req.headers.origin || ''
  const origenPermitido = ORIGENES_PERMITIDOS.includes(origin) ? origin : ORIGENES_PERMITIDOS[0]
  res.setHeader('Access-Control-Allow-Origin', origenPermitido)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Chrome exige este header en preflights Private Network Access (https → 127.0.0.1)
  res.setHeader('Access-Control-Allow-Private-Network', 'true')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/printers') {
    const printers = listarImpresoras()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(printers))
    return
  }

  // ── Re-instalar/detectar impresoras USB conectadas después de la instalación
  // Ejecuta setup-hardware.ps1 (empaquetado junto al print-server en resources/app).
  // Sin permisos de admin solo actualiza Spooler y loguea; la instalación de la
  // cola requiere elevación (ya se hizo en el instalador del EXE).
  if (req.method === 'POST' && req.url === '/setup-printers') {
    try {
      // Empaquetado: resources/app/setup-hardware.ps1 · Desarrollo: cafe-pos/electron/
      const script = [
        path.join(__dirname, '..', 'setup-hardware.ps1'),
        path.join(__dirname, '..', 'electron', 'setup-hardware.ps1'),
      ].find(p => fs.existsSync(p))
      if (script) {
        execFileSync('powershell', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
          '-File', script
        ], { timeout: 45000 })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, printers: listarImpresoras() }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message, printers: listarImpresoras() }))
    }
    return
  }

  // ── Limpiar cola de impresión (fallback para navegador/Android; en Electron
  // se usa el IPC 'limpiar-cola-impresion'). Sin permisos de admin no borra
  // trabajos ajenos, pero no rompe nada.
  if (req.method === 'POST' && req.url === '/clear-queue') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      let printer = ''
      try { printer = String(JSON.parse(body || '{}').printer || '') } catch {}
      const ps = printer && esNombreImpresoraSeguro(printer)
        ? `Get-PrintJob -PrinterName '${printer.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue; "ok"`
        : `Get-Printer | ForEach-Object { Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue }; "ok"`
      try {
        const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000 }).toString()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: out.includes('ok') }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = ''
    let bodySize = 0
    const MAX_BODY = 2 * 1024 * 1024 // 2 MB — un ticket ESC/POS jamás supera esto
    req.on('data', chunk => {
      bodySize += chunk.length
      if (bodySize > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Payload demasiado grande' }))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', async () => {
      try {
        const { printer, ip, puerto, data } = JSON.parse(body)
        if (!data) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Falta campo data' }))
          return
        }
        let ok
        if (ip) {
          console.log(`[print] TCP → ${ip}:${puerto || 9100}`)
          ok = await imprimirRawTCP(ip, data, puerto || 9100)
        } else if (printer) {
          if (!esNombreImpresoraSeguro(printer)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Nombre de impresora inválido' }))
            return
          }
          console.log(`[print] USB/Local → ${printer}`)
          ok = imprimirRaw(printer, data)
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Se requiere printer o ip' }))
          return
        }
        res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── Ping TCP a impresora de red ────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/ping')) {
    const u = new URL(req.url, 'http://localhost')
    const ip = u.searchParams.get('ip')
    const puerto = parseInt(u.searchParams.get('puerto') || '9100')
    if (!ip) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Falta ip' }))
      return
    }
    const ok = await new Promise((resolve) => {
      const client = new net.Socket()
      let done = false
      const finish = (v) => { if (!done) { done = true; try { client.destroy() } catch {} resolve(v) } }
      client.setTimeout(3000)
      client.connect(puerto, ip, () => finish(true))
      client.on('error', () => finish(false))
      client.on('timeout', () => finish(false))
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok }))
    return
  }

  // ── Diagnóstico: impresoras instaladas + estado de la configurada ─────────
  if (req.method === 'GET' && req.url.startsWith('/diagnostico')) {
    try {
      const u = new URL(req.url, 'http://localhost')
      const nombreConfigurado = u.searchParams.get('printer') || ''
      const instaladas = listarImpresoras()
      const existe = instaladas.some(p => p === nombreConfigurado)
      // Verificar si la impresora tiene trabajos pendientes / estado
      let estadoPS = ''
      try {
        estadoPS = require('child_process').execFileSync('powershell', [
          '-NoProfile', '-Command',
          `Get-Printer | Select-Object Name,PrinterStatus,JobCount | ConvertTo-Json`
        ], { timeout: 5000 }).toString().trim()
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ instaladas, nombreConfigurado, existe, estadoPS }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Servidor de impresión corriendo en http://127.0.0.1:${PORT}`)
  console.log(`   GET  /printers  — listar impresoras`)
  console.log(`   POST /print     — imprimir ESC/POS (base64)`)
})
