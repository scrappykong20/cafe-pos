/* ------------------------------------------------------------------ */
/*  printer.ts — ESC/POS raw printing via QZ Tray                      */
/*  Requires QZ Tray running on the machine (qz.io)                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Servidor local de impresión: http://127.0.0.1:3002                 */
/*  Inicia con: node print-server/server.js                            */
/* ------------------------------------------------------------------ */
import { LOGO_ESCPOS } from './logo-escpos'
import { logger } from './logger'

const PRINT_SERVER = 'http://127.0.0.1:3002'

export const PRINTER_CAJA_KEY   = 'printer_nombre_caja'
export const PRINTER_COCINA_KEY = 'printer_nombre_cocina'

export function getPrinterCaja():   string { return localStorage.getItem(PRINTER_CAJA_KEY)   || '' }
export function getPrinterCocina(): string { return localStorage.getItem(PRINTER_COCINA_KEY) || '' }
export function setPrinterCaja(n: string)   { localStorage.setItem(PRINTER_CAJA_KEY,   n) }
export function setPrinterCocina(n: string) { localStorage.setItem(PRINTER_COCINA_KEY, n) }

// qzDisponible se mantiene por compatibilidad pero ahora siempre retorna true si el servidor está activo
export function qzDisponible(): boolean { return true }

export async function listarImpresoras(): Promise<string[]> {
  try {
    const res = await fetch(`${PRINT_SERVER}/printers`)
    if (!res.ok) {
      void logger.warn('impresora', `Servidor impresión respondió ${res.status}`)
      return []
    }
    return await res.json() as string[]
  } catch (err) {
    void logger.error('impresora', 'No se pudo conectar al servidor de impresión (puerto 3002)', { error: String(err) })
    return []
  }
}

// ─── ESC/POS builder ──────────────────────────────────────────────────────────
// Font A, 80mm papel, área 72mm → 42 caracteres por línea
const W = 42

// Mapa PC850 (Latin-1 Western Europe) para caracteres en español
// Epson TM-T20IV soporta PC850 como code page 2
const PC850: Record<string, number> = {
  'á':0xA0,'é':0x82,'í':0xA1,'ó':0xA2,'ú':0xA3,'ñ':0xA4,'ü':0x81,
  'Á':0xB5,'É':0x90,'Í':0xD6,'Ó':0xE0,'Ú':0xE9,'Ñ':0xA5,'Ü':0x9A,
  '¡':0xAD,'¿':0xA8,'°':0xF8,
  // Caracteres de caja (PC850)
  '║':0xBA,'╔':0xC9,'╗':0xBB,'╚':0xC8,'╝':0xBC,'═':0xCD,'╠':0xCC,'╣':0xB9,
  '│':0xB3,'─':0xC4,'┌':0xDA,'┐':0xBF,'└':0xC0,'┘':0xD9,
}

class EscBuf {
  private b: number[] = []

  raw(...bytes: number[]) { this.b.push(...bytes); return this }

  text(s: string) {
    for (const ch of s) {
      const mapped = PC850[ch]
      if (mapped !== undefined) { this.b.push(mapped); continue }
      const code = ch.charCodeAt(0)
      this.b.push(code < 128 ? code : 63) // '?' para chars no soportados
    }
    return this
  }

  line(s = '') { return this.text(s).raw(0x0A) }

  sep() { return this.line('-'.repeat(W)) }

  // Línea con texto izquierda y derecha justificados
  lr(left: string, right: string, w = W) {
    const maxL = w - right.length - 1
    const l = left.length > maxL ? left.slice(0, maxL - 1) + '.' : left
    return this.line(l + ' '.repeat(Math.max(1, w - l.length - right.length)) + right)
  }

  // Línea centrada
  ctr(s: string, w = W) {
    return this.line(' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s)
  }

  // Texto centrado con word-wrap automático para líneas largas
  ctrWrap(s: string, w = W) {
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
  alignCenter() { return this.raw(0x1B, 0x61, 0x01) }

  boldOn()  { return this.raw(0x1B, 0x45, 0x01) }
  boldOff() { return this.raw(0x1B, 0x45, 0x00) }

  // w, h: 1=normal, 2=doble
  size(w: 1 | 2, h: 1 | 2) { return this.raw(0x1D, 0x21, ((w - 1) << 4) | (h - 1)) }

  feed(n = 1) { return this.raw(0x1B, 0x64, n) }

  // Inserta bytes crudos desde base64
  rawBase64(b64: string) {
    const bin = atob(b64)
    for (let i = 0; i < bin.length; i++) this.b.push(bin.charCodeAt(i))
    return this
  }

  // Corte parcial
  cut() { return this.raw(0x1D, 0x56, 0x42, 0x03) }

  toBase64(): string {
    const ua = new Uint8Array(this.b)
    let bin = ''
    for (let i = 0; i < ua.length; i++) bin += String.fromCharCode(ua[i])
    return btoa(bin)
  }
}

// ─── Imprimir ESC/POS via servidor local ──────────────────────────────────────
export async function imprimirHTML(printerName: string, data: string): Promise<boolean> {
  if (!printerName) return false
  try {
    const res = await fetch(`${PRINT_SERVER}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer: printerName, data }),
    })
    const json = await res.json() as { ok: boolean; error?: string }
    if (!json.ok) {
      void logger.warn('impresora', `Impresión falló en "${printerName}"`, { respuesta: json })
    }
    return json.ok === true
  } catch (err) {
    void logger.error('impresora', `Sin conexión al servidor de impresión — impresora: "${printerName}"`, { error: String(err) })
    console.error('[printer] Error al conectar con servidor de impresión:', err)
    return false
  }
}

// ─── Encabezado estándar ─────────────────────────────────────────────────────
/** Divide texto en líneas de máximo maxW chars por palabra */
function wrapLines(text: string, maxW: number): string[] {
  if (text.length <= maxW) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w
    if (candidate.length > maxW) { if (cur) lines.push(cur); cur = w }
    else cur = candidate
  }
  if (cur) lines.push(cur)
  return lines
}

function buildEncabezadoBox(buf: EscBuf, opts: {
  nombre: string
  subtitulo?: string
  direccion?: string
  telefono?: string
  eslogan?: string
  info?: string[]
}) {
  const { nombre, subtitulo, direccion, telefono, eslogan, info } = opts
  const MAX_DW = Math.floor(W / 2)  // 21 chars máx en doble ancho

  // ── Logo bitmap (centrado, ya incluye ESC a 1 + LF) ──────────────
  buf.rawBase64(LOGO_ESCPOS)

  // ── Info del local (cada línea centrada por hardware) ─────────────
  buf.alignCenter()
  if (direccion) for (const l of wrapLines(direccion, W)) buf.line(l)
  if (telefono)  { buf.boldOn(); buf.line(`Tel: ${telefono}`); buf.boldOff() }
  if (eslogan)   buf.line(eslogan)

  // ── Subtítulo + datos del ticket ──────────────────────────────────
  if (subtitulo || (info && info.length)) {
    buf.line('-'.repeat(W))
    if (subtitulo) { buf.boldOn(); buf.line(subtitulo); buf.boldOff() }
    if (info)      for (const l of info) buf.line(l)
  }

  buf.line('='.repeat(W))
  buf.alignLeft()
}

// ─── Builder genérico reutilizable ───────────────────────────────────────────
/**
 * Crea un ticket ESC/POS de forma fluida.
 * Uso: const data = crearTicket().encabezado(...).fila(...).fin()
 */
export function crearTicket() {
  const buf = new EscBuf()
  buf.raw(0x1B, 0x40)       // init
  buf.raw(0x1B, 0x74, 0x02) // PC850
  buf.feed(2)                // margen superior

  const api = {
    /** Encabezado con caja y datos del local */
    encabezado(nombre: string, subtitulo?: string, opts: {
      direccion?: string; telefono?: string; eslogan?: string; info?: string[]
    } | string[] = {}) {
      const o = Array.isArray(opts)
        ? { info: opts }
        : opts
      buildEncabezadoBox(buf, { nombre, subtitulo, ...o })
      return api
    },
    /** Título de sección en negrita */
    seccion(titulo: string) {
      buf.boldOn()
      buf.line(titulo.toUpperCase())
      buf.boldOff()
      return api
    },
    /** Fila izquierda–derecha */
    fila(izq: string, der: string) { buf.lr(izq, der); return api },
    /** Fila izquierda–derecha en negrita */
    filaB(izq: string, der: string) { buf.boldOn(); buf.lr(izq, der); buf.boldOff(); return api },
    /** Línea de texto libre */
    linea(texto = '') { buf.line(texto); return api },
    /** Separador --- */
    sep() { buf.sep(); return api },
    /** Separador === */
    sepDoble() { buf.line('='.repeat(W)); return api },
    /** Total grande en doble ancho + doble alto */
    totalGrande(label: string, valor: string) {
      buf.alignCenter()
      buf.boldOn().size(2, 2)
      buf.line(valor)
      buf.size(1, 1)
      buf.line(label)
      buf.boldOff()
      buf.alignLeft()
      return api
    },
    /** Texto centrado */
    centrar(texto: string, negrita = false) {
      buf.alignCenter()
      if (negrita) buf.boldOn()
      buf.line(texto)
      if (negrita) buf.boldOff()
      buf.alignLeft()
      return api
    },
    /** Cierra, alimenta papel y corta. Retorna base64 listo para imprimirHTML() */
    fin() { buf.feed(4); buf.cut(); return buf.toBase64() },
  }
  return api
}

// ─── Tipos exportados ─────────────────────────────────────────────────────────
export interface ReciboItem {
  emoji: string
  nombre: string
  cantidad: number
  precio: number
  notas?: string | null
}

export interface CanjeItem {
  emoji: string
  nombre: string
  cantidad: number
  costo: number
}

// ─── Config del local (se pasa desde el componente) ──────────────────────────
const NOMBRE_CAFE_DEFAULT = 'EL CAFE DEL CONSTRUCTOR'
const DIRECCION_DEFAULT   = ''
const ESLOGAN_DEFAULT     = 'Tu obra, tu cafe, tus recompensas'

export function buildReciboHTML(opts: {
  fecha: string
  ordenStr: string
  mesaNombre: string
  items: ReciboItem[]
  canjeItems?: CanjeItem[]
  subtotalBase: number
  descuentoTotal: number
  propinaMonto: number
  totalACobrar: number
  metodoPagoLabel: string
  cambioFinal: number
  metodoPago: string
  efectivoMixto?: number
  tarjetaMixto?: number
  engranajeFinal: number
  saldoFinal: number
  clienteNombre?: string
  cajeroNombre?: string
  turno?: string
  nombreLocal?: string
  direccionLocal?: string
  telefonoLocal?: string
}): string {
  const {
    fecha, ordenStr, mesaNombre, items, canjeItems,
    subtotalBase, descuentoTotal, propinaMonto, totalACobrar,
    metodoPagoLabel, cambioFinal, metodoPago,
    efectivoMixto, tarjetaMixto,
    engranajeFinal, saldoFinal, clienteNombre, cajeroNombre,
    nombreLocal, direccionLocal, telefonoLocal,
  } = opts

  const NOMBRE_CAFE = (nombreLocal || NOMBRE_CAFE_DEFAULT).toUpperCase()
  const buf = new EscBuf()

  buf.raw(0x1B, 0x40)
  buf.raw(0x1B, 0x74, 0x02)
  buf.feed(1)

  // ══════════════ ENCABEZADO ══════════════
  buildEncabezadoBox(buf, {
    nombre:    NOMBRE_CAFE,
    direccion: direccionLocal || undefined,
    telefono:  telefonoLocal,
    eslogan:   ESLOGAN_DEFAULT,
  })

  // ── Titulo del ticket ─────────────────────────────────────────────────
  buf.alignCenter()
  buf.boldOn()
  buf.line('*  NOTA DE VENTA  *')
  buf.boldOff()
  buf.line('='.repeat(W))

  // ── Datos de la orden ─────────────────────────────────────────────────
  buf.alignLeft()
  const cajero1 = cajeroNombre ? cajeroNombre.split(' ')[0] : ''
  if (ordenStr) {
    buf.lr(`Orden ${ordenStr}`, fecha)
  } else {
    buf.line(`Fecha:  ${fecha}`)
  }
  buf.lr(`Mesa: ${mesaNombre}`, cajero1 ? `Cajero: ${cajero1}` : '')
  buf.line('-'.repeat(W))

  // ── Encabezado columnas artículos ─────────────────────────────────────
  buf.boldOn()
  buf.line('ARTICULO                    CANT    TOTAL')
  buf.boldOff()
  buf.line('-'.repeat(W))

  // ── Artículos ─────────────────────────────────────────────────────────
  for (const item of items) {
    const totalItem = `$${(item.precio * item.cantidad).toFixed(2)}`
    const cant      = `x${item.cantidad}`
    const maxNom    = W - cant.length - totalItem.length - 4
    const nom       = item.nombre.length > maxNom
      ? item.nombre.slice(0, maxNom - 1) + '.'
      : item.nombre
    const gap       = W - nom.length - cant.length - totalItem.length
    buf.line(`${nom}${' '.repeat(Math.max(1, gap - 1))}${cant} ${totalItem}`)
    // precio unitario en línea secundaria si es diferente de totalItem
    if (item.cantidad > 1) {
      buf.line(`  c/u $${item.precio.toFixed(2)}`)
    }
    if (item.notas) buf.line(`  >> ${item.notas}`)
  }

  // ── Canjes ────────────────────────────────────────────────────────────
  if (canjeItems && canjeItems.length > 0) {
    buf.line('-'.repeat(W))
    buf.boldOn(); buf.line('CANJES:'); buf.boldOff()
    for (const c of canjeItems) {
      buf.lr(`  ${c.emoji || '*'} ${c.nombre} x${c.cantidad}`, `-${c.costo} eng`)
    }
  }

  buf.line('-'.repeat(W))

  // ── Subtotales ────────────────────────────────────────────────────────
  buf.lr('Subtotal', `$${subtotalBase.toFixed(2)}`)
  if (descuentoTotal > 0) {
    buf.boldOn()
    buf.lr('Descuento aplicado', `-$${descuentoTotal.toFixed(2)}`)
    buf.boldOff()
  }
  if (propinaMonto > 0) buf.lr('Propina', `+$${propinaMonto.toFixed(2)}`)

  buf.line('='.repeat(W))

  // ── TOTAL grande ──────────────────────────────────────────────────────
  buf.alignCenter()
  buf.boldOn().size(2, 2)
  buf.line(`$${totalACobrar.toFixed(2)}`)
  buf.size(1, 1)
  buf.line('TOTAL  A  PAGAR')
  buf.boldOff()
  buf.line('='.repeat(W))

  // ── Forma de pago ─────────────────────────────────────────────────────
  buf.alignLeft()
  buf.boldOn()
  buf.lr('Forma de pago:', metodoPagoLabel)
  buf.boldOff()
  if (metodoPago === 'mixto' && efectivoMixto !== undefined && tarjetaMixto !== undefined) {
    buf.lr('  Efectivo', `$${efectivoMixto.toFixed(2)}`)
    buf.lr('  Tarjeta',  `$${tarjetaMixto.toFixed(2)}`)
  }
  if ((metodoPago === 'efectivo' || metodoPago === 'mixto') && cambioFinal > 0) {
    buf.boldOn()
    buf.lr('Cambio:', `$${cambioFinal.toFixed(2)}`)
    buf.boldOff()
  }

  // ── Engranajes / loyalty ──────────────────────────────────────────────
  if (clienteNombre) {
    buf.line('='.repeat(W))
    buf.alignCenter()
    buf.line('** PROGRAMA DE LEALTAD **')
    buf.line(clienteNombre.toUpperCase())
    if (engranajeFinal > 0) {
      buf.boldOn()
      buf.line(`+ ${engranajeFinal} ENGRANAJES GANADOS`)
      buf.boldOff()
    }
    buf.line(`Saldo total: ${saldoFinal.toLocaleString()} eng`)
    buf.alignLeft()
  }

  // ── Pie de pagina ─────────────────────────────────────────────────────
  buf.line('='.repeat(W))
  buf.alignCenter()
  buf.boldOn().size(1, 2)
  buf.line('iGracias por tu visita!')
  buf.size(1, 1).boldOff()
  buf.line('Construye tu proxima visita con nosotros')
  buf.line(' ')
  buf.line('- NO ES COMPROBANTE FISCAL -')
  buf.line('='.repeat(W))

  buf.feed(4)
  buf.cut()

  return buf.toBase64()
}

// ─── Pre-ticket (ESC/POS) ────────────────────────────────────────────────────
export function buildPreTicketHTML(opts: {
  mesaNombre: string
  cajeroNombre: string
  items: { nombre: string; cantidad: number; precio: number; notas?: string | null }[]
  descuento?: number
  notaOrden?: string
  nombreLocal?: string
  direccionLocal?: string
  telefonoLocal?: string
}): string {
  const { mesaNombre, cajeroNombre, items, descuento = 0, notaOrden, nombreLocal, direccionLocal, telefonoLocal } = opts

  const sub = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const tot = sub - descuento
  const now = new Date()
  const fechaStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const horaStr  = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })

  const NOMBRE = (nombreLocal || NOMBRE_CAFE_DEFAULT).toUpperCase()
  const buf = new EscBuf()

  buf.raw(0x1B, 0x40)
  buf.raw(0x1B, 0x74, 0x02)
  buf.feed(2)

  buildEncabezadoBox(buf, {
    nombre:    NOMBRE,
    direccion: direccionLocal,
    telefono:  telefonoLocal,
    eslogan:   ESLOGAN_DEFAULT,
  })

  // ── Titulo ────────────────────────────────────────────────────────────
  buf.alignCenter()
  buf.boldOn()
  buf.line('*  CUENTA  *')
  buf.boldOff()
  buf.line('='.repeat(W))

  // ── Datos ─────────────────────────────────────────────────────────────
  buf.alignLeft()
  buf.lr(`Mesa: ${mesaNombre}`, `${fechaStr} ${horaStr}`)
  buf.lr(`Cajero: ${cajeroNombre.split(' ')[0]}`, '')
  if (notaOrden) buf.line(`Nota: ${notaOrden}`)
  buf.line('-'.repeat(W))

  // ── Columnas artículos ────────────────────────────────────────────────
  buf.boldOn().line('ARTICULO                    CANT    TOTAL').boldOff()
  buf.line('-'.repeat(W))

  for (const item of items) {
    const totalItem = `$${(item.precio * item.cantidad).toFixed(2)}`
    const cant      = `x${item.cantidad}`
    const maxNom    = W - cant.length - totalItem.length - 4
    const nom       = item.nombre.length > maxNom
      ? item.nombre.slice(0, maxNom - 1) + '.'
      : item.nombre
    const gap       = W - nom.length - cant.length - totalItem.length
    buf.line(`${nom}${' '.repeat(Math.max(1, gap - 1))}${cant} ${totalItem}`)
    if (item.cantidad > 1) buf.line(`  c/u $${item.precio.toFixed(2)}`)
    if (item.notas) buf.line(`  >> ${item.notas}`)
  }

  buf.line('-'.repeat(W))
  buf.lr('Subtotal:', `$${sub.toFixed(2)}`)
  if (descuento > 0) {
    buf.boldOn(); buf.lr('Descuento:', `-$${descuento.toFixed(2)}`); buf.boldOff()
  }
  buf.line('='.repeat(W))

  buf.alignCenter()
  buf.boldOn().size(2, 2)
  buf.line(`$${tot.toFixed(2)}`)
  buf.size(1, 1)
  buf.line('TOTAL  A  PAGAR')
  buf.boldOff()
  buf.line('='.repeat(W))
  buf.line('- PRE-CUENTA  /  NO FISCAL -')
  buf.alignLeft()
  buf.feed(4)
  buf.cut()

  return buf.toBase64()
}

// ─── Sistema de slots de impresoras (cable / red) ─────────────────────────────
export interface PrinterSlot {
  tipo: 'caja' | 'cocina' | ''
  modo: 'cable' | 'red'
  nombre: string  // nombre Windows (modo cable)
  ip: string      // dirección IP (modo red, puerto 9100 por defecto)
}

const DEFAULT_SLOT: PrinterSlot = { tipo: '', modo: 'cable', nombre: '', ip: '' }

/** Lee la configuración de un slot. Migra automáticamente desde claves antiguas. */
export function getSlot(n: 1 | 2): PrinterSlot {
  try {
    const raw = localStorage.getItem(`printer_slot_${n}`)
    if (raw) return { ...DEFAULT_SLOT, ...JSON.parse(raw) }
  } catch {}
  // Migración desde sistema antiguo
  if (n === 1) {
    const old = localStorage.getItem(PRINTER_CAJA_KEY)
    if (old) return { tipo: 'caja', modo: 'cable', nombre: old, ip: '' }
  }
  if (n === 2) {
    const old = localStorage.getItem(PRINTER_COCINA_KEY)
    if (old) return { tipo: 'cocina', modo: 'cable', nombre: old, ip: '' }
  }
  return { ...DEFAULT_SLOT }
}

/** Guarda la configuración de un slot en localStorage. */
export function setSlot(n: 1 | 2, slot: PrinterSlot) {
  localStorage.setItem(`printer_slot_${n}`, JSON.stringify(slot))
}

/** Devuelve true si hay al menos un slot configurado para el tipo dado. */
export function hayImpresora(tipo: 'caja' | 'cocina'): boolean {
  return [getSlot(1), getSlot(2)].some(s =>
    s.tipo === tipo && (s.modo === 'red' ? !!s.ip : !!s.nombre)
  )
}

/** Envía ESC/POS por TCP al print server (impresora de red). */
async function imprimirTCP(ip: string, data: string, puerto = 9100): Promise<boolean> {
  try {
    const res = await fetch(`${PRINT_SERVER}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, puerto, data }),
    })
    const json = await res.json() as { ok: boolean }
    return json.ok === true
  } catch (err) {
    console.error('[printer] Error TCP:', err)
    return false
  }
}

/** Comprueba si se puede alcanzar una impresora de red (ping TCP). */
export async function pingImpresora(ip: string, puerto = 9100): Promise<boolean> {
  try {
    const res = await fetch(`${PRINT_SERVER}/ping?ip=${encodeURIComponent(ip)}&puerto=${puerto}`)
    const json = await res.json() as { ok: boolean }
    return json.ok === true
  } catch {
    return false
  }
}

/**
 * Imprime ESC/POS en la impresora configurada para el tipo dado (caja / cocina).
 * Detecta automáticamente si es cable (Windows RAW) o red (TCP 9100).
 */
export async function imprimirPorTipo(tipo: 'caja' | 'cocina', data: string): Promise<boolean> {
  const slot = [getSlot(1), getSlot(2)].find(s => s.tipo === tipo)
  if (!slot) return false
  if (slot.modo === 'red') {
    if (!slot.ip) return false
    return imprimirTCP(slot.ip, data)
  }
  if (!slot.nombre) return false
  return imprimirHTML(slot.nombre, data)
}

// ─── Comanda de cocina (ESC/POS) ──────────────────────────────────────────────
export function buildComandaHTML(opts: {
  ordenStr: string
  mesaNombre: string
  cajeroNombre: string
  tipo: 'llevar' | 'comedor'
  hora: string
  items: { emoji: string; nombre: string; cantidad: number; notas?: string | null }[]
  notaOrden?: string
  esConsumoEmpleado?: boolean
}): string {
  const { ordenStr, mesaNombre, cajeroNombre, tipo, hora, items, notaOrden, esConsumoEmpleado } = opts

  const buf = new EscBuf()
  buf.raw(0x1B, 0x40)
  buf.raw(0x1B, 0x74, 0x02)
  buf.feed(1)

  const IW = W - 2
  const bTop = '╔' + '═'.repeat(IW) + '╗'
  const bBot = '╚' + '═'.repeat(IW) + '╝'
  const bSep = '╠' + '═'.repeat(IW) + '╣'
  const bRow = (text: string) => {
    const pad = Math.max(0, IW - text.length)
    return '║' + ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2)) + '║'
  }

  // ── Encabezado ─────────────────────────────────────────────────────────
  buf.alignLeft()
  buf.line(bTop)
  buf.boldOn()
  buf.line(bRow('** COMANDA DE COCINA **'))
  buf.boldOff()

  if (esConsumoEmpleado || tipo === 'llevar') {
    buf.line(bSep)
    if (esConsumoEmpleado) { buf.boldOn(); buf.line(bRow('[ CONSUMO EMPLEADO ]')); buf.boldOff() }
    if (tipo === 'llevar')  { buf.boldOn(); buf.line(bRow('>>>  PARA LLEVAR  <<<')); buf.boldOff() }
  }
  buf.line(bBot)

  // ── Mesa grande centrada ────────────────────────────────────────────────
  buf.alignCenter()
  buf.boldOn().size(2, 2)
  buf.line(mesaNombre)
  buf.size(1, 1).boldOff()

  // ── Hora + cajero + orden ───────────────────────────────────────────────
  buf.line('='.repeat(W))
  buf.alignLeft()
  buf.lr(`  ${hora}`, cajeroNombre.split(' ')[0])
  if (ordenStr) buf.lr('  Orden:', `#${ordenStr}`)
  buf.line('='.repeat(W))
  buf.line('')

  // ── Items — cada uno con checkbox y doble alto ──────────────────────────
  for (const item of items) {
    // Cantidad con caja visual: [ x3 ]
    const cantBox = `[x${item.cantidad}]`
    const prefix  = `${cantBox} `
    const maxNom  = W - prefix.length
    const nombre  = item.nombre.length > maxNom
      ? item.nombre.slice(0, maxNom - 1) + '.'
      : item.nombre

    buf.boldOn().size(1, 2)
    buf.line(`${prefix}${nombre}`)
    buf.size(1, 1).boldOff()

    if (item.notas) {
      buf.boldOn()
      buf.line(`  >> ${item.notas}`)
      buf.boldOff()
    }
    buf.line('')
  }

  buf.line('-'.repeat(W))

  // ── Nota especial ───────────────────────────────────────────────────────
  if (notaOrden) {
    buf.boldOn().line('  NOTA:').boldOff()
    const words = notaOrden.split(' ')
    let cur = ''
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word
      if (test.length > W - 4) { if (cur) buf.line(`  ${cur}`); cur = word }
      else cur = test
    }
    if (cur) buf.line(`  ${cur}`)
    buf.line('-'.repeat(W))
  }

  buf.alignCenter()
  buf.line(`*** ${hora} ***`)
  buf.alignLeft()
  buf.feed(4)
  buf.cut()
  return buf.toBase64()
}
