import { useState, useRef, useEffect } from 'react'
import { supabase } from '../supabase'
import type { CartItem, UsuarioPerfil } from '../types'
import toast from 'react-hot-toast'
import QRScannerModal from './QRScannerModal'
import ClienteHistorialModal from './ClienteHistorialModal'
import {
  crearIntentoPago,
  obtenerEstadoIntento,
  cancelarIntentoPago,
  cancelarIntentoAtascado,
  guardarUltimoIntento,
  limpiarUltimoIntento,
  liberarTerminal,
  interpretarResultado,
  MP_CONFIGURADO,
} from '../services/mercadopago'
import { registrarAccion } from '../services/auditLog'
import { imprimirPorTipo, hayImpresora, buildReciboHTML, buildComandaHTML } from '../services/printer'
import { addToQueue } from '../services/offlineQueue'

interface Props {
  cart: CartItem[]
  total: number
  descuentoMonto?: number
  mesaId: string
  mesaNombre: string
  ordenId: string | null
  cajero: UsuarioPerfil
  onClose: () => void
  onCompletado: () => void
  // C4 — split: cobrar solo un subset de ítems
  onCobrarParcial?: (items: CartItem[]) => void
}

type MetodoPago = 'efectivo' | 'tarjeta' | 'mixto'
type Paso = 'pago' | 'procesando' | 'exito'
type MpEstado = 'idle' | 'creando' | 'esperando' | 'cancelado' | 'rechazado' | 'error'

interface ClienteCompleto {
  id: string
  nombre: string
  last_name: string
  correo: string
  telefono: string | null
  engranajes: number
  nivel: string | null
  racha_dias: number | null
  ultima_visita: string | null
  cumple_anio: number | null
  fecha_nac: string | null
  recompensas_disponibles: RecompensaDisponible[]
  // D1 — descuento empleado
  es_empleado?: boolean
}

interface RecompensaDisponible {
  id: string
  nombre: string
  emoji: string
  costo: number
  categoria: string
}

interface Promocion {
  id: string
  nombre: string
  tipo: 'porcentaje' | 'monto_fijo'
  valor: number
  hora_inicio: string | null
  hora_fin: string | null
  dias: number[] | null
  activa: boolean
}

function nivelColor(nivel: string | null) {
  switch (nivel) {
    case 'Maestro Constructor': return '#a855f7'
    case 'Constructor': return '#3b82f6'
    case 'Aprendiz': return '#22c55e'
    default: return 'var(--yellow)'
  }
}

export default function CheckoutModal({ cart, total, descuentoMonto, mesaId, mesaNombre, ordenId, cajero, onClose, onCompletado, onCobrarParcial }: Props) {
  const [paso, setPaso] = useState<Paso>('pago')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')
  const [efectivoInput, setEfectivoInput] = useState('')
  const [efectivoMixto, setEfectivoMixto] = useState('')
  const [tarjetaMixto, setTarjetaMixto] = useState('')
  const [cliente, setCliente] = useState<ClienteCompleto | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [canjePreview, setCanjePreview] = useState<{ token_id: string; usuario: { nombre: string; last_name: string }; rewards: { nombre: string; costo: number }[]; total_costo: number; engranajes: number } | null>(null)
  const [canjeConfirmando, setCanjeConfirmando] = useState(false)
  const [telefonoInput, setTelefonoInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [canjeItems, setCanjeItems] = useState<Set<string>>(new Set())
  const [cambioFinal, setCambioFinal] = useState(0)
  const [engranajeFinal, setEngranajeFinal] = useState(0)
  const [canjeFinal, setCanjeFinal] = useState<{ nombre: string; emoji: string; cantidad: number; costo: number }[]>([])
  const [saldoFinal, setSaldoFinal] = useState(0)
  // B2 — propina con montos fijos en pesos
  const [propinaMontFijo, setPropinaMontFijo] = useState<number>(0) // 0, 10, 20, 50
  const [propinaCustomInput, setPropinaCustomInput] = useState('')
  const [propinaCustomMode, setPropinaCustomMode] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // D1 — descuento empleado
  const [descEmpleadoActivo, setDescEmpleadoActivo] = useState(false)
  // Descuento por volumen (10% si algún ítem tiene qty >= 3)
  const [descVolumenActivo, setDescVolumenActivo] = useState(false)
  // C4 — split de cuenta
  const [splitMode, setSplitMode] = useState(false)
  const [splitAsignacion, setSplitAsignacion] = useState<Record<string, 1 | 2>>({}) // menu_id → cuenta
  const [numeroOrden, setNumeroOrden] = useState<number | null>(null)
  const [mpEstado, setMpEstado] = useState<MpEstado>('idle')
  // Encuesta de satisfacción
  const [encuestaCalif, setEncuestaCalif] = useState(0)
  const [encuestaComentario, setEncuestaComentario] = useState('')
  const [encuestaEnviada, setEncuestaEnviada] = useState(false)
  const [encuestaVentaId, setEncuestaVentaId] = useState<string | null>(null)
  const [mpIntentoId, setMpIntentoId] = useState<string | null>(null)
  const [mpMensaje, setMpMensaje] = useState('')
  const mpPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const procesandoRef = useRef(false)
  // Mejora 2 — RFC para factura
  const [rfcCliente, setRfcCliente] = useState('')
  const [showRfc, setShowRfc] = useState(false)
  // Mejora 3 — Historial del cliente
  const [showHistorial, setShowHistorial] = useState(false)
  // Mejora 4 — Promociones automáticas
  const [promociones, setPromociones] = useState<Promocion[]>([])
  const [promoActivas, setPromoActivas] = useState<Set<string>>(new Set())
  // Cupones
  const [cuponInput, setCuponInput] = useState('')
  const [cuponAplicado, setCuponAplicado] = useState<{ id: string; codigo: string; tipo: string; valor: number; usos_maximos?: number; usos_actuales?: number } | null>(null)
  const [cuponBuscando, setCuponBuscando] = useState(false)
  const [cuponError, setCuponError] = useState('')
  // Consumo empleado
  const [guardandoConsumo, setGuardandoConsumo] = useState(false)

  // Limpiar polling de MP al desmontar
  useEffect(() => {
    return () => {
      if (mpPollRef.current) clearInterval(mpPollRef.current)
      if (mpTimeoutRef.current) clearTimeout(mpTimeoutRef.current)
    }
  }, [])

  // Mejora 4 — Cargar y filtrar promociones activas al abrir el modal
  useEffect(() => {
    async function cargarPromociones() {
      try {
        const { data, error } = await supabase
          .from('promociones')
          .select('id, nombre, tipo, valor, hora_inicio, hora_fin, dias, activa')
          .eq('activa', true)
        if (error || !data) return

        const ahora = new Date()
        const horaActual = ahora.getHours() * 60 + ahora.getMinutes()
        const diaSemana = ahora.getDay() // 0=Dom ... 6=Sab

        const filtradas = (data as Promocion[]).filter(p => {
          // Filtrar por hora
          if (p.hora_inicio && p.hora_fin) {
            const [hI, mI] = p.hora_inicio.split(':').map(Number)
            const [hF, mFin] = p.hora_fin.split(':').map(Number)
            const inicio = hI * 60 + mI
            const fin = hF * 60 + mFin
            if (horaActual < inicio || horaActual > fin) return false
          }
          // Filtrar por días
          if (p.dias && Array.isArray(p.dias) && p.dias.length > 0) {
            if (!p.dias.includes(diaSemana)) return false
          }
          return true
        })

        setPromociones(filtradas)
        // Activar todas por defecto
        setPromoActivas(new Set(filtradas.map(p => p.id)))
      } catch {
        // silencioso si tabla no existe
      }
    }
    cargarPromociones()
  }, [])

  // Costo en engranajes de un artículo ($50 → 150 eng, $35 → 105 eng, etc.)
  function costoEngranajes(precio: number, cantidad: number) {
    return Math.round(precio * 3) * cantidad
  }

  // Monto en pesos y engranajes de los ítems marcados para canje
  const montoCanjeado = cart
    .filter(i => canjeItems.has(i.menu_id))
    .reduce((s, i) => s + i.precio * i.cantidad, 0)
  const engranajesTotalesCanje = cart
    .filter(i => canjeItems.has(i.menu_id))
    .reduce((s, i) => s + costoEngranajes(i.precio, i.cantidad), 0)

  // B2 — propina en pesos fijos (custom: máx 5× el total para evitar errores de tipeo)
  const propinaCustomRaw = parseFloat(propinaCustomInput) || 0
  const propinaCustomValida = Math.min(propinaCustomRaw, Math.max(total * 5, 500))
  const propinaMonto = propinaCustomMode ? propinaCustomValida : propinaMontFijo
  const propinaAdvertencia = propinaCustomMode && propinaCustomRaw > total
  // D1 — descuento empleado: 50% máximo $200
  const descEmpleadoMonto = (cliente?.es_empleado && descEmpleadoActivo)
    ? Math.min(total * 0.5, 200)
    : 0
  // Mejora 4 — descuento de promociones activas
  const descPromoMonto = promociones
    .filter(p => promoActivas.has(p.id))
    .reduce((acc, p) => {
      if (p.tipo === 'porcentaje') return acc + (total * p.valor) / 100
      if (p.tipo === 'monto_fijo') return acc + p.valor
      return acc
    }, 0)
  // Descuento por volumen: 10% sobre ítems con qty >= 3
  const itemsConVolumen = cart.filter(i => i.cantidad >= 3)
  const elegibleVolumen = itemsConVolumen.length > 0
  const descVolumenMonto = (elegibleVolumen && descVolumenActivo)
    ? itemsConVolumen.reduce((s, i) => s + i.precio * i.cantidad * 0.1, 0)
    : 0
  // Cupón
  const descCuponMonto = cuponAplicado
    ? cuponAplicado.tipo === 'porcentaje'
      ? (total * cuponAplicado.valor) / 100
      : cuponAplicado.valor
    : 0
  const totalACobrar = Math.max(0, total - montoCanjeado - descEmpleadoMonto - descPromoMonto - descCuponMonto - descVolumenMonto) + propinaMonto
  const efectivo = parseFloat(efectivoInput) || 0
  const efectivoMixtoVal = parseFloat(efectivoMixto) || 0
  const tarjetaMixtoVal = parseFloat(tarjetaMixto) || 0
  const cambio = metodoPago === 'efectivo'
    ? Math.max(0, efectivo - totalACobrar)
    : metodoPago === 'mixto'
      ? Math.max(0, efectivoMixtoVal + tarjetaMixtoVal - totalACobrar)
      : 0
  const engranajes = Math.max(0, Math.floor((total - montoCanjeado) / 10))
  const tieneEngranajeSuficiente = !cliente || engranajesTotalesCanje <= (cliente.engranajes ?? 0)
  const puedeConfirmar = tieneEngranajeSuficiente && (
    metodoPago === 'tarjeta' ||
    (metodoPago === 'efectivo' && efectivo >= totalACobrar) ||
    (metodoPago === 'mixto' && efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar)
  )

  async function buscarPorTelefono() {
    const query = telefonoInput.trim()
    if (!query?.trim() || query.trim().length < 3) { toast.error('Ingresa al menos 3 caracteres'); return }
    setBuscando(true)
    try {
      const SELECT = 'id, nombre, last_name, correo, telefono, engranajes, nivel, racha_dias, ultima_visita, cumple_anio, fecha_nac, es_empleado'

      // 1. Exact phone match
      let { data, error } = await supabase
        .from('usuarios')
        .select(SELECT)
        .eq('telefono', query)
        .maybeSingle()

      // 2. Phone suffix match
      if (!data) {
        const res = await supabase
          .from('usuarios')
          .select(SELECT)
          .ilike('telefono', `%${query}`)
          .limit(1)
          .maybeSingle()
        data = res.data
        error = res.error
      }

      // 3. Email match
      if (!data) {
        const res = await supabase
          .from('usuarios')
          .select(SELECT)
          .ilike('correo', `%${query}%`)
          .limit(1)
          .maybeSingle()
        data = res.data
        error = res.error
      }

      // 4. Name match
      if (!data) {
        const res = await supabase
          .from('usuarios')
          .select(SELECT)
          .or(`nombre.ilike.%${query}%,last_name.ilike.%${query}%`)
          .limit(1)
          .maybeSingle()
        data = res.data
        error = res.error
      }

      if (error || !data) {
        toast.error('No se encontró ningún cliente')
        setBuscando(false)
        return
      }

      // Fetch recompensas they can afford
      const { data: recompensas } = await supabase
        .from('recompensas')
        .select('id, nombre, emoji, costo, categoria')
        .eq('disponible', true)
        .lte('costo', data.engranajes ?? 0)
        .order('costo', { ascending: true })

      const clienteData: ClienteCompleto = {
        ...data,
        recompensas_disponibles: (recompensas ?? []) as RecompensaDisponible[],
      }
      setCliente(clienteData)
      setCanjeItems(new Set())
      setShowSearch(false)
      setTelefonoInput('')
      // D1 — activar descuento empleado automáticamente
      if (clienteData.es_empleado) {
        setDescEmpleadoActivo(true)
        toast.success(`Cliente: ${data.nombre} ${data.last_name} — 👷 Empleado`)
        registrarAccion(
          'descuento_empleado',
          { monto: Math.min(total * 0.5, 200), cliente: `${data.nombre} ${data.last_name}` },
          cajero.nombre,
        )
      } else {
        setDescEmpleadoActivo(false)
        toast.success(`Cliente: ${data.nombre} ${data.last_name}`)
      }
    } catch (err) {
      toast.error('Error al buscar cliente')
    } finally {
      setBuscando(false)
    }
  }

  async function aplicarCupon() {
    const codigo = cuponInput.trim().toUpperCase()
    if (!codigo) return
    setCuponBuscando(true)
    setCuponError('')
    const hoy = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('cupones')
      .select('id, codigo, tipo, valor, usos_maximos, usos_actuales, valido_desde, valido_hasta, activo')
      .eq('codigo', codigo)
      .eq('activo', true)
      .maybeSingle()
    setCuponBuscando(false)
    if (error || !data) { setCuponError('Cupón no encontrado o inactivo'); return }
    if (data.usos_maximos != null && (data.usos_actuales ?? 0) >= data.usos_maximos) { setCuponError('Cupón agotado'); return }
    if (data.valido_desde && hoy < data.valido_desde) { setCuponError('Cupón aún no es válido'); return }
    if (data.valido_hasta && hoy > data.valido_hasta) { setCuponError('Cupón expirado'); return }
    setCuponAplicado({ id: data.id, codigo: data.codigo, tipo: data.tipo, valor: data.valor, usos_maximos: data.usos_maximos, usos_actuales: data.usos_actuales })
    setCuponInput('')
    toast.success(`Cupón ${data.codigo} aplicado`)
  }

  async function procesarQR(texto: string) {
    setShowScanner(false)
    try {
      let tokenId = texto.trim()
      try { const url = new URL(texto); const t = url.searchParams.get('token'); if (t) tokenId = t } catch {}
      if (!tokenId) { toast.error('QR inválido'); return }

      const { data, error } = await supabase.rpc('preview_qr_token', { p_token_id: tokenId })
      if (error) { toast.error('QR inválido o expirado'); return }
      if (!data) { toast.error('No se pudo leer el QR'); return }

      const info = Array.isArray(data) ? data[0] : data
      if (!info || !info.usuario) { toast.error('QR no contiene datos de usuario'); return }

      const uid = info.usuario.id ?? ''

      // Re-fetchear datos reales del usuario directamente (el RPC puede devolver engranajes desactualizados)
      const { data: usuarioReal } = await supabase
        .from('usuarios')
        .select('id, nombre, last_name, correo, telefono, engranajes, nivel, racha_dias, ultima_visita, cumple_anio, fecha_nac, es_empleado')
        .eq('id', uid)
        .maybeSingle()

      const engActuales = usuarioReal?.engranajes ?? info.engranajes ?? 0

      // ── Detectar si es un QR de CANJE DE RECOMPENSA ──────────────────────────
      if (info.rewards && info.rewards.length > 0 && info.total_costo > 0) {
        setCanjePreview({
          token_id:    tokenId,
          usuario:     info.usuario,
          rewards:     info.rewards,
          total_costo: info.total_costo,
          engranajes:  engActuales,
        })
        return
      }

      // ── QR normal: identificar cliente para acreditar engranajes ─────────────
      const { data: recompensas } = await supabase
        .from('recompensas')
        .select('id, nombre, emoji, costo, categoria')
        .eq('disponible', true)
        .lte('costo', engActuales)
        .order('costo', { ascending: true })

      setCliente({
        id: uid,
        nombre: usuarioReal?.nombre ?? info.usuario.nombre ?? '',
        last_name: usuarioReal?.last_name ?? info.usuario.last_name ?? '',
        correo: usuarioReal?.correo ?? info.usuario.correo ?? '',
        telefono: usuarioReal?.telefono ?? null,
        engranajes: engActuales,
        nivel: usuarioReal?.nivel ?? null,
        racha_dias: usuarioReal?.racha_dias ?? null,
        ultima_visita: usuarioReal?.ultima_visita ?? null,
        cumple_anio: usuarioReal?.cumple_anio ?? null,
        fecha_nac: usuarioReal?.fecha_nac ?? null,
        recompensas_disponibles: (recompensas ?? []) as RecompensaDisponible[],
      })
      setCanjeItems(new Set())
      toast.success(`Cliente: ${usuarioReal?.nombre ?? info.usuario.nombre} ${usuarioReal?.last_name ?? info.usuario.last_name}`)
    } catch (err) {
      toast.error('Error al leer QR')
    }
  }

  async function confirmarCanjeRecompensa() {
    if (canjeConfirmando) return
    if (!canjePreview) return
    setCanjeConfirmando(true)
    try {
      const { data, error } = await supabase.rpc('process_qr_redemption', { p_token_id: canjePreview.token_id })
      if (error) throw new Error(error.message)
      const result = Array.isArray(data) ? data[0] : data
      if (result?.error) throw new Error(result.error)
      if (!result?.ok) throw new Error('No se pudo procesar el canje')
      toast.success(`✅ Canje confirmado para ${canjePreview.usuario.nombre}`)
      setCanjePreview(null)
    } catch (err: any) {
      toast.error(err.message ?? 'Error al confirmar el canje')
    } finally {
      setCanjeConfirmando(false)
    }
  }

  function iniciarPolling(intentoId: string) {
    mpPollRef.current = setInterval(async () => {
      try {
        const intento = await obtenerEstadoIntento(intentoId)
        if (intento.state === 'FINISHED') {
          clearInterval(mpPollRef.current!)
          if (mpTimeoutRef.current) clearTimeout(mpTimeoutRef.current)
          const resultado = interpretarResultado(intento)
          if (resultado.aprobado) {
            setMpEstado('idle')
            setMpIntentoId(null)
            await confirmarVenta()
          } else {
            setMpEstado('rechazado')
            setMpMensaje('Pago rechazado por la terminal')
          }
        } else if (intento.state === 'CANCELED') {
          clearInterval(mpPollRef.current!)
          if (mpTimeoutRef.current) clearTimeout(mpTimeoutRef.current)
          setMpEstado('cancelado')
          setMpMensaje('El cliente canceló en la terminal')
        } else if (intento.state === 'ERROR') {
          clearInterval(mpPollRef.current!)
          if (mpTimeoutRef.current) clearTimeout(mpTimeoutRef.current)
          setMpEstado('error')
          setMpMensaje('Error en la terminal')
        }
        // OPEN, ON_TERMINAL, PROCESSING → seguir esperando
      } catch {
        // error de red — seguir intentando
      }
    }, 3000)

    // Timeout de 5 minutos: cancelar intento y mostrar error
    mpTimeoutRef.current = setTimeout(async () => {
      if (mpPollRef.current) clearInterval(mpPollRef.current)
      if (intentoId) await cancelarIntentoPago(intentoId).catch(() => {})
      setMpEstado('error')
      setMpIntentoId(null)
      setMpMensaje('Tiempo de espera agotado (5 min). Intenta de nuevo.')
    }, 5 * 60 * 1000)
  }

  async function iniciarPagoTerminal() {
    setMpEstado('creando')
    setMpMensaje('')
    try {
      // Cancelar intento atascado del ID guardado en localStorage (+ intento DELETE sin ID)
      await cancelarIntentoAtascado()
      // Dar tiempo a que MP procese la cancelación
      await new Promise(r => setTimeout(r, 1500))

      const intento = await crearIntentoPago(
        totalACobrar,
        'El Café del Constructor',
        ordenId ?? `pos-${Date.now()}`,
      )
      guardarUltimoIntento(intento.id)
      setMpIntentoId(intento.id)
      setMpEstado('esperando')
      iniciarPolling(intento.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al conectar con la terminal'
      setMpEstado('error')
      setMpMensaje(msg)
    }
  }

  async function cancelarPagoTerminal() {
    if (mpPollRef.current) clearInterval(mpPollRef.current)
    if (mpIntentoId) {
      await cancelarIntentoPago(mpIntentoId).catch(() => {})
      limpiarUltimoIntento()
    }
    setMpEstado('idle')
    setMpIntentoId(null)
    setMpMensaje('')
  }

  function playCashRegisterSound() {
    try {
      const ctx = new AudioContext()
      // High ding
      const osc1 = ctx.createOscillator()
      const g1 = ctx.createGain()
      osc1.connect(g1); g1.connect(ctx.destination)
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(1400, ctx.currentTime)
      osc1.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.2)
      g1.gain.setValueAtTime(0.25, ctx.currentTime)
      g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc1.start(); osc1.stop(ctx.currentTime + 0.4)
      // Register ka-ching
      const osc2 = ctx.createOscillator()
      const g2 = ctx.createGain()
      osc2.connect(g2); g2.connect(ctx.destination)
      osc2.type = 'triangle'
      osc2.frequency.setValueAtTime(900, ctx.currentTime + 0.05)
      osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.15)
      g2.gain.setValueAtTime(0.2, ctx.currentTime + 0.05)
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc2.start(ctx.currentTime + 0.05); osc2.stop(ctx.currentTime + 0.3)
    } catch {}
  }

  // Mejora 1 — Imprimir recibo térmico
  async function enviarEncuesta(calificacion: number) {
    setEncuestaCalif(calificacion)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('encuestas').insert({
      venta_id: encuestaVentaId,
      usuario_id: user?.id ?? null,
      calificacion,
      comentario: encuestaComentario.trim() || null,
      mesa_nombre: mesaNombre,
    })
    if (error) { console.error('Error al enviar encuesta:', error.message); setEncuestaEnviada(false); return }
    setEncuestaEnviada(true)
  }

  async function imprimirRecibo() {
    const fecha = new Date().toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    const ordenStr = numeroOrden ? `#${String(numeroOrden).padStart(3, '0')}` : ''
    const metodoPagoLabel =
      metodoPago === 'mixto' ? 'Mixto (Efec+Tarj)' :
      metodoPago === 'efectivo' ? 'Efectivo' : 'Tarjeta'

    const reciboItems = cart.map(i => ({
      emoji: i.emoji, nombre: i.nombre, cantidad: i.cantidad,
      precio: i.precio, notas: i.notas ?? null,
    }))

    const subtotalBase = total + (descuentoMonto ?? 0)
    const descuentoTotal = (descuentoMonto ?? 0) + montoCanjeado + descEmpleadoMonto + descPromoMonto + descCuponMonto + descVolumenMonto

    const { data: ajustes } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['rest_nombre', 'rest_direccion', 'rest_telefono'])
    const aj: Record<string, string> = {}
    for (const r of ajustes ?? []) aj[r.clave] = r.valor

    const escpos = buildReciboHTML({
      fecha, ordenStr, mesaNombre,
      items: reciboItems,
      canjeItems: canjeFinal,
      subtotalBase, descuentoTotal, propinaMonto, totalACobrar,
      metodoPagoLabel, cambioFinal, metodoPago,
      efectivoMixto: metodoPago === 'mixto' ? efectivoMixtoVal : undefined,
      tarjetaMixto:  metodoPago === 'mixto' ? tarjetaMixtoVal  : undefined,
      engranajeFinal, saldoFinal,
      clienteNombre: cliente ? `${cliente.nombre} ${cliente.last_name}` : undefined,
      cajeroNombre: `${cajero.nombre} ${cajero.last_name}`,
      turno: cajero.turno,
      nombreLocal: aj['rest_nombre'],
      direccionLocal: aj['rest_direccion'],
      telefonoLocal: aj['rest_telefono'],
    })

    if (!hayImpresora('caja')) {
      toast('No hay impresora de caja configurada', { icon: '⚠️', duration: 3000 })
      return
    }
    const ok = await imprimirPorTipo('caja', escpos)
    if (ok) return
    toast.error('Error al imprimir — verifica la configuracion de impresora')
  }

  async function registrarConsumoEmpleado() {
    if (guardandoConsumo) return
    const ok = window.confirm(`¿Registrar consumo de empleado para ${mesaNombre}?\nSe enviará comanda a cocina sin cobro.`)
    if (!ok) return
    setGuardandoConsumo(true)
    try {
      const items = cart.map(i => ({ emoji: i.emoji, nombre: i.nombre, cantidad: i.cantidad, notas: i.notas ?? null }))
      const { error: consumoError } = await supabase.from('consumos_empleados').insert({
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        items,
        total_estimado: total,
        turno: cajero.turno ?? 'mañana',
        notas: `Mesa: ${mesaNombre}`,
      })
      if (consumoError) { toast.error('Error al registrar consumo: ' + consumoError.message); return }
      // Imprimir comanda con banner de consumo empleado
      const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      const comandaHtml = buildComandaHTML({
        ordenStr: '', mesaNombre, cajeroNombre: `${cajero.nombre} ${cajero.last_name}`,
        tipo: 'comedor', hora, items, esConsumoEmpleado: true,
      })
      await imprimirPorTipo('cocina', comandaHtml)
      toast.success('Consumo empleado registrado — comanda enviada a cocina')
      onCompletado()
    } catch (err) {
      toast.error('Error al registrar consumo')
    } finally {
      setGuardandoConsumo(false)
    }
  }

  async function confirmarVenta() {
    if (paso !== 'pago' || procesandoRef.current) return  // guard síncrono anti-doble-pago

    // BUG 4: Revalidar cupón justo antes de registrar la venta
    if (cuponAplicado) {
      const hoy = new Date().toISOString().split('T')[0]
      const { data: cuponActual, error: cuponCheckErr } = await supabase
        .from('cupones')
        .select('id, activo, usos_maximos, usos_actuales, valido_desde, valido_hasta')
        .eq('id', cuponAplicado.id)
        .maybeSingle()
      if (cuponCheckErr || !cuponActual || !cuponActual.activo) {
        setCuponAplicado(null)
        toast.error('El cupón ya no es válido — fue eliminado o desactivado')
        return
      }
      if (cuponActual.usos_maximos != null && (cuponActual.usos_actuales ?? 0) >= cuponActual.usos_maximos) {
        setCuponAplicado(null)
        toast.error('El cupón ya se agotó')
        return
      }
      if (cuponActual.valido_hasta && hoy > cuponActual.valido_hasta) {
        setCuponAplicado(null)
        toast.error('El cupón expiró')
        return
      }
    }

    // BUG 5: Verificar que todos los items tengan asignación en modo split
    if (splitMode) {
      const itemsSinAsignar = cart.filter(i => !splitAsignacion[i.menu_id])
      if (itemsSinAsignar.length > 0) {
        toast.error(`${itemsSinAsignar.length} ítem(s) sin asignar a ninguna cuenta`)
        return
      }
    }

    procesandoRef.current = true
    playCashRegisterSound()
    setPaso('procesando')
    try {
      // Mejora 2 — RFC: intentar insertar, silencioso si columna no existe
      const ventaPayload: Record<string, unknown> = {
        orden_id: ordenId,
        mesa_nombre: mesaNombre,
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        usuario_id: cliente?.id || null,
        subtotal: total + (descuentoMonto ?? 0),
        descuento: Math.min((descuentoMonto ?? 0) + montoCanjeado + descEmpleadoMonto + descPromoMonto + descCuponMonto + descVolumenMonto, total + (descuentoMonto ?? 0)),
        total: totalACobrar,
        metodo_pago: metodoPago,
        efectivo_recibido: metodoPago === 'efectivo' ? efectivo : metodoPago === 'mixto' ? efectivoMixtoVal : null,
        tarjeta_recibido: metodoPago === 'tarjeta' ? totalACobrar : metodoPago === 'mixto' ? tarjetaMixtoVal : null,
        cambio: metodoPago === 'efectivo' ? cambio : metodoPago === 'mixto' ? cambio : null,
        engranajes_ganados: cliente ? engranajes : 0,
        estado: 'completada',
      }
      if (rfcCliente.trim()) ventaPayload.rfc_cliente = rfcCliente.trim().toUpperCase()
      if (propinaMonto > 0) ventaPayload.propina = propinaMonto

      const { data: ventaData, error: ventaError } = await supabase
        .from('ventas')
        .insert(ventaPayload)
        .select().single()

      if (ventaError || !ventaData) throw new Error(ventaError?.message || 'Error al crear venta')
      setEncuestaVentaId(ventaData.id)

      const items = cart.map(i => ({
        venta_id: ventaData.id,
        // Usar producto_id (ID real) si está disponible; si no, extraer quitando notas concatenadas del cartKey
        menu_id: i.producto_id ?? i.menu_id.split('__')[0],
        nombre: i.nombre, emoji: i.emoji, precio: i.precio,
        cantidad: i.cantidad, subtotal: parseFloat((i.precio * i.cantidad).toFixed(2)),
      }))
      const { error: itemsError } = await supabase.from('venta_items').insert(items)
      if (itemsError) throw new Error('Error registrando detalle de venta: ' + itemsError.message)

      // Descontar inventario — usa recetas si están definidas, si no fallback por menu_id
      // IMPORTANTE: item.menu_id puede ser "uuid__notas" cuando tiene modificadores.
      // Siempre extraer el ID real del producto antes de buscar en recetas/inventario.
      const stockBajoItems: string[] = []
      for (const item of cart) {
        const realMenuId = item.producto_id ?? item.menu_id.split('__')[0]

        // Buscar receta del producto usando el ID real (sin sufijo de notas)
        const { data: recetaItems } = await supabase
          .from('recetas')
          .select('cantidad_por_unidad, inventario_id, inventario:inventario_id(id, stock_actual, stock_minimo, nombre)')
          .eq('menu_id', realMenuId)

        if (recetaItems && recetaItems.length > 0) {
          // Descontar cada ingrediente de la receta
          for (const receta of recetaItems) {
            const inv = receta.inventario as unknown as { id: string; stock_actual: number | null; stock_minimo: number | null; nombre: string } | null
            if (!inv) continue
            const cantDescuento = (receta.cantidad_por_unidad as number) * item.cantidad
            const nuevoStock = Math.max(0, (inv.stock_actual ?? 0) - cantDescuento)
            const { error: invError } = await supabase.from('inventario').update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() }).eq('id', inv.id)
            if (invError) console.error('Error al descontar inventario (receta):', invError.message)
            void supabase.from('historial_inventario').insert({
              inventario_id: inv.id,
              menu_id: realMenuId,
              tipo: 'venta',
              cantidad: -cantDescuento,
              nota: `Receta: ${item.nombre} ×${item.cantidad} en ${mesaNombre}`,
              referencia_id: ventaData.id,
            })
            if (inv.stock_minimo != null && nuevoStock <= inv.stock_minimo) {
              stockBajoItems.push(inv.nombre)
            }
          }
        } else {
          // Fallback: buscar por menu_id real directo en inventario
          const { data: inv } = await supabase
            .from('inventario')
            .select('id, stock_actual, stock_minimo')
            .eq('menu_id', realMenuId)
            .maybeSingle()
          if (inv) {
            const nuevoStock = Math.max(0, (inv.stock_actual ?? 0) - item.cantidad)
            const { error: invFallbackError } = await supabase.from('inventario').update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() }).eq('id', inv.id)
            if (invFallbackError) console.error('Error al descontar inventario (fallback):', invFallbackError.message)
            void supabase.from('historial_inventario').insert({
              inventario_id: inv.id,
              menu_id: realMenuId,
              tipo: 'venta',
              cantidad: -item.cantidad,
              nota: `Venta en ${mesaNombre} — ${item.nombre}`,
              referencia_id: ventaData.id,
            })
            if (inv.stock_minimo != null && nuevoStock <= inv.stock_minimo) {
              stockBajoItems.push(item.nombre)
            }
          }
        }
      }
      if (stockBajoItems.length > 0) {
        toast(`📦 Stock bajo: ${stockBajoItems.join(', ')}`, { duration: 6000, icon: '⚠️' })
      }

      if (ordenId) {
        await supabase.from('ordenes').update({ estado: 'pagada', cerrada_at: new Date().toISOString() }).eq('id', ordenId)
      }
      if (ordenId) {
        // Libera todas las mesas de la orden (incluye mesas juntadas)
        await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('orden_id', ordenId)
      } else if (mesaId) {
        await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('id', mesaId)
      }

      if (cliente?.id) {
        const { data: ud } = await supabase.from('usuarios').select('engranajes, engranajes_acumulados, ultima_visita, racha_dias').eq('id', cliente.id).single()
        if (ud) {
          const saldoActual = ud.engranajes || 0
          let nuevoSaldo = saldoActual

          // Deducir engranajes canjeados
          if (engranajesTotalesCanje > 0) {
            nuevoSaldo -= engranajesTotalesCanje
            await supabase.from('historial').insert({
              usuario_id: cliente.id, tipo: 'canje', engranajes: -engranajesTotalesCanje,
              titulo: `Canje de artículos en ${mesaNombre} — ${canjeItems.size} ítem(s)`,
            })
          }

          // Acumular engranajes por la parte pagada en efectivo/tarjeta
          if (engranajes > 0) {
            nuevoSaldo += engranajes
            await supabase.from('historial').insert({
              usuario_id: cliente.id, tipo: 'recarga', engranajes,
              titulo: `Compra en ${mesaNombre} — $${totalACobrar.toFixed(2)} MXN`,
            })
          }

          // Calcular racha de días
          const hoyStr = new Date().toISOString().slice(0, 10)
          const ultimaStr = (ud.ultima_visita as string | null)?.slice(0, 10) ?? null
          let nuevaRacha = (ud.racha_dias as number | null) ?? 0
          if (ultimaStr !== hoyStr) {
            const ayer = new Date()
            ayer.setDate(ayer.getDate() - 1)
            nuevaRacha = ultimaStr === ayer.toISOString().slice(0, 10)
              ? ((ud.racha_dias as number | null) ?? 0) + 1
              : 1
          }

          // Actualizar saldo, visita, racha y acumulados (siempre, para registrar la visita)
          const updatePayload: Record<string, unknown> = {
            engranajes: nuevoSaldo,
            ultima_visita: new Date().toISOString(),
            racha_dias: nuevaRacha,
          }
          if (engranajes > 0) {
            updatePayload.engranajes_acumulados = ((ud.engranajes_acumulados as number | null) ?? 0) + engranajes
          }
          await supabase.from('usuarios').update(updatePayload).eq('id', cliente.id)

          // Notificación email + push via Edge Function
          supabase.functions.invoke('Notificacion-Push', {
            body: {
              usuario_id: cliente.id,
              titulo: engranajes > 0
                ? `⚙️ +${engranajes} engranajes acreditados`
                : `✅ Gracias por tu compra`,
              descripcion: `Gracias por tu visita a El Café del Constructor.`,
              total: totalACobrar,
              engranajes,
              saldo_nuevo: nuevoSaldo,
              metodo: metodoPago,
              canje_items: cart
                .filter(i => canjeItems.has(i.menu_id))
                .map(i => ({
                  nombre: i.nombre,
                  emoji: i.emoji,
                  cantidad: i.cantidad,
                  costo: costoEngranajes(i.precio, i.cantidad),
                })),
            },
          }).catch(() => {})
        }
      }

      // Incrementar uso de cupón si aplica — incremento atómico en BD para evitar race condition
      if (cuponAplicado) {
        const { error: cuponError } = await supabase.rpc('incrementar_uso_cupon', {
          p_cupon_id: cuponAplicado.id,
          p_usos_maximos: cuponAplicado.usos_maximos ?? 999999,
        })
        if (cuponError) {
          // Fallback: UPDATE plano si el RPC no existe todavía
          await supabase
            .from('cupones')
            .update({ usos_actuales: (cuponAplicado.usos_actuales ?? 0) + 1 })
            .eq('id', cuponAplicado.id)
            .lt('usos_actuales', cuponAplicado.usos_maximos ?? 999999)
        }
      }

      // Fetch today's order count
      const hoy = new Date().toISOString().split('T')[0]
      const { count } = await supabase.from('ventas').select('*', { count: 'exact', head: true }).gte('created_at', hoy)
      setNumeroOrden(count)

      // Guardar datos para pantalla de éxito
      setCambioFinal(cambio)
      setEngranajeFinal(engranajes)
      setCanjeFinal(
        cart
          .filter(i => canjeItems.has(i.menu_id))
          .map(i => ({
            nombre: i.nombre,
            emoji: i.emoji,
            cantidad: i.cantidad,
            costo: costoEngranajes(i.precio, i.cantidad),
          }))
      )
      // Calcular saldo final real (cliente puede ser null si no había cliente)
      if (cliente?.id) {
        const { data: udFinal } = await supabase.from('usuarios').select('engranajes').eq('id', cliente.id).single()
        setSaldoFinal(udFinal?.engranajes ?? 0)
      }
      // D3 — Audit log: venta
      registrarAccion(
        'venta',
        { total: totalACobrar, metodo: metodoPago, mesa: mesaNombre },
        cajero.nombre,
      )
      setPaso('exito')
    } catch (err: any) {
      // Si el error es de red (offline), guardar en cola y marcar como exitoso
      const esErrorRed = !navigator.onLine
        || err?.message?.includes('Failed to fetch')
        || err?.message?.includes('NetworkError')
        || err?.message?.includes('fetch')

      if (esErrorRed) {
        addToQueue({
          cajero_id:         cajero.id,
          cajero_nombre:     `${cajero.nombre} ${cajero.last_name}`,
          mesa_nombre:       mesaNombre,
          orden_id:          ordenId,
          metodo_pago:       metodoPago as 'efectivo' | 'tarjeta' | 'mixto',
          subtotal:          total + (descuentoMonto ?? 0),
          descuento:         Math.min((descuentoMonto ?? 0) + montoCanjeado + descEmpleadoMonto + descPromoMonto + descCuponMonto + descVolumenMonto, total + (descuentoMonto ?? 0)),
          total:             totalACobrar,
          efectivo_recibido: metodoPago === 'efectivo' ? efectivo : metodoPago === 'mixto' ? efectivoMixtoVal : null,
          tarjeta_recibido:  metodoPago === 'tarjeta' ? totalACobrar : metodoPago === 'mixto' ? tarjetaMixtoVal : null,
          cambio:            metodoPago === 'efectivo' ? cambio : metodoPago === 'mixto' ? cambio : null,
          propina:           propinaMonto,
          engranajes_ganados: cliente ? engranajes : 0,
          usuario_id:        cliente?.id ?? null,
          rfc_cliente:       rfcCliente.trim() || undefined,
          items:             cart.map(i => ({
            menu_id:    i.menu_id,
            producto_id: i.producto_id,
            nombre:     i.nombre,
            emoji:      i.emoji,
            precio:     i.precio,
            cantidad:   i.cantidad,
            notas:      i.notas,
          })),
        })
        setCambioFinal(cambio)
        setEngranajeFinal(engranajes)
        setCanjeFinal([])
        setSaldoFinal(0)
        toast('⚡ Venta guardada sin conexión — se sincronizará automáticamente', { duration: 5000 })
        setPaso('exito')
      } else {
        toast.error('Error al procesar la venta')
        setPaso('pago')
        procesandoRef.current = false
      }
    }
  }

  // Keyboard shortcuts — placed after confirmarVenta so it's in scope
  useEffect(() => {
    if (paso !== 'pago') return
    function onKey(e: KeyboardEvent) {
      if (showCancelConfirm || showScanner || showSearch) return
      if (e.key === 'Escape') { e.preventDefault(); setShowCancelConfirm(true) }
      if (e.key === 'Enter' && puedeConfirmar) { e.preventDefault(); confirmarVenta() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paso, puedeConfirmar, showCancelConfirm, showScanner, showSearch])

  const hoy = new Date()
  const esCumple = (() => {
    if (!cliente?.fecha_nac) return false
    const nac = new Date(cliente.fecha_nac + 'T12:00:00')
    return nac.getMonth() === hoy.getMonth() && nac.getDate() === hoy.getDate()
  })()
  const isEmpleado = mesaNombre.startsWith('Empleado:')

  // ── Vista simplificada para consumo de empleado ──────────────────────
  if (isEmpleado) {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm animate-slide-up"
          style={{
            background: 'var(--charcoal)',
            border: '2px solid #f97316',
            borderTop: '4px solid #f97316',
            maxHeight: '90dvh',
            overflowY: 'auto',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--dark)' }}>
            <div>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#f97316' }}>
                👷 Consumo empleado
              </p>
              <p className="font-black text-lg" style={{ color: 'var(--text)' }}>Sin cobro</p>
            </div>
            <button onClick={onClose}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5"
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
              ✕ Cerrar
            </button>
          </div>

          {/* Resumen de productos */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Productos</p>
            <div className="flex flex-col gap-2">
              {cart.map(i => (
                <div key={i.menu_id} className="flex items-center justify-between gap-2">
                  <span className="text-sm" style={{ color: 'var(--text)' }}>
                    {i.emoji} {i.nombre}
                    {i.notas && <span className="text-xs ml-1" style={{ color: 'var(--muted)' }}>({i.notas})</span>}
                  </span>
                  <span className="text-sm font-black shrink-0" style={{ color: 'var(--muted)' }}>×{i.cantidad}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Valor estimado: <span className="font-black" style={{ color: 'var(--text)' }}>${total.toFixed(2)}</span> (no se cobra)</p>
            </div>
          </div>

          {/* Botón principal */}
          <div className="px-5 py-4 flex flex-col gap-2">
            <button
              onClick={registrarConsumoEmpleado}
              disabled={guardandoConsumo || cart.length === 0}
              className="w-full py-4 font-black text-base uppercase tracking-widest transition-all active:scale-95"
              style={{
                background: cart.length === 0 ? 'var(--dark)' : '#f97316',
                color: cart.length === 0 ? 'var(--muted)' : '#000',
                border: '2px solid #f97316',
                borderRadius: 0,
                cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {guardandoConsumo ? '⏳ Registrando...' : '👷 Registrar consumo — Sin cobro'}
            </button>
            <button onClick={onClose}
              className="w-full py-2 font-black text-xs uppercase tracking-wider"
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
        onClick={paso === 'pago' ? () => setShowCancelConfirm(true) : paso === 'exito' ? onCompletado : undefined}
      >
        <div
          className="w-full max-w-md animate-slide-up"
          style={{
            background: 'var(--charcoal)',
            border: '1px solid var(--border)',
            borderTop: '3px solid var(--yellow)',
            maxHeight: '90dvh',
            overflowY: 'auto',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--dark)', position: 'sticky', top: 0, zIndex: 1 }}>
            <div>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
                // Cobrar
              </p>
              <p className="font-black text-lg" style={{ color: 'var(--text)' }}>{mesaNombre}</p>
              {/* Mejora 4 — Badge de promociones activas */}
              {promociones.filter(p => promoActivas.has(p.id)).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {promociones.filter(p => promoActivas.has(p.id)).map(p => (
                    <span
                      key={p.id}
                      className="text-xs font-black px-1.5 py-0.5"
                      style={{
                        background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.4)',
                        color: '#22c55e',
                        borderRadius: 0,
                      }}
                    >
                      🏷️ {p.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {paso === 'pago' && (
              <div className="flex items-center gap-2">
                {/* C4 — Split de cuenta (solo si hay más de 1 ítem) */}
                {cart.length > 1 && (
                  <button
                    onClick={() => {
                      setSplitMode(v => !v)
                      // inicializar todos en C1
                      if (!splitMode) {
                        const init: Record<string, 1 | 2> = {}
                        cart.forEach(i => { init[i.menu_id] = 1 })
                        setSplitAsignacion(init)
                      }
                    }}
                    className="text-xs font-black px-2.5 py-1.5 uppercase tracking-wider transition-all"
                    style={{
                      background: splitMode ? 'rgba(59,130,246,0.15)' : 'var(--dark)',
                      color: splitMode ? '#3b82f6' : 'var(--muted)',
                      border: `1px solid ${splitMode ? '#3b82f6' : 'var(--border)'}`,
                      borderRadius: 0, cursor: 'pointer',
                    }}
                  >
                    ⚡ Dividir
                  </button>
                )}
                <button onClick={() => setShowCancelConfirm(true)} className="text-xl transition-colors"
                  style={{ color: 'var(--muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>✕</button>
              </div>
            )}
          </div>

          {paso === 'procesando' ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
              <span className="text-5xl animate-gear inline-block">⚙️</span>
              <p className="font-black text-sm uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                Procesando venta...
              </p>
            </div>
          ) : paso === 'exito' ? (
            /* ── Pantalla de éxito ── */
            <div className="flex flex-col" style={{ background: 'var(--dark)', position: 'relative' }}>
              <style>{`
                @keyframes confetti-fall {
                  0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
                  100% { transform: translateY(300px) rotate(540deg); opacity: 0; }
                }
              `}</style>
              <ConfettiOverlay />

              {/* Header branding */}
              <div className="flex flex-col items-center py-7 px-6 text-center"
                style={{ background: 'var(--charcoal)', borderBottom: '1px solid var(--border)' }}>
                <span className="text-3xl animate-gear inline-block mb-2">⚙️</span>
                <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
                  El Café del Constructor
                </p>
                <p className="font-black text-2xl uppercase tracking-wide mt-2" style={{ color: 'var(--text)' }}>
                  ¡Gracias por tu compra!
                </p>
                {numeroOrden && (
                  <div className="mt-1 px-3 py-1 inline-block" style={{ background: 'rgba(240,168,0,0.1)', border: '1px solid rgba(240,168,0,0.3)' }}>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
                      Orden #{String(numeroOrden).padStart(3, '0')} del día
                    </span>
                  </div>
                )}
                <p className="font-black mt-1" style={{ color: 'var(--yellow)', fontSize: '2.25rem', lineHeight: 1 }}>
                  ${totalACobrar.toFixed(2)}
                </p>
                <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                  {metodoPago === 'mixto' ? '💵+💳 Mixto' : metodoPago === 'efectivo' ? '💵 Efectivo' : '💳 Tarjeta'}
                  {propinaMonto > 0 && (
                    <span style={{ color: '#22c55e' }}> · Propina ${propinaMonto.toFixed(2)}</span>
                  )}
                  {descEmpleadoMonto > 0 && (
                    <span style={{ color: '#f59e0b' }}> · Desc. empleado ${descEmpleadoMonto.toFixed(2)}</span>
                  )}
                </p>
              </div>

              <div className="flex flex-col gap-0 divide-y" style={{ borderColor: 'var(--border)' }}>

                {/* Cambio — lo más prominente */}
                {(metodoPago === 'efectivo' || metodoPago === 'mixto') && cambioFinal > 0 && (
                  <div className="px-6 py-6 text-center"
                    style={{ background: 'rgba(59,130,246,0.07)', borderLeft: '5px solid #3b82f6' }}>
                    <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: '#3b82f6' }}>
                      Entregar cambio al cliente
                    </p>
                    <p className="font-black" style={{ color: '#fff', fontSize: '4rem', lineHeight: 1 }}>
                      ${cambioFinal.toFixed(2)}
                    </p>
                  </div>
                )}
                {(metodoPago === 'efectivo' || metodoPago === 'mixto') && cambioFinal === 0 && (
                  <div className="px-6 py-4 text-center"
                    style={{ background: 'rgba(34,197,94,0.06)', borderLeft: '5px solid #22c55e' }}>
                    <p className="font-black text-sm uppercase tracking-widest" style={{ color: '#22c55e' }}>
                      ✓ Pago exacto — sin cambio
                    </p>
                  </div>
                )}

                {/* Artículos canjeados con engranajes */}
                {canjeFinal.length > 0 && (
                  <div className="px-6 py-5"
                    style={{ background: 'rgba(240,168,0,0.04)', borderLeft: '5px solid var(--yellow)' }}>
                    <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: 'var(--yellow)' }}>
                      ⚙️ Artículos canjeados con engranajes
                    </p>
                    <div className="space-y-2 mb-3">
                      {canjeFinal.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span style={{ color: 'var(--text)' }}>
                            {item.emoji} {item.nombre} ×{item.cantidad}
                          </span>
                          <span className="font-black" style={{ color: 'var(--yellow)' }}>
                            −{item.costo} ⚙️
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-2"
                      style={{ borderTop: '1px solid rgba(240,168,0,0.2)' }}>
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Total canjeado
                      </span>
                      <span className="font-black text-lg" style={{ color: 'var(--yellow)' }}>
                        −{canjeFinal.reduce((s, i) => s + i.costo, 0).toLocaleString()} ⚙️
                      </span>
                    </div>
                  </div>
                )}

                {/* Saldo de engranajes */}
                {cliente && (
                  <div className="px-6 py-5 text-center">
                    {engranajeFinal > 0 && (
                      <p className="text-xs mb-2" style={{ color: '#22c55e' }}>
                        <span className="font-black">+{engranajeFinal} ⚙️</span> acreditados por esta compra
                      </p>
                    )}
                    <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>
                      Tu nuevo saldo es de
                    </p>
                    <p className="font-black" style={{ color: 'var(--yellow)', fontSize: '2.5rem', lineHeight: 1 }}>
                      {saldoFinal.toLocaleString()} ⚙️
                    </p>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                      {cliente.nombre} {cliente.last_name}
                    </p>
                  </div>
                )}

              </div>

              {/* Botones de éxito */}
              <div className="px-6 pb-6 pt-4 flex flex-col gap-2">
                {/* Mejora 1 — Imprimir recibo */}
                <button
                  onClick={imprimirRecibo}
                  className="w-full font-black text-sm uppercase tracking-widest py-3 transition-all active:scale-95"
                  style={{
                    background: 'var(--dark)',
                    color: 'var(--muted)',
                    border: '1.5px solid var(--border)',
                    borderRadius: 0,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}
                >
                  🖨️ Imprimir recibo
                </button>
                <button
                  onClick={onCompletado}
                  className="w-full font-black text-sm uppercase tracking-widest py-4 transition-all active:scale-95"
                  style={{ background: 'var(--yellow)', color: '#000', border: '2px solid var(--yellow)', borderRadius: 0, cursor: 'pointer' }}
                >
                  Nueva orden
                </button>
              </div>

              {/* Encuesta de satisfacción */}
              <div className="px-6 pb-6">
                <div style={{ background: 'var(--dark)', border: '1px solid var(--border)', padding: '1rem' }}>
                  {encuestaEnviada ? (
                    <div className="text-center py-2">
                      <p className="text-2xl mb-1">{'⭐'.repeat(encuestaCalif)}</p>
                      <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#22c55e' }}>¡Gracias por tu opinión!</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-black uppercase tracking-widest mb-3 text-center" style={{ color: 'var(--muted)' }}>
                        ¿Cómo fue tu experiencia?
                      </p>
                      <div className="flex justify-center gap-2 mb-3">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => enviarEncuesta(n)}
                            className="text-2xl transition-transform active:scale-90"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
                            title={['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'][n]}
                          >
                            {n <= encuestaCalif ? '⭐' : '☆'}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={encuestaComentario}
                          onChange={e => setEncuestaComentario(e.target.value)}
                          placeholder="Comentario opcional..."
                          className="flex-1 px-3 py-1.5 text-xs font-bold"
                          style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 0 }}
                          onKeyDown={e => { if (e.key === 'Enter' && encuestaCalif > 0) enviarEncuesta(encuestaCalif) }}
                        />
                        <button
                          type="button"
                          onClick={() => encuestaCalif > 0 ? enviarEncuesta(encuestaCalif) : setEncuestaEnviada(true)}
                          className="text-xs font-black px-3 py-1.5 uppercase tracking-wide"
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0, whiteSpace: 'nowrap' }}
                        >
                          {encuestaCalif > 0 ? 'Enviar' : 'Omitir'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-5 py-5 space-y-5">

              {/* C4 — Split de cuenta */}
              {splitMode && (() => {
                const c1 = cart.filter(i => (splitAsignacion[i.menu_id] ?? 1) === 1)
                const c2 = cart.filter(i => splitAsignacion[i.menu_id] === 2)
                const total1 = c1.reduce((s, i) => s + i.precio * i.cantidad, 0)
                const total2 = c2.reduce((s, i) => s + i.precio * i.cantidad, 0)
                return (
                  <div style={{ border: '2px solid #3b82f6', background: 'rgba(59,130,246,0.06)', padding: '1rem' }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#3b82f6' }}>
                        ⚡ Dividir cuenta
                      </p>
                      <button
                        onClick={() => setSplitMode(false)}
                        className="text-xs font-black px-2 py-0.5"
                        style={{ color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 0 }}
                      >
                        Cancelar split
                      </button>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {cart.map(item => {
                        const cuenta = splitAsignacion[item.menu_id] ?? 1
                        return (
                          <div key={item.menu_id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                              {item.emoji} {item.nombre} ×{item.cantidad}
                            </span>
                            <div className="flex shrink-0">
                              <button
                                onClick={() => setSplitAsignacion(prev => ({ ...prev, [item.menu_id]: 1 }))}
                                className="px-2 py-1 font-black"
                                style={{
                                  background: cuenta === 1 ? '#3b82f6' : 'var(--dark)',
                                  color: cuenta === 1 ? '#fff' : 'var(--muted)',
                                  border: '1px solid #3b82f6', borderRight: 'none', cursor: 'pointer', borderRadius: 0,
                                }}
                              >C1</button>
                              <button
                                onClick={() => setSplitAsignacion(prev => ({ ...prev, [item.menu_id]: 2 }))}
                                className="px-2 py-1 font-black"
                                style={{
                                  background: cuenta === 2 ? '#a855f7' : 'var(--dark)',
                                  color: cuenta === 2 ? '#fff' : 'var(--muted)',
                                  border: '1px solid #a855f7', cursor: 'pointer', borderRadius: 0,
                                }}
                              >C2</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="px-3 py-2 text-center" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }}>
                        <p className="text-xs font-black" style={{ color: '#3b82f6' }}>Cuenta 1</p>
                        <p className="font-black text-lg" style={{ color: 'var(--text)' }}>${total1.toFixed(2)}</p>
                        <button
                          onClick={() => {
                            if (c1.length === 0) { toast.error('Cuenta 1 vacía'); return }
                            setSplitMode(false)
                            onCobrarParcial?.(c1)
                          }}
                          className="mt-1 w-full text-xs font-black py-1.5 uppercase tracking-wider"
                          style={{ background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 0 }}
                        >
                          Cobrar C1
                        </button>
                      </div>
                      <div className="px-3 py-2 text-center" style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)' }}>
                        <p className="text-xs font-black" style={{ color: '#a855f7' }}>Cuenta 2</p>
                        <p className="font-black text-lg" style={{ color: 'var(--text)' }}>${total2.toFixed(2)}</p>
                        <button
                          onClick={() => {
                            if (c2.length === 0) { toast.error('Cuenta 2 vacía'); return }
                            setSplitMode(false)
                            onCobrarParcial?.(c2)
                          }}
                          className="mt-1 w-full text-xs font-black py-1.5 uppercase tracking-wider"
                          style={{ background: '#a855f7', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 0 }}
                        >
                          Cobrar C2
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Resumen orden */}
              <div style={{ background: 'var(--dark)', border: '1px solid var(--border)', padding: '1rem' }}>
                <div className="space-y-2 max-h-36 overflow-y-auto mb-3">
                  {cart.map(item => (
                    <div key={item.menu_id} className="flex justify-between text-sm">
                      <span style={{ color: 'var(--muted)' }}>{item.emoji} {item.nombre} ×{item.cantidad}</span>
                      <span className="font-bold" style={{ color: 'var(--text)' }}>${(item.precio * item.cantidad).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="hazard-stripe-sm h-0.5 w-full mb-3" />
                {(descuentoMonto ?? 0) > 0 && (
                  <div className="flex justify-between text-sm" style={{ color: '#22c55e' }}>
                    <span>Descuento</span>
                    <span className="font-black">-${(descuentoMonto ?? 0).toFixed(2)}</span>
                  </div>
                )}
                {montoCanjeado > 0 && (
                  <div className="flex justify-between text-sm" style={{ color: 'var(--yellow)' }}>
                    <span>⚙️ Canje ({engranajesTotalesCanje} eng.)</span>
                    <span className="font-black">-${montoCanjeado.toFixed(2)}</span>
                  </div>
                )}
                {descEmpleadoMonto > 0 && (
                  <div className="flex justify-between text-sm" style={{ color: '#f59e0b' }}>
                    <span>👷 Desc. empleado</span>
                    <span className="font-black">-${descEmpleadoMonto.toFixed(2)}</span>
                  </div>
                )}
                {descPromoMonto > 0 && (
                  <div className="flex justify-between text-sm" style={{ color: '#22c55e' }}>
                    <span>🏷️ Promos activas</span>
                    <span className="font-black">-${descPromoMonto.toFixed(2)}</span>
                  </div>
                )}
                {/* Descuento por volumen */}
                {elegibleVolumen && (
                  <div className="flex items-center justify-between text-sm" style={{ color: '#34d399' }}>
                    <button
                      onClick={() => setDescVolumenActivo(v => !v)}
                      className="flex items-center gap-1.5 text-sm font-bold"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: descVolumenActivo ? '#34d399' : 'var(--muted)', padding: 0 }}
                    >
                      📦 {descVolumenActivo ? '✓' : '+'} Desc. volumen (×3) 10%
                    </button>
                    {descVolumenActivo && (
                      <span className="font-black">-${descVolumenMonto.toFixed(2)}</span>
                    )}
                  </div>
                )}
                {/* Cupón */}
                {cuponAplicado ? (
                  <div className="flex justify-between text-sm items-center" style={{ color: '#a855f7' }}>
                    <span>🎟 {cuponAplicado.codigo}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-black">-${descCuponMonto.toFixed(2)}</span>
                      <button onClick={() => setCuponAplicado(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <input value={cuponInput} onChange={e => { setCuponInput(e.target.value.toUpperCase()); setCuponError('') }} placeholder="Código de cupón" style={{ flex: 1, padding: '0.4rem 0.5rem', background: 'var(--dark)', border: `1px solid ${cuponError ? '#ef4444' : 'var(--border)'}`, borderRadius: 2, color: 'var(--text)', fontSize: '0.75rem', fontWeight: 700, outline: 'none', fontFamily: 'monospace' }} onKeyDown={e => e.key === 'Enter' && aplicarCupon()} />
                    <button onClick={aplicarCupon} disabled={cuponBuscando || !cuponInput} style={{ padding: '0.4rem 0.65rem', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 2, color: '#a855f7', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>{cuponBuscando ? '...' : 'Aplicar'}</button>
                  </div>
                )}
                {cuponError && <p style={{ color: '#ef4444', fontSize: '0.65rem', fontWeight: 900, margin: '0.2rem 0 0' }}>{cuponError}</p>}
                {propinaMonto > 0 && (
                  <div className="flex justify-between text-sm" style={{ color: '#22c55e' }}>
                    <span>🤝 Propina</span>
                    <span className="font-black">+${propinaMonto.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Total a cobrar</span>
                  <span className="font-black text-2xl" style={{ color: 'var(--yellow)' }}>${totalACobrar.toFixed(2)}</span>
                </div>
              </div>

              {/* Cliente */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                  Cliente (opcional · engranajes)
                </p>

                {cliente ? (
                  /* ── Cliente encontrado: perfil completo ── */
                  <div style={{ border: '1px solid rgba(34,197,94,0.3)', borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.05)' }}>
                    {/* Cabecera del cliente */}
                    <div className="flex items-start justify-between px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-black text-base" style={{ color: 'var(--text)' }}>
                            {cliente.nombre} {cliente.last_name}
                          </p>
                          {/* Mejora 3 — Botón historial */}
                          <button
                            onClick={() => setShowHistorial(true)}
                            className="text-xs font-black px-1.5 py-0.5 transition-all"
                            style={{
                              background: 'rgba(59,130,246,0.1)',
                              border: '1px solid rgba(59,130,246,0.35)',
                              color: '#3b82f6',
                              borderRadius: 0,
                              cursor: 'pointer',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
                          >
                            📋 Ver historial
                          </button>
                          {esCumple && (
                            <span className="text-xs font-black px-1.5 py-0.5"
                              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7', borderRadius: 0 }}>
                              🎂 Cumpleaños
                            </span>
                          )}
                          {cliente.nivel && (
                            <span className="text-xs font-black px-1.5 py-0.5"
                              style={{ background: `${nivelColor(cliente.nivel)}15`, border: `1px solid ${nivelColor(cliente.nivel)}40`, color: nivelColor(cliente.nivel), borderRadius: 0 }}>
                              {cliente.nivel}
                            </span>
                          )}
                          {/* D1 — badge de empleado */}
                          {cliente.es_empleado && (
                            <span className="text-xs font-black px-1.5 py-0.5"
                              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', borderRadius: 0 }}>
                              👷 Empleado — 50% descuento
                            </span>
                          )}
                        </div>
                        {/* D1 — toggle descuento empleado */}
                        {cliente.es_empleado && (
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              onClick={() => setDescEmpleadoActivo(v => !v)}
                              className="text-xs font-black px-2 py-0.5 transition-all"
                              style={{
                                background: descEmpleadoActivo ? 'rgba(245,158,11,0.15)' : 'var(--dark)',
                                color: descEmpleadoActivo ? '#f59e0b' : 'var(--muted)',
                                border: `1px solid ${descEmpleadoActivo ? '#f59e0b' : 'var(--border)'}`,
                                borderRadius: 0, cursor: 'pointer',
                              }}
                            >
                              {descEmpleadoActivo ? '✓ Desc. activo' : 'Activar descuento'}
                            </button>
                            {descEmpleadoActivo && (
                              <span className="text-xs" style={{ color: '#f59e0b' }}>
                                -${descEmpleadoMonto.toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                        {cliente.telefono && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>📱 {cliente.telefono}</p>
                        )}
                      </div>
                      <button onClick={() => setCliente(null)} className="text-lg ml-2 shrink-0 transition-colors"
                        style={{ color: 'rgba(239,68,68,0.5)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.5)')}>✕</button>
                    </div>

                    {/* Stats: engranajes + racha */}
                    <div className="flex border-t" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
                      <div className="flex-1 px-4 py-2.5 text-center" style={{ borderRight: '1px solid rgba(34,197,94,0.2)' }}>
                        <p className="font-black text-lg" style={{ color: 'var(--yellow)' }}>
                          {(cliente.engranajes ?? 0).toLocaleString()} ⚙️
                        </p>
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>Engranajes actuales</p>
                      </div>
                      <div className="flex-1 px-4 py-2.5 text-center" style={{ borderRight: '1px solid rgba(34,197,94,0.2)' }}>
                        <p className="font-black text-lg" style={{ color: '#22c55e' }}>+{engranajes} ⚙️</p>
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>Gana esta compra</p>
                      </div>
                      {cliente.racha_dias != null && (
                        <div className="flex-1 px-4 py-2.5 text-center">
                          <p className="font-black text-lg" style={{ color: '#f59e0b' }}>🔥 {cliente.racha_dias}</p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>Racha días</p>
                        </div>
                      )}
                    </div>

                    {/* Progress bar toward next milestone */}
                    {(() => {
                      const saldoActual = cliente.engranajes ?? 0
                      const saldoProyectado = saldoActual - engranajesTotalesCanje + engranajes
                      const siguiente = Math.ceil((saldoProyectado + 1) / 100) * 100
                      const progreso = ((saldoProyectado % 100) / 100) * 100
                      const faltanParaSiguiente = siguiente - saldoProyectado
                      return (
                        <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                              Próximo hito
                            </span>
                            <span className="text-xs font-black" style={{ color: 'var(--yellow)' }}>
                              {siguiente} ⚙️
                            </span>
                          </div>
                          <div className="w-full h-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full transition-all duration-500"
                              style={{ width: `${Math.min(100, progreso)}%`, background: 'var(--yellow)' }} />
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                            Te faltan <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>{faltanParaSiguiente} ⚙️</span> para el siguiente hito
                          </p>
                        </div>
                      )
                    })()}

                    {/* Recompensas disponibles */}
                    {cliente.recompensas_disponibles.length > 0 && (
                      <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
                        <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: '#22c55e' }}>
                          🎁 Puede canjear ahora
                        </p>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {cliente.recompensas_disponibles.map(r => (
                            <div key={r.id} className="flex items-center justify-between text-xs px-2 py-1.5"
                              style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
                              <span style={{ color: 'var(--text)' }}>{r.emoji} {r.nombre}</span>
                              <span className="font-black" style={{ color: 'var(--yellow)' }}>{r.costo} ⚙️</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Canjear ítems del pedido con engranajes */}
                    <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
                      <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--yellow)' }}>
                        ⚙️ Pagar con engranajes
                      </p>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {cart.map(item => {
                          const costo = costoEngranajes(item.precio, item.cantidad)
                          const seleccionado = canjeItems.has(item.menu_id)
                          const puedeSeleccionar = seleccionado
                            ? true
                            : (engranajesTotalesCanje + costo) <= (cliente.engranajes ?? 0)
                          return (
                            <button
                              key={item.menu_id}
                              onClick={() => {
                                if (!puedeSeleccionar && !seleccionado) return
                                setCanjeItems(prev => {
                                  const next = new Set(prev)
                                  if (next.has(item.menu_id)) next.delete(item.menu_id)
                                  else next.add(item.menu_id)
                                  return next
                                })
                              }}
                              className="w-full flex items-center justify-between text-xs px-2 py-1.5 transition-all text-left"
                              style={{
                                background: seleccionado ? 'rgba(240,168,0,0.12)' : 'var(--dark)',
                                border: `1px solid ${seleccionado ? 'var(--yellow)' : 'var(--border)'}`,
                                opacity: puedeSeleccionar ? 1 : 0.4,
                                cursor: puedeSeleccionar ? 'pointer' : 'not-allowed',
                              }}
                            >
                              <span style={{ color: seleccionado ? 'var(--yellow)' : 'var(--text)' }}>
                                {seleccionado && '✓ '}{item.emoji} {item.nombre} ×{item.cantidad}
                              </span>
                              <span className="font-black ml-2 shrink-0" style={{ color: 'var(--yellow)' }}>
                                {costo} ⚙️
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {canjeItems.size > 0 && (
                        <div className="mt-2 flex items-center justify-between text-xs px-2 py-1.5"
                          style={{ background: 'rgba(240,168,0,0.08)', border: '1px solid rgba(240,168,0,0.3)' }}>
                          <span style={{ color: 'var(--muted)' }}>Usando</span>
                          <span className="font-black" style={{ color: tieneEngranajeSuficiente ? 'var(--yellow)' : '#ef4444' }}>
                            {engranajesTotalesCanje} / {cliente.engranajes} ⚙️
                            {' '}{tieneEngranajeSuficiente ? '✓' : '✗ Insuficiente'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : showSearch ? (
                  /* ── Búsqueda por teléfono ── */
                  <div style={{ background: 'var(--dark)', border: '1px solid var(--border)', padding: '1rem' }}>
                    <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                      Buscar por teléfono, correo o nombre
                    </p>
                    <div className="flex gap-2">
                      <input
                        ref={searchRef}
                        type="text"
                        inputMode="search"
                        enterKeyHint="search"
                        value={telefonoInput}
                        onChange={e => setTelefonoInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { buscarPorTelefono(); (e.target as HTMLInputElement).blur() } }}
                        placeholder="Teléfono, correo o nombre"
                        className="pos-input flex-1 text-base font-black"
                        style={{ color: 'var(--text)' }}
                        autoFocus
                      />
                      <button
                        onClick={buscarPorTelefono}
                        disabled={buscando}
                        className="px-4 font-black text-sm uppercase tracking-wider transition-all"
                        style={{
                          background: buscando ? 'var(--dark)' : 'var(--yellow)',
                          color: buscando ? 'var(--muted)' : '#000',
                          border: '2px solid var(--yellow)',
                          borderRadius: 0,
                          cursor: buscando ? 'not-allowed' : 'pointer',
                          minWidth: 72,
                        }}
                      >
                        {buscando ? '...' : 'Buscar'}
                      </button>
                    </div>
                    <button
                      onClick={() => { setShowSearch(false); setTelefonoInput('') }}
                      className="mt-2 text-xs font-black uppercase tracking-wider transition-colors"
                      style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                      ← Cancelar
                    </button>
                  </div>
                ) : (
                  /* ── Botones para vincular cliente ── */
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 50) }}
                      className="flex-1 py-3 text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                      style={{ border: '2px dashed var(--border)', color: 'var(--muted)', background: 'none', borderRadius: 0, cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}
                    >
                      🔍 Buscar cliente
                    </button>
                    <button
                      onClick={() => setShowScanner(true)}
                      className="flex-1 py-3 text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                      style={{ border: '2px dashed var(--border)', color: 'var(--muted)', background: 'none', borderRadius: 0, cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}
                    >
                      📷 Escanear QR
                    </button>
                  </div>
                )}
              </div>

              {/* Método de pago */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                  Método de pago
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'efectivo', label: '💵 Efectivo' },
                    { key: 'tarjeta', label: '💳 Tarjeta' },
                    { key: 'mixto', label: '💵+💳 Mixto' },
                  ] as { key: MetodoPago; label: string }[]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setMetodoPago(key)}
                      className="py-3 font-black text-sm uppercase tracking-wider transition-all"
                      style={{
                        background: metodoPago === key ? 'var(--yellow)' : 'var(--dark)',
                        color: metodoPago === key ? '#000' : 'var(--muted)',
                        border: `2px solid ${metodoPago === key ? 'var(--yellow)' : 'var(--border)'}`,
                        borderRadius: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Efectivo */}
              {metodoPago === 'efectivo' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
                      Efectivo recibido
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={efectivoInput}
                      onChange={e => setEfectivoInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      placeholder={`Mínimo $${totalACobrar.toFixed(2)}`}
                      className="pos-input text-lg font-black"
                      style={{ color: 'var(--yellow)' }}
                      min={totalACobrar}
                    />
                  </div>
                  {/* Billetes rápidos */}
                  <div className="flex gap-2 flex-wrap">
                    {[50, 100, 200, 500].filter(m => m >= totalACobrar).map(monto => (
                      <button
                        key={monto}
                        onClick={() => setEfectivoInput(monto.toString())}
                        className="flex-1 text-sm font-black py-2 transition-all min-w-[55px]"
                        style={{ background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}
                      >${monto}</button>
                    ))}
                  </div>
                  {/* Cambio */}
                  {efectivo >= totalACobrar && (
                    <div className="flex justify-between items-center px-4 py-3"
                      style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderLeft: '3px solid #3b82f6' }}>
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: '#3b82f6' }}>
                        Cambio
                      </span>
                      <span className="font-black text-xl" style={{ color: 'var(--text)' }}>
                        ${cambio.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Mixto */}
              {metodoPago === 'mixto' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Efectivo</label>
                      <input type="number" inputMode="decimal" enterKeyHint="next" value={efectivoMixto} onChange={e => setEfectivoMixto(e.target.value)}
                        placeholder="$0.00" className="pos-input w-full text-base font-black" style={{ color: 'var(--text)' }} min={0} />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Tarjeta</label>
                      <input type="number" inputMode="decimal" enterKeyHint="done" value={tarjetaMixto} onChange={e => setTarjetaMixto(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        placeholder="$0.00" className="pos-input w-full text-base font-black" style={{ color: 'var(--text)' }} min={0} />
                    </div>
                  </div>
                  {efectivoMixtoVal + tarjetaMixtoVal > 0 && (
                    <div className="flex justify-between items-center px-4 py-3"
                      style={{
                        background: efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                        borderLeft: `3px solid ${efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar ? '#22c55e' : '#ef4444'}`,
                      }}>
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar ? '#22c55e' : '#ef4444' }}>
                        {efectivoMixtoVal + tarjetaMixtoVal >= totalACobrar ? 'Cambio' : 'Falta'}
                      </span>
                      <span className="font-black text-xl" style={{ color: 'var(--text)' }}>
                        ${Math.abs(totalACobrar - efectivoMixtoVal - tarjetaMixtoVal).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* B2 — Propina con montos fijos en pesos */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                  Propina (opcional)
                </p>
                <div className="flex gap-2">
                  {([
                    { label: 'Sin propina', value: 0 },
                    { label: '$10', value: 10 },
                    { label: '$20', value: 20 },
                    { label: '$50', value: 50 },
                  ] as { label: string; value: number }[]).map(({ label, value }) => {
                    const selected = !propinaCustomMode && propinaMontFijo === value
                    return (
                      <button
                        key={value}
                        onClick={() => { setPropinaMontFijo(value); setPropinaCustomMode(false); setPropinaCustomInput('') }}
                        className="flex-1 py-2 text-sm font-black transition-all"
                        style={{
                          background: selected ? 'rgba(240,168,0,0.15)' : 'var(--dark)',
                          color: selected ? 'var(--yellow)' : 'var(--muted)',
                          border: `1.5px solid ${selected ? 'var(--yellow)' : 'var(--border)'}`,
                          borderRadius: 0,
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => { setPropinaCustomMode(true); setPropinaMontFijo(0) }}
                    className="flex-1 py-2 text-sm font-black transition-all"
                    style={{
                      background: propinaCustomMode ? 'rgba(240,168,0,0.15)' : 'var(--dark)',
                      color: propinaCustomMode ? 'var(--yellow)' : 'var(--muted)',
                      border: `1.5px solid ${propinaCustomMode ? 'var(--yellow)' : 'var(--border)'}`,
                      borderRadius: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Otro
                    {propinaCustomMode && propinaMonto > 0 && (
                      <span className="block text-xs" style={{ color: 'var(--yellow)', opacity: 0.8 }}>
                        +${propinaMonto.toFixed(2)}
                      </span>
                    )}
                  </button>
                </div>
                {propinaCustomMode && (
                  <>
                    <input
                      type="number" min={0}
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={propinaCustomInput}
                      onChange={e => setPropinaCustomInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      placeholder="Monto en pesos, ej: 30"
                      className="w-full pos-input text-sm font-black mt-2"
                      style={{ color: propinaAdvertencia ? '#f59e0b' : 'var(--yellow)' }}
                      autoFocus
                    />
                    {propinaAdvertencia && (
                      <p className="text-xs font-black mt-1" style={{ color: '#f59e0b' }}>
                        ⚠ La propina supera el total de la orden — ¿es correcto?
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Mejora 4 — Promociones activas */}
              {promociones.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                    Promociones disponibles
                  </p>
                  <div className="space-y-1.5">
                    {promociones.map(p => {
                      const activa = promoActivas.has(p.id)
                      const label = p.tipo === 'porcentaje'
                        ? `${p.valor}% de descuento`
                        : `$${p.valor} de descuento`
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3 py-2"
                          style={{
                            background: activa ? 'rgba(34,197,94,0.06)' : 'var(--dark)',
                            border: `1px solid ${activa ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                          }}
                        >
                          <div className="flex-1 min-w-0 mr-3">
                            <p className="text-xs font-black" style={{ color: activa ? '#22c55e' : 'var(--muted)' }}>
                              🏷️ {p.nombre}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
                          </div>
                          <button
                            onClick={() => {
                              setPromoActivas(prev => {
                                const next = new Set(prev)
                                if (next.has(p.id)) next.delete(p.id)
                                else next.add(p.id)
                                return next
                              })
                            }}
                            className="text-xs font-black px-2.5 py-1 transition-all shrink-0"
                            style={{
                              background: activa ? '#22c55e' : 'var(--dark)',
                              color: activa ? '#000' : 'var(--muted)',
                              border: `1px solid ${activa ? '#22c55e' : 'var(--border)'}`,
                              borderRadius: 0,
                              cursor: 'pointer',
                            }}
                          >
                            {activa ? '✓ Activa' : 'Aplicar'}
                          </button>
                        </div>
                      )
                    })}
                    {descPromoMonto > 0 && (
                      <div className="flex justify-between text-xs px-3 py-1.5"
                        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                        <span style={{ color: 'var(--muted)' }}>Ahorro total por promos</span>
                        <span className="font-black" style={{ color: '#22c55e' }}>-${descPromoMonto.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Mejora 2 — RFC para factura */}
              <div>
                <button
                  onClick={() => setShowRfc(v => !v)}
                  className="text-xs font-black uppercase tracking-wider transition-all"
                  style={{
                    background: showRfc ? 'rgba(240,168,0,0.08)' : 'none',
                    color: showRfc ? 'var(--yellow)' : 'var(--muted)',
                    border: `1px solid ${showRfc ? 'rgba(240,168,0,0.4)' : 'var(--border)'}`,
                    borderRadius: 0,
                    cursor: 'pointer',
                    padding: '4px 10px',
                  }}
                >
                  🧾 Requiere factura
                </button>
                {showRfc && (
                  <div className="mt-2">
                    <input
                      type="text"
                      inputMode="text"
                      enterKeyHint="done"
                      value={rfcCliente}
                      onChange={e => setRfcCliente(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      placeholder="XAXX010101000"
                      maxLength={13}
                      className="pos-input w-full text-sm font-black"
                      style={{ color: 'var(--yellow)', letterSpacing: '0.05em' }}
                      autoFocus
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      RFC para factura (opcional) · Máx. 13 caracteres
                    </p>
                  </div>
                )}
              </div>

              {/* Keyboard hint */}
              <p className="text-xs text-center" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                Enter para confirmar · Esc para cancelar
              </p>

              {/* MP Terminal: waiting panel */}
              {metodoPago === 'tarjeta' && MP_CONFIGURADO && mpEstado !== 'idle' ? (
                <div style={{ border: '2px solid var(--yellow)', background: 'rgba(240,168,0,0.06)', padding: '1.25rem' }}>
                  {mpEstado === 'creando' && (
                    <div className="flex flex-col items-center gap-3 py-2">
                      <span className="text-3xl animate-gear inline-block">⚙️</span>
                      <p className="font-black text-sm uppercase tracking-widest text-center" style={{ color: 'var(--yellow)' }}>
                        Enviando a la terminal...
                      </p>
                    </div>
                  )}
                  {mpEstado === 'esperando' && (
                    <div className="flex flex-col items-center gap-3 py-2">
                      <span className="text-4xl">💳</span>
                      <div className="text-center">
                        <p className="font-black text-base uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
                          Esperando terminal
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          Pide al cliente que pase su tarjeta
                        </p>
                        <p className="font-black text-2xl mt-2" style={{ color: 'var(--text)' }}>
                          ${totalACobrar.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 rounded-full animate-dot-pulse" style={{ background: 'var(--yellow)', animationDelay: '0s' }} />
                        <span className="w-2 h-2 rounded-full animate-dot-pulse" style={{ background: 'var(--yellow)', animationDelay: '0.2s' }} />
                        <span className="w-2 h-2 rounded-full animate-dot-pulse" style={{ background: 'var(--yellow)', animationDelay: '0.4s' }} />
                      </div>
                      <button
                        onClick={cancelarPagoTerminal}
                        className="w-full py-2.5 font-black text-sm uppercase tracking-widest transition-all"
                        style={{ background: 'var(--dark)', color: '#ef4444', border: '1.5px solid #ef4444', borderRadius: 0, cursor: 'pointer' }}
                      >
                        Cancelar terminal
                      </button>
                    </div>
                  )}
                  {(mpEstado === 'cancelado' || mpEstado === 'rechazado' || mpEstado === 'error') && (
                    <div className="flex flex-col items-center gap-3 py-2">
                      <span className="text-3xl">⚠️</span>
                      <div className="text-center">
                        <p className="font-black text-sm uppercase tracking-widest" style={{ color: '#ef4444' }}>
                          {mpEstado === 'cancelado' ? 'Pago cancelado' : mpEstado === 'rechazado' ? 'Pago rechazado' : 'Error en terminal'}
                        </p>
                        {mpMensaje && (
                          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{mpMensaje}</p>
                        )}
                      </div>
                      {/* Si hay un intent atascado en la cola, mostrar botón de liberación */}
                      {mpMensaje?.includes('queued intent') && (
                        <button
                          onClick={async () => {
                            setMpEstado('creando')
                            setMpMensaje('Liberando terminal...')
                            await liberarTerminal().catch(() => {})
                            setMpEstado('idle')
                            setMpIntentoId(null)
                            setMpMensaje('')
                          }}
                          className="w-full py-3 font-black text-sm uppercase tracking-widest transition-all"
                          style={{ background: '#f97316', color: '#000', border: '2px solid #f97316', borderRadius: 0, cursor: 'pointer' }}
                        >
                          Liberar terminal
                        </button>
                      )}
                      <button
                        onClick={() => { setMpEstado('idle'); setMpIntentoId(null); setMpMensaje('') }}
                        className="w-full py-3 font-black text-sm uppercase tracking-widest transition-all"
                        style={{ background: 'var(--yellow)', color: '#000', border: '2px solid var(--yellow)', borderRadius: 0, cursor: 'pointer' }}
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Confirmar — normal o terminal MP */}
                  <button
                    onClick={metodoPago === 'tarjeta' && MP_CONFIGURADO ? iniciarPagoTerminal : confirmarVenta}
                    disabled={!puedeConfirmar}
                    className="w-full font-black text-base uppercase tracking-widest py-4 transition-all active:scale-95"
                    style={{
                      background: puedeConfirmar ? (metodoPago === 'tarjeta' && MP_CONFIGURADO ? '#1d4ed8' : '#22c55e') : 'var(--dark)',
                      color: puedeConfirmar ? '#fff' : 'var(--muted)',
                      border: `2px solid ${puedeConfirmar ? (metodoPago === 'tarjeta' && MP_CONFIGURADO ? '#1d4ed8' : '#22c55e') : 'var(--border)'}`,
                      opacity: puedeConfirmar ? 1 : 0.5,
                      borderRadius: 0,
                      cursor: puedeConfirmar ? 'pointer' : 'not-allowed',
                    }}
                    onMouseEnter={e => puedeConfirmar && ((e.currentTarget as HTMLButtonElement).style.background = metodoPago === 'tarjeta' && MP_CONFIGURADO ? '#1e40af' : '#16a34a')}
                    onMouseLeave={e => puedeConfirmar && ((e.currentTarget as HTMLButtonElement).style.background = metodoPago === 'tarjeta' && MP_CONFIGURADO ? '#1d4ed8' : '#22c55e')}
                  >
                    {metodoPago === 'tarjeta' && MP_CONFIGURADO
                      ? `💳 Cobrar con terminal — $${totalACobrar.toFixed(2)}`
                      : `✓ Confirmar $${totalACobrar.toFixed(2)}`}
                  </button>
                  {/* Consumo empleado — sin cobro */}
                  <button
                    onClick={registrarConsumoEmpleado}
                    disabled={guardandoConsumo || cart.length === 0}
                    className="w-full font-black text-xs uppercase tracking-widest py-2 transition-all"
                    style={{
                      background: 'transparent',
                      color: 'var(--muted)',
                      border: '1px dashed var(--border)',
                      borderRadius: 0,
                      cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f59e0b')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                  >
                    👷 Consumo empleado (sin cobro)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showScanner && <QRScannerModal onScan={procesarQR} onClose={() => setShowScanner(false)} />}

      {/* ── Modal de confirmación de canje de recompensa ── */}
      {canjePreview && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-3xl w-full max-w-md border border-amber-500/40 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="bg-amber-500 px-6 py-4 flex items-center gap-3">
              <span className="text-2xl">🎁</span>
              <div>
                <p className="text-slate-900 font-bold text-lg leading-none">Canje de Recompensa</p>
                <p className="text-slate-900/70 text-sm mt-0.5">Verifica y confirma antes de entregar</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {/* Cliente */}
              <div className="bg-slate-700/50 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Cliente</p>
                  <p className="text-white font-bold text-lg">{canjePreview.usuario.nombre} {canjePreview.usuario.last_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400 text-xs mb-1">Saldo actual</p>
                  <p className="text-amber-400 font-bold text-lg">{canjePreview.engranajes} ⚙️</p>
                </div>
              </div>
              {/* Recompensas */}
              <div className="space-y-2">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Recompensas a entregar</p>
                {canjePreview.rewards.map((r, i) => (
                  <div key={i} className="bg-slate-700 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-white font-semibold">🎁 {r.nombre}</span>
                    <span className="text-amber-400 font-bold">−{r.costo} ⚙️</span>
                  </div>
                ))}
              </div>
              {/* Resumen */}
              <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center justify-between border border-slate-700">
                <span className="text-white font-bold">Engranajes después del canje</span>
                <span className="text-green-400 font-bold text-lg">{canjePreview.engranajes - canjePreview.total_costo} ⚙️</span>
              </div>
              {/* Botones */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setCanjePreview(null)}
                  disabled={canjeConfirmando}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarCanjeRecompensa}
                  disabled={canjeConfirmando}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {canjeConfirmando
                    ? <><span className="animate-spin inline-block">⚙️</span> Procesando...</>
                    : <>✅ Confirmar canje</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mejora 3 — Historial del cliente */}
      {showHistorial && cliente && (
        <ClienteHistorialModal
          clienteId={cliente.id}
          clienteNombre={`${cliente.nombre} ${cliente.last_name}`}
          onClose={() => setShowHistorial(false)}
        />
      )}

      {/* Diálogo de confirmación para cancelar */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            className="w-full max-w-xs p-6 flex flex-col gap-5 animate-slide-up"
            style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #ef4444' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <p className="text-2xl mb-2">⚠️</p>
              <p className="font-black text-base uppercase tracking-wide" style={{ color: 'var(--text)' }}>
                ¿Cancelar cobro?
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Los artículos en la orden no se eliminarán.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-3 font-black text-sm uppercase tracking-wider transition-all"
                style={{ background: 'var(--dark)', color: 'var(--muted)', border: '2px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}
              >
                Volver
              </button>
              <button
                onClick={() => { setShowCancelConfirm(false); onClose() }}
                className="flex-1 py-3 font-black text-sm uppercase tracking-wider transition-all"
                style={{ background: '#ef4444', color: '#fff', border: '2px solid #ef4444', borderRadius: 0, cursor: 'pointer' }}
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ConfettiOverlay() {
  const colors = ['#F0A800', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#f59e0b']
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    left: `${4 + (i / 23) * 92}%`,
    delay: `${(i % 6) * 0.08}s`,
    size: i % 3 === 0 ? 10 : 6,
    round: i % 2 === 0,
    duration: `${0.9 + (i % 4) * 0.15}s`,
  }))
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {pieces.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            top: '-10px',
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.round ? '50%' : '0',
            animationName: 'confetti-fall',
            animationDuration: p.duration,
            animationDelay: p.delay,
            animationFillMode: 'forwards',
            animationTimingFunction: 'ease-in',
          }}
        />
      ))}
    </div>
  )
}
