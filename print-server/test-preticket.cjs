/**
 * Prueba del pre-ticket con el nuevo encabezado.
 * Ejecutar: node print-server/test-preticket.cjs
 */
const http = require('http')

const W = 42
const PC850 = {
  'á':0xA0,'é':0x82,'í':0xA1,'ó':0xA2,'ú':0xA3,'ñ':0xA4,'ü':0x81,
  'Á':0xB5,'É':0x90,'Í':0xD6,'Ó':0xE0,'Ú':0xE9,'Ñ':0xA5,'Ü':0x9A,
  '¡':0xAD,'¿':0xA8,'°':0xF8,
  '║':0xBA,'╔':0xC9,'╗':0xBB,'╚':0xC8,'╝':0xBC,'═':0xCD,
}

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
  line(s = '') { return this.text(s).raw(0x0A) }
  sep()        { return this.line('-'.repeat(W)) }
  lr(left, right, w = W) {
    const maxL = w - right.length - 1
    const l = left.length > maxL ? left.slice(0, maxL - 1) + '.' : left
    return this.line(l + ' '.repeat(Math.max(1, w - l.length - right.length)) + right)
  }
  ctr(s, w = W) { return this.line(' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s) }
  ctrWrap(s, w = W) {
    if (s.length <= w) return this.ctr(s, w)
    const words = s.split(' ')
    let current = ''
    for (const word of words) {
      if ((current + (current ? ' ' : '') + word).length > w) {
        if (current) this.ctr(current, w)
        current = word
      } else {
        current = current ? current + ' ' + word : word
      }
    }
    if (current) this.ctr(current, w)
    return this
  }
  alignLeft()   { return this.raw(0x1B, 0x61, 0x00) }
  boldOn()      { return this.raw(0x1B, 0x45, 0x01) }
  boldOff()     { return this.raw(0x1B, 0x45, 0x00) }
  size(w, h)    { return this.raw(0x1D, 0x21, ((w - 1) << 4) | (h - 1)) }
  feed(n = 1)   { return this.raw(0x1B, 0x64, n) }
  cut()         { return this.raw(0x1D, 0x56, 0x42, 0x03) }
  toBase64()    { return Buffer.from(this.b).toString('base64') }
}

function buildEncabezadoBox(buf, { nombre, subtitulo, direccion, telefono, eslogan, info }) {
  const innerW = W - 2
  buf.alignLeft()
  buf.line('╔' + '═'.repeat(innerW) + '╗')
  const pad  = Math.max(0, Math.floor((innerW - nombre.length) / 2))
  const padR = Math.max(0, innerW - nombre.length - pad)
  buf.text('║').text(' '.repeat(pad)).boldOn().text(nombre).boldOff().text(' '.repeat(padR)).line('║')
  buf.line('╚' + '═'.repeat(innerW) + '╝')
  if (direccion) buf.ctrWrap(direccion)
  if (telefono)  { buf.boldOn(); buf.ctr(`Tel: ${telefono}`); buf.boldOff() }
  if (eslogan)   buf.ctr(eslogan)
  if (subtitulo || (info && info.length)) {
    buf.sep()
    if (subtitulo) { buf.boldOn(); buf.ctr(`[ ${subtitulo} ]`); buf.boldOff() }
    if (info)      for (const l of info) buf.ctr(l)
  }
  buf.line('='.repeat(W))
}

// ── Datos reales ─────────────────────────────────────────────────────────────
const NOMBRE    = 'EL CAFE DEL CONSTRUCTOR'
const DIRECCION = 'Blvd. Laguitos 158, Zona Sin Asignacion de Nombre de Col 45, 29020 Tuxtla Gutierrez, Chis.'
const TELEFONO  = '5513721501'
const ESLOGAN   = 'Tu obra, tu cafe, tus recompensas'
const items = [
  { nombre: 'Café Americano',     cantidad: 2, precio: 45.00, notas: null },
  { nombre: 'Croissant de jamón', cantidad: 1, precio: 68.00, notas: 'Sin mantequilla' },
  { nombre: 'Agua natural 600ml', cantidad: 3, precio: 22.00, notas: null },
]
const descuento = 0

// ── Generar pre-ticket ────────────────────────────────────────────────────────
const sub      = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
const tot      = sub - descuento
const now      = new Date()
const fechaStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
const horaStr  = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })

const buf = new EscBuf()
buf.raw(0x1B, 0x40)
buf.raw(0x1B, 0x74, 0x02)
buf.feed(2)

buildEncabezadoBox(buf, { nombre: NOMBRE, direccion: DIRECCION, telefono: TELEFONO, eslogan: ESLOGAN })

buf.line(`Fecha:  ${fechaStr}  ${horaStr}`)
buf.line(`Mesa:   Mesa 3`)
buf.line(`Cajero: Jorge Ash`)
buf.sep()

buf.boldOn().line(`CT DESCRIPCION                P.UNIT   TOTAL`).boldOff()
buf.sep()

for (const item of items) {
  const cant   = String(item.cantidad).padStart(2)
  const pUnit  = `$${item.precio.toFixed(2)}`.padStart(7)
  const total  = `$${(item.precio * item.cantidad).toFixed(2)}`.padStart(7)
  const maxNom = W - cant.length - pUnit.length - total.length - 3
  const nom    = item.nombre.length > maxNom ? item.nombre.slice(0, maxNom - 1) + '.' : item.nombre.padEnd(maxNom)
  buf.line(`${cant} ${nom} ${pUnit} ${total}`)
  if (item.notas) buf.line(`   > ${item.notas}`)
}

buf.sep()
buf.lr('Subtotal:', `$${sub.toFixed(2)}`)
if (descuento > 0) buf.lr('Descuento:', `-$${descuento.toFixed(2)}`)
buf.boldOn().lr('TOTAL A PAGAR:', `$${tot.toFixed(2)}`).boldOff()
buf.sep()
buf.ctr('*** PRE-TICKET - NO ES COMPROBANTE FISCAL ***')
buf.feed(4)
buf.cut()

// ── Enviar al print server ───────────────────────────────────────────────────
const body = JSON.stringify({ printer: 'EPSON TM-T20IV Receipt6', data: buf.toBase64() })
const req = http.request(
  { hostname: '127.0.0.1', port: 3002, path: '/print', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    let raw = ''
    res.on('data', d => raw += d)
    res.on('end', () => {
      const json = JSON.parse(raw)
      console.log(json.ok ? '✅ Pre-ticket impreso OK' : '❌ Error: ' + json.error)
    })
  }
)
req.on('error', e => console.error('❌ No se pudo conectar al servidor de impresión:', e.message))
req.write(body)
req.end()
