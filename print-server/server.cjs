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

// Servidor HTTP
const server = http.createServer(async (req, res) => {
  // CORS para localhost
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/printers') {
    const printers = listarImpresoras()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(printers))
    return
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = ''
    req.on('data', chunk => { body += chunk })
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

  res.writeHead(404); res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Servidor de impresión corriendo en http://127.0.0.1:${PORT}`)
  console.log(`   GET  /printers  — listar impresoras`)
  console.log(`   POST /print     — imprimir ESC/POS (base64)`)
})
