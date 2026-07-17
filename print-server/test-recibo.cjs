/**
 * Prueba del recibo con logo y datos reales.
 * Ejecutar: node print-server/test-recibo.cjs
 */
const http = require('http')
const fs   = require('fs')
const path = require('path')

const W = 42
const PC850 = {
  'á':0xA0,'é':0x82,'í':0xA1,'ó':0xA2,'ú':0xA3,'ñ':0xA4,'ü':0x81,
  'Á':0xB5,'É':0x90,'Í':0xD6,'Ó':0xE0,'Ú':0xE9,'Ñ':0xA5,'Ü':0x9A,
  '¡':0xAD,'¿':0xA8,'°':0xF8,
}

// Logo ESC/POS pre-generado
const logoContent = fs.readFileSync(path.join(__dirname, 'logo-escpos.js'), 'utf8')
const logoMatch   = logoContent.match(/module\.exports = '([^']+)'/)
const LOGO_B64    = logoMatch ? logoMatch[1] : ''

class EscBuf {
  constructor() { this.b = [] }
  raw(...bytes) { this.b.push(...bytes); return this }
  text(s) {
    for (const ch of s) {
      const mapped = PC850[ch]
      if (mapped !== undefined) { this.b.push(mapped); continue }
      const code = ch.charCodeAt(0)
      this.b.push(code < 128 ? code : 63)
    }
    return this
  }
  rawBase64(b64) {
    const bin = Buffer.from(b64, 'base64')
    for (const byte of bin) this.b.push(byte)
    return this
  }
  line(s = '') { return this.text(s).raw(0x0A) }
  sep()        { return this.line('-'.repeat(W)) }
  lr(left, right, w = W) {
    const maxL = w - right.length - 1
    const l = left.length > maxL ? left.slice(0, maxL - 1) + '.' : left
    return this.line(l + ' '.repeat(Math.max(1, w - l.length - right.length)) + right)
  }
  alignLeft()   { return this.raw(0x1B, 0x61, 0x00) }
  alignCenter() { return this.raw(0x1B, 0x61, 0x01) }
  boldOn()      { return this.raw(0x1B, 0x45, 0x01) }
  boldOff()     { return this.raw(0x1B, 0x45, 0x00) }
  size(w, h)    { return this.raw(0x1D, 0x21, ((w - 1) << 4) | (h - 1)) }
  feed(n = 1)   { return this.raw(0x1B, 0x64, n) }
  cut()         { return this.raw(0x1D, 0x56, 0x42, 0x03) }
  toBase64()    { return Buffer.from(this.b).toString('base64') }
}

function wrapLines(text, maxW) {
  if (text.length <= maxW) return [text]
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const c = cur ? cur + ' ' + w : w
    if (c.length > maxW) { if (cur) lines.push(cur); cur = w }
    else cur = c
  }
  if (cur) lines.push(cur)
  return lines
}

function buildEncabezado(buf, { nombre, subtitulo, direccion, telefono, eslogan, info }) {
  const MAX_DW = Math.floor(W / 2)
  // Logo bitmap
  buf.rawBase64(LOGO_B64)
  // Nombre en doble ancho + doble alto
  buf.alignCenter()
  buf.boldOn().size(2, 2)
  if (nombre.length <= MAX_DW) {
    buf.line(nombre)
  } else {
    const mid = Math.ceil(nombre.length / 2)
    let split = nombre.lastIndexOf(' ', mid)
    if (split < 0) split = nombre.indexOf(' ')
    buf.line(nombre.slice(0, split))
    buf.line(nombre.slice(split + 1))
  }
  buf.size(1, 1).boldOff()
  buf.line()
  if (direccion) for (const l of wrapLines(direccion, W)) buf.line(l)
  if (telefono)  { buf.boldOn(); buf.line(`Tel: ${telefono}`); buf.boldOff() }
  if (eslogan)   buf.line(eslogan)
  if (subtitulo || (info && info.length)) {
    buf.line('-'.repeat(W))
    if (subtitulo) { buf.boldOn(); buf.line(subtitulo); buf.boldOff() }
    if (info)      for (const l of info) buf.line(l)
  }
  buf.line('='.repeat(W))
  buf.alignLeft()
}

// ── Datos reales ─────────────────────────────────────────────────────────────
const NOMBRE    = 'EL CAFE DEL CONSTRUCTOR'
const DIRECCION = 'Blvd. Laguitos 158, Zona Sin Asignacion de Nombre de Col 45, 29020 Tuxtla Gutierrez, Chis.'
const TELEFONO  = '5513721501'
const ESLOGAN   = 'Tu obra, tu cafe, tus recompensas'

const now    = new Date()
const fecha  = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
             + '  ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
const items  = [
  { nombre: 'Cafe Americano',     cantidad: 2, precio: 45.00 },
  { nombre: 'Croissant de jamon', cantidad: 1, precio: 68.00 },
  { nombre: 'Agua natural 600ml', cantidad: 3, precio: 22.00 },
]
const subtotal     = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
const propina      = 20.00
const total        = subtotal + propina
const cambio       = 300 - total

// ── Construir recibo ──────────────────────────────────────────────────────────
const buf = new EscBuf()
buf.raw(0x1B, 0x40)
buf.raw(0x1B, 0x74, 0x02)
buf.feed(2)

buildEncabezado(buf, { nombre: NOMBRE, direccion: DIRECCION, telefono: TELEFONO, eslogan: ESLOGAN })

// Datos (sin orden, solo primer nombre cajero, sin turno)
buf.line(`Fecha:  ${fecha}`)
buf.line(`Mesa:   Mesa 3`)
buf.line(`Cajero: Jorge`)
buf.sep()

for (const item of items) {
  const tot  = `$${(item.precio * item.cantidad).toFixed(2)}`.padStart(8)
  const cant = String(item.cantidad).padStart(2)
  const maxN = W - 3 - tot.length
  const nom  = item.nombre.length > maxN ? item.nombre.slice(0, maxN - 1) + '.' : item.nombre.padEnd(maxN)
  buf.line(`${cant} ${nom} ${tot}`)
}

buf.sep()
buf.lr('Subtotal:', `$${subtotal.toFixed(2)}`)
buf.lr('Propina:', `+$${propina.toFixed(2)}`)
buf.line('='.repeat(W))

buf.alignCenter()
buf.boldOn().size(2, 2)
buf.line(`TOTAL $${total.toFixed(2)}`)
buf.size(1, 1).boldOff()
buf.alignLeft()
buf.line()

buf.sep()
buf.lr('Pago:', 'Efectivo')
buf.lr('Cambio:', `$${cambio.toFixed(2)}`)

// Engranajes solo si hay cliente con QR (en este test simulamos SIN cliente)
// Para probar CON cliente descomenta:
// buf.sep(); buf.alignCenter()
// buf.boldOn(); buf.line('+15 ENGRANAJES GANADOS'); buf.boldOff()
// buf.line('Jorge Ash'); buf.line('Saldo: 150 engranajes'); buf.alignLeft()

buf.sep()
buf.alignCenter()
buf.boldOn().size(1, 2)
buf.line('Gracias por tu visita!')
buf.size(1, 1).boldOff()
buf.line('Construye tu proxima visita con nosotros.')
buf.feed(4)
buf.cut()

// ── Enviar ────────────────────────────────────────────────────────────────────
const body = JSON.stringify({ printer: 'EPSON TM-T20IV Receipt6', data: buf.toBase64() })
const req  = http.request(
  { hostname: '127.0.0.1', port: 3002, path: '/print', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    let raw = ''
    res.on('data', d => raw += d)
    res.on('end', () => {
      const json = JSON.parse(raw)
      console.log(json.ok ? '✅ Recibo impreso OK' : '❌ Error: ' + json.error)
    })
  }
)
req.on('error', e => console.error('❌ No conecta al print server:', e.message))
req.write(body)
req.end()
