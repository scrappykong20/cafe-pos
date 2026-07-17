/**
 * Servidor POS para PC de caja
 * Sirve el build de producción en el puerto 3000
 * y mantiene el proxy /mp-api → MercadoPago
 *
 * Uso: node serve-pos.js
 */
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, spawn } = require('child_process')

const PORT = 3000
const DIST = path.join(__dirname, 'dist')

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

const server = http.createServer((req, res) => {
  // ── Proxy /mp-api → api.mercadopago.com ──────────────────────────────────
  if (req.url.startsWith('/mp-api')) {
    const mpPath = req.url.replace('/mp-api', '')
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const options = {
        hostname: 'api.mercadopago.com',
        port: 443,
        path: mpPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: 'api.mercadopago.com',
        },
      }
      const proxy = https.request(options, (mpRes) => {
        res.writeHead(mpRes.statusCode, mpRes.headers)
        mpRes.pipe(res)
      })
      proxy.on('error', (e) => {
        console.error('[proxy] Error MP:', e.message)
        res.writeHead(502)
        res.end('Bad Gateway')
      })
      if (body.length) proxy.write(body)
      proxy.end()
    })
    return
  }

  // ── Archivos estáticos ────────────────────────────────────────────────────
  let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url)

  // SPA fallback — cualquier ruta sin extensión → index.html
  if (!path.extname(filePath)) {
    filePath = path.join(DIST, 'index.html')
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Último recurso: index.html
      fs.readFile(path.join(DIST, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(data2)
      })
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

// ── Endpoint de versión ───────────────────────────────────────────────────────
// GET /version  → { version, node, platform }
// POST /update  → recibe un ZIP con la nueva carpeta dist/ y la reemplaza

// Versión del build (se sobreescribe al actualizar)
const VERSION_FILE = path.join(__dirname, 'version.json')
function getVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')) }
  catch { return { version: '1.0.0', built: 'desconocido' } }
}

// Agrega manejo de rutas de actualización al servidor existente
const _origHandler = server.listeners('request')[0]
server.removeAllListeners('request')

server.on('request', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // GET /version
  if (req.method === 'GET' && req.url === '/version') {
    const v = getVersion()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...v, node: process.version, platform: os.platform() }))
    return
  }

  // POST /update — recibe ZIP con nueva dist/
  if (req.method === 'POST' && req.url === '/update') {
    // Solo desde localhost por seguridad
    const clientIp = req.socket.remoteAddress
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Solo desde localhost' }))
      return
    }

    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const zipBuf  = Buffer.concat(chunks)
        const tmpZip  = path.join(os.tmpdir(), `cafePOS_update_${Date.now()}.zip`)
        const tmpDist = path.join(os.tmpdir(), `cafePOS_dist_${Date.now()}`)
        fs.writeFileSync(tmpZip, zipBuf)

        // Extraer con PowerShell (disponible en Windows)
        execFileSync('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDist}' -Force`
        ], { timeout: 30000 })

        const newDist = path.join(tmpDist, 'dist')
        if (!fs.existsSync(path.join(newDist, 'index.html'))) {
          throw new Error('El ZIP no contiene dist/index.html')
        }

        // Reemplazar dist/
        execFileSync('powershell', [
          '-NoProfile', '-Command',
          `Remove-Item -Recurse -Force '${DIST}'; Copy-Item -Recurse '${newDist}' '${DIST}'`
        ], { timeout: 15000 })

        // Actualizar version.json
        const verPath = path.join(tmpDist, 'version.json')
        if (fs.existsSync(verPath)) fs.copyFileSync(verPath, VERSION_FILE)
        else fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: 'updated', built: new Date().toISOString() }))

        // Limpiar
        try { fs.unlinkSync(tmpZip) } catch {}
        try { execFileSync('powershell', ['-NoProfile', '-Command', `Remove-Item -Recurse -Force '${tmpDist}'`]) } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: 'Actualización aplicada. Recarga la página.' }))
      } catch (e) {
        console.error('[update] Error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // Delegar al handler original
  _origHandler(req, res)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ☕  Café POS corriendo en http://localhost:${PORT}\n`)
  console.log(`   GET  /version  — ver versión instalada`)
  console.log(`   POST /update   — subir ZIP con nueva dist/ (solo localhost)\n`)
})
