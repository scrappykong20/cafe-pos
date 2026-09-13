import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import { registrarAccion } from '../services/auditLog'
import { crearTicket, imprimirPorTipo, hayImpresora } from '../services/printer'
import toast from 'react-hot-toast'

interface CorteCaja {
  id: string
  cajero_nombre: string
  fondo_inicial: number
  total_efectivo: number
  total_tarjeta: number
  total_mixto: number
  total_ventas: number
  num_ventas: number
  efectivo_contado: number | null
  diferencia: number | null
  notas: string | null
  estado: string
  apertura_at: string
  cierre_at: string | null
  turno: string | null
  total_propinas: number
  total_propinas_tarjeta: number
  total_propinas_efectivo: number
}

interface Movimiento {
  id: string
  tipo: 'entrada' | 'salida'
  monto: number
  motivo: string
  created_at: string
}

interface VentasResumen {
  totalEfectivo: number
  totalTarjeta: number
  totalMixto: number
  totalVentas: number
  numVentas: number
  porHora: Record<number, number>  // hora (0-23) → total ventas
}

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
  onCerrarSesion?: () => void
  onIrApertura?: () => void
}

type Tab = 'resumen' | 'caja-chica' | 'cerrar' | 'semana'

export default function CorteCajaPage({ cajero, onVolver, onCerrarSesion, onIrApertura }: Props) {
  const [corteActivo, setCorteActivo] = useState<CorteCaja | null>(null)
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [ventasResumen, setVentasResumen] = useState<VentasResumen | null>(null)
  const [historialCortes, setHistorialCortes] = useState<CorteCaja[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('resumen')

  // Apertura
  const [fondoInicial, setFondoInicial] = useState('')
  const [abriendo, setAbriendo] = useState(false)

  // Caja chica
  const [movTipo, setMovTipo] = useState<'entrada' | 'salida'>('entrada')
  const [movMonto, setMovMonto] = useState('')
  const [movConcepto, setMovConcepto] = useState('')
  const [agregandoMov, setAgregandoMov] = useState(false)

  // Cierre
  const [efectivoContado, setEfectivoContado] = useState('')
  const [notasCierre, setNotasCierre] = useState('')
  const [cerrando, setCerrando] = useState(false)
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)
  const [turnoFinalizado, setTurnoFinalizado] = useState<CorteCaja | null>(null)
  const [turnoAnterior, setTurnoAnterior] = useState<CorteCaja | null>(null)
  const [propinasTurnos, setPropinasTurnos] = useState<{ manana: { tarjeta: number; efectivo: number }; tarde: { tarjeta: number; efectivo: number } } | undefined>(undefined)

  // Semana
  const [semanaDesde, setSemanaDesde] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0)
    return d.toISOString().slice(0, 10)
  })
  const [semanaHasta, setSemanaHasta] = useState<string>(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999)
    return d.toISOString().slice(0, 10)
  })
  const [semanaTurno, setSemanaTurno] = useState<'todos' | 'mañana' | 'tarde'>('todos')
  const [semanaData, setSemanaData] = useState<{ cajero_nombre: string; num_ventas: number; total_ventas: number; propinas_tarjeta: number; propinas_efectivo: number }[]>([])
  const [cargandoSemana, setCargandoSemana] = useState(false)
  const [semanaPersonal, setSemanaPersonal] = useState<{ id: string; nombre: string; apellido: string; rol: string; porcentaje_propina: number }[]>([])

  const cerrarSesionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (cerrarSesionTimerRef.current) clearTimeout(cerrarSesionTimerRef.current) }, [])

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const hoyISO = hoy.toISOString()

  useEffect(() => {
    cargarCorte()
  }, [])

  async function cargarCorte() {
    setLoading(true)
    try {
      const { data: corte } = await supabase
        .from('cortes_caja')
        .select('*')
        .eq('estado', 'abierto')
        .gte('apertura_at', hoyISO)
        .maybeSingle()

      if (corte) {
        setCorteActivo(corte)
        await cargarMovimientos(corte.id)
        await cargarVentasHoy(corte.apertura_at)
        // Cargar turno anterior para comparación
        const { data: anterior } = await supabase
          .from('cortes_caja')
          .select('*')
          .eq('cajero_id', cajero.id)
          .eq('estado', 'cerrado')
          .order('cierre_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setTurnoAnterior(anterior as CorteCaja | null)
      } else {
        setCorteActivo(null)
        await cargarHistorial()
      }
    } finally {
      setLoading(false)
    }
  }

  async function cargarMovimientos(corteId: string) {
    const { data } = await supabase
      .from('movimientos_caja')
      .select('*')
      .eq('corte_id', corteId)
      .order('created_at', { ascending: true })
    setMovimientos((data as Movimiento[]) || [])
  }

  async function cargarVentasHoy(aperturaAt: string) {
    const { data } = await supabase
      .from('ventas')
      .select('total, metodo_pago, created_at')
      .gte('created_at', aperturaAt)
      .eq('estado', 'completada')

    if (!data) return

    let totalEfectivo = 0
    let totalTarjeta = 0
    let totalMixto = 0
    const porHora: Record<number, number> = {}

    data.forEach((v: { total: number; metodo_pago: string; created_at: string }) => {
      const hora = new Date(v.created_at).getHours()
      porHora[hora] = (porHora[hora] ?? 0) + Number(v.total)
      if (v.metodo_pago === 'efectivo') totalEfectivo += Number(v.total)
      else if (v.metodo_pago === 'tarjeta') totalTarjeta += Number(v.total)
      else if (v.metodo_pago === 'mixto') totalMixto += Number(v.total)
    })

    setVentasResumen({
      totalEfectivo,
      totalTarjeta,
      totalMixto,
      totalVentas: totalEfectivo + totalTarjeta + totalMixto,
      numVentas: data.length,
      porHora,
    })
  }

  async function cargarHistorial() {
    const { data } = await supabase
      .from('cortes_caja')
      .select('*')
      .eq('cajero_id', cajero.id)
      .eq('estado', 'cerrado')
      .order('cierre_at', { ascending: false })
      .limit(3)
    setHistorialCortes((data as CorteCaja[]) || [])
  }

  async function abrirTurno() {
    const fondo = parseFloat(fondoInicial)
    if (isNaN(fondo) || fondo < 0) return
    setAbriendo(true)
    try {
      const { error } = await supabase.from('cortes_caja').insert({
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        fondo_inicial: fondo,
        total_efectivo: 0,
        total_tarjeta: 0,
        total_mixto: 0,
        total_ventas: 0,
        num_ventas: 0,
        total_propinas: 0,
        total_propinas_tarjeta: 0,
        total_propinas_efectivo: 0,
        estado: 'abierto',
        turno: cajero.turno ?? 'mañana',
        apertura_at: new Date().toISOString(),
      })
      if (error) { toast.error('Error al abrir turno: ' + error.message); return }
      await cargarCorte()
    } finally {
      setAbriendo(false)
    }
  }

  async function agregarMovimiento() {
    const monto = parseFloat(movMonto)
    if (!corteActivo || isNaN(monto) || monto <= 0 || !movConcepto.trim()) return
    setAgregandoMov(true)
    try {
      const { error } = await supabase.from('movimientos_caja').insert({
        corte_id: corteActivo.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        tipo: movTipo,
        monto,
        motivo: movConcepto.trim(),
      })
      if (error) { toast.error('Error al registrar movimiento: ' + error.message); return }
      setMovMonto('')
      setMovConcepto('')
      await cargarMovimientos(corteActivo.id)
    } finally {
      setAgregandoMov(false)
    }
  }

  async function imprimirCierre(
    corte: CorteCaja,
    movs: Movimiento[],
    propinasTurnos?: { manana: { tarjeta: number; efectivo: number }; tarde: { tarjeta: number; efectivo: number } }
  ) {
    if (!hayImpresora('caja')) { return }

    const fmt  = (n: number) => '$' + n.toFixed(2)
    const fmtH = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const entradas = movs.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0)
    const salidas  = movs.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0)

    const { data: ajRows } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['rest_nombre', 'rest_direccion', 'rest_telefono'])
    const aj: Record<string, string> = {}
    for (const r of ajRows ?? []) aj[r.clave] = r.valor
    const nombreLocal = (aj['rest_nombre'] || 'EL CAFE DEL CONSTRUCTOR').toUpperCase()

    const t = crearTicket()
    t.encabezado(nombreLocal, 'CIERRE DE TURNO', {
      direccion: aj['rest_direccion'],
      telefono:  aj['rest_telefono'],
      eslogan:   'Tu obra, tu cafe, tus recompensas',
      info:      [corte.cajero_nombre, new Date(corte.cierre_at || '').toLocaleString('es-MX')],
    })
    t.seccion(`Ventas del turno (${corte.num_ventas})`)
    t.fila('Fondo inicial', fmt(corte.fondo_inicial))
    t.fila('Efectivo',      fmt(corte.total_efectivo))
    t.fila('Tarjeta',       fmt(corte.total_tarjeta))
    t.fila('Mixto',         fmt(corte.total_mixto))
    t.sepDoble()
    t.totalGrande('TOTAL', fmt(corte.total_ventas))

    const propIncluyeAmbos = propinasTurnos &&
      (propinasTurnos.manana.tarjeta + propinasTurnos.manana.efectivo +
       propinasTurnos.tarde.tarjeta  + propinasTurnos.tarde.efectivo) > 0

    t.sep()
    if (propIncluyeAmbos && propinasTurnos) {
      t.seccion('Propinas del dia')
      t.linea('Turno manana:')
      t.fila('  Tarjeta',  fmt(propinasTurnos.manana.tarjeta))
      t.fila('  Efectivo', fmt(propinasTurnos.manana.efectivo))
      t.linea('Turno tarde:')
      t.fila('  Tarjeta',  fmt(propinasTurnos.tarde.tarjeta))
      t.fila('  Efectivo', fmt(propinasTurnos.tarde.efectivo))
      t.sepDoble()
      const totalProp = propinasTurnos.manana.tarjeta + propinasTurnos.manana.efectivo +
                        propinasTurnos.tarde.tarjeta  + propinasTurnos.tarde.efectivo
      t.filaB('TOTAL PROPINAS', fmt(totalProp))
    } else {
      t.seccion('Propinas este turno')
      t.fila('Tarjeta',  fmt(corte.total_propinas_tarjeta ?? 0))
      t.fila('Efectivo', fmt(corte.total_propinas_efectivo ?? 0))
    }

    t.sep()
    t.seccion('Caja chica')
    if (movs.length === 0) {
      t.linea('-- Sin movimientos --')
    } else {
      for (const m of movs) {
        const signo = m.tipo === 'entrada' ? '+' : '-'
        t.fila(`${fmtH(m.created_at)} ${(m.motivo ?? '').slice(0, 22)}`, `${signo}${fmt(m.monto)}`)
      }
    }
    t.sep()
    t.fila('Entradas', `+${fmt(entradas)}`)
    t.fila('Salidas',  `-${fmt(salidas)}`)
    t.sepDoble()
    t.fila('Efectivo esperado', fmt(corte.fondo_inicial + corte.total_efectivo + entradas - salidas))
    t.fila('Efectivo contado',  fmt(corte.efectivo_contado ?? 0))
    t.sep()
    const dif = corte.diferencia ?? 0
    t.centrar(dif >= 0 ? 'SOBRANTE' : 'FALTANTE', true)
    t.centrar(fmt(Math.abs(dif)), true)
    if (corte.notas) { t.sep(); t.linea(`Notas: ${corte.notas}`) }
    t.sep()
    t.centrar('-- Fin del turno --')

    await imprimirPorTipo('caja', t.fin())
  }

  async function consultarSemana() {
    if (!semanaDesde || !semanaHasta) { toast.error('Selecciona un rango de fechas válido'); return }
    setCargandoSemana(true)
    try {
      const desdeISO = new Date(semanaDesde + 'T00:00:00').toISOString()
      const hastaISO = new Date(semanaHasta + 'T23:59:59').toISOString()
      let q = supabase
        .from('cortes_caja')
        .select('cajero_nombre, num_ventas, total_ventas, total_propinas_tarjeta, total_propinas_efectivo, turno')
        .gte('apertura_at', desdeISO)
        .lte('apertura_at', hastaISO)
        .eq('estado', 'cerrado')
      if (semanaTurno !== 'todos') q = q.eq('turno', semanaTurno)
      const [{ data }, { data: personal }, { data: ventasAbiertas }] = await Promise.all([
        q,
        supabase
          .from('personal')
          .select('id, nombre, apellido, rol, porcentaje_propina')
          .eq('activo', true)
          .gt('porcentaje_propina', 0)
          .order('rol'),
        // Incluir también propinas de ventas en cortes AÚN ABIERTOS del período
        supabase
          .from('ventas')
          .select('cajero_nombre, total, metodo_pago, propina, estado')
          .gte('created_at', desdeISO)
          .lte('created_at', hastaISO)
          .eq('estado', 'completada'),
      ])
      const grouped: Record<string, typeof semanaData[0]> = {}
      ;(data || []).forEach((c: any) => {
        if (!grouped[c.cajero_nombre]) grouped[c.cajero_nombre] = { cajero_nombre: c.cajero_nombre, num_ventas: 0, total_ventas: 0, propinas_tarjeta: 0, propinas_efectivo: 0 }
        grouped[c.cajero_nombre].num_ventas += Number(c.num_ventas ?? 0)
        grouped[c.cajero_nombre].total_ventas += Number(c.total_ventas ?? 0)
        grouped[c.cajero_nombre].propinas_tarjeta += Number(c.total_propinas_tarjeta ?? 0)
        grouped[c.cajero_nombre].propinas_efectivo += Number(c.total_propinas_efectivo ?? 0)
      })
      // Sumar propinas de cortes abiertos (ventas del período no contabilizadas en cortes cerrados)
      // Nota: puede haber duplicados si el corte ya fue cerrado, pero son pocos y se toma
      // el enfoque de NO duplicar: solo añadir ventas cuyo cajero NO apareció en cortes cerrados.
      // Enfoque más robusto: separar consulta de ventas por cajero_id de cortes abiertos.
      // Por simplicidad, se agregan todas las ventas del período y se muestran en un grupo aparte "Sin cerrar".
      const groupedVentas: Record<string, typeof semanaData[0]> = {}
      ;(ventasAbiertas || []).forEach((v: any) => {
        const nombre = v.cajero_nombre ?? 'Sin nombre'
        if (!groupedVentas[nombre]) groupedVentas[nombre] = { cajero_nombre: nombre, num_ventas: 0, total_ventas: 0, propinas_tarjeta: 0, propinas_efectivo: 0 }
        groupedVentas[nombre].num_ventas  += 1
        groupedVentas[nombre].total_ventas += Number(v.total ?? 0)
        const prop = Number(v.propina ?? 0)
        if (v.metodo_pago === 'tarjeta' || v.metodo_pago === 'mixto') groupedVentas[nombre].propinas_tarjeta += prop
        else groupedVentas[nombre].propinas_efectivo += prop
      })
      // Merge: si el cajero ya tiene cortes cerrados, reemplazar con datos de ventas (más precisos para el período)
      // Si no tiene cortes cerrados, usar datos de ventas directamente
      Object.values(groupedVentas).forEach(gv => {
        if (!grouped[gv.cajero_nombre]) {
          grouped[gv.cajero_nombre] = gv
        } else {
          // Comparar y tomar el mayor (ventas directas son más completas)
          const existing = grouped[gv.cajero_nombre]
          if (gv.num_ventas > existing.num_ventas) {
            grouped[gv.cajero_nombre] = gv
          }
        }
      })
      setSemanaData(Object.values(grouped).sort((a, b) => b.total_ventas - a.total_ventas))
      setSemanaPersonal((personal as any[]) ?? [])
    } finally {
      setCargandoSemana(false)
    }
  }

  async function imprimirSemana() {
    if (!hayImpresora('caja')) { return }

    const fmt = (n: number) => '$' + n.toFixed(2)
    const totalVentas       = semanaData.reduce((s, r) => s + r.total_ventas, 0)
    const totalPropTarjeta  = semanaData.reduce((s, r) => s + r.propinas_tarjeta, 0)
    const totalPropEfectivo = semanaData.reduce((s, r) => s + r.propinas_efectivo, 0)
    const turnoLabel = semanaTurno === 'todos' ? 'Todos los turnos' : `Turno ${semanaTurno}`
    const sumPct = semanaPersonal.reduce((s, p) => s + Number(p.porcentaje_propina ?? 0), 0)

    const { data: ajRows } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['rest_nombre', 'rest_direccion', 'rest_telefono'])
    const aj: Record<string, string> = {}
    for (const r of ajRows ?? []) aj[r.clave] = r.valor
    const nombreLocalSemana = (aj['rest_nombre'] || 'EL CAFE DEL CONSTRUCTOR').toUpperCase()

    const t = crearTicket()
    t.encabezado(nombreLocalSemana, 'CIERRE DE SEMANA', {
      direccion: aj['rest_direccion'],
      telefono:  aj['rest_telefono'],
      eslogan:   'Tu obra, tu cafe, tus recompensas',
      info:      [turnoLabel, `${semanaDesde} al ${semanaHasta}`],
    })
    t.seccion('Ventas por cajero')
    t.filaB('Nombre              Vtas  Total', '')
    t.sep()
    for (const r of semanaData) {
      const nom   = (r.cajero_nombre ?? 'N/A').split(' ')[0].slice(0, 14).padEnd(14)
      const vtas  = String(r.num_ventas).padStart(4)
      const total = fmt(r.total_ventas).padStart(9)
      t.linea(`${nom} ${vtas} ${total}`)
    }
    t.sepDoble()
    t.totalGrande('TOTAL', fmt(totalVentas))

    t.sep()
    t.seccion('Propinas de la semana')
    t.fila('Tarjeta (repartible)', fmt(totalPropTarjeta))
    t.fila('Efectivo',             fmt(totalPropEfectivo))
    t.sepDoble()
    t.filaB('TOTAL PROPINAS', fmt(totalPropTarjeta + totalPropEfectivo))

    if (sumPct > 0 && totalPropTarjeta > 0) {
      t.sep()
      t.seccion('Reparto de propinas (tarjeta)')
      t.filaB('Empleado           %  Monto', '')
      t.sep()
      for (const p of semanaPersonal) {
        const monto = (Number(p.porcentaje_propina) / sumPct) * totalPropTarjeta
        const nom   = `${p.nombre} ${p.apellido}`.slice(0, 16).padEnd(16)
        const pct   = `${p.porcentaje_propina}%`.padStart(3)
        const mon   = fmt(monto).padStart(8)
        t.linea(`${nom} ${pct} ${mon}`)
      }
    }

    t.sep()
    t.centrar('-- Fin del reporte --')

    await imprimirPorTipo('caja', t.fin())
  }

  async function cerrarTurno() {
    if (!corteActivo || cerrando) return
    const contado = parseFloat(efectivoContado)
    if (isNaN(contado) || contado < 0) return
    setCerrando(true)
    try {
      const { data: ventasEfectivo, error: errVentas } = await supabase
        .from('ventas')
        .select('total, metodo_pago, propina')
        .gte('created_at', corteActivo.apertura_at)
        .eq('estado', 'completada')

      if (errVentas) { toast.error('Error al leer ventas del turno'); return }

      let totalEfectivoVentas = 0
      let totalTarjetaVentas = 0
      let totalMixtoVentas = 0
      let numVentasTotal = 0
      let totalPropinasTarjeta = 0
      let totalPropinasEfectivo = 0

      ;(ventasEfectivo || []).forEach((v: { total: number; metodo_pago: string; propina?: number }) => {
        numVentasTotal++
        const prop = Number(v.propina ?? 0)
        if (v.metodo_pago === 'tarjeta' || v.metodo_pago === 'mixto') totalPropinasTarjeta += prop
        else totalPropinasEfectivo += prop
        if (v.metodo_pago === 'efectivo') totalEfectivoVentas += Number(v.total)
        else if (v.metodo_pago === 'tarjeta') totalTarjetaVentas += Number(v.total)
        else if (v.metodo_pago === 'mixto') totalMixtoVentas += Number(v.total)
      })

      const entradas = movimientos
        .filter((m) => m.tipo === 'entrada')
        .reduce((s, m) => s + m.monto, 0)
      const salidas = movimientos
        .filter((m) => m.tipo === 'salida')
        .reduce((s, m) => s + m.monto, 0)

      const efectivoEsperado =
        corteActivo.fondo_inicial + totalEfectivoVentas + entradas - salidas
      const diferencia = contado - efectivoEsperado

      // Advertir si la diferencia es mayor a $50
      if (Math.abs(diferencia) > 50) {
        const signo = diferencia > 0 ? '+' : ''
        const ok = window.confirm(
          `⚠️ Diferencia de caja: ${signo}$${diferencia.toFixed(2)} MXN\n\nEso supera el límite de $50 de tolerancia. ¿Deseas cerrar el turno de todas formas?`
        )
        if (!ok) { setCerrando(false); setConfirmandoCierre(false); return }
      }

      const { data: updatedCorte, error: errCierre } = await supabase
        .from('cortes_caja')
        .update({
          total_efectivo: totalEfectivoVentas,
          total_tarjeta: totalTarjetaVentas,
          total_mixto: totalMixtoVentas,
          total_ventas: totalEfectivoVentas + totalTarjetaVentas + totalMixtoVentas,
          num_ventas: numVentasTotal,
          total_propinas: totalPropinasTarjeta + totalPropinasEfectivo,
          total_propinas_tarjeta: totalPropinasTarjeta,
          total_propinas_efectivo: totalPropinasEfectivo,
          efectivo_contado: contado,
          diferencia,
          notas: notasCierre.trim() || null,
          estado: 'cerrado',
          cierre_at: new Date().toISOString(),
        })
        .eq('id', corteActivo.id)
        .select()
        .maybeSingle()

      if (errCierre || !updatedCorte) {
        toast.error('Error al cerrar el turno: ' + (errCierre?.message ?? 'Sin datos'))
        return
      }

      const corteData = updatedCorte as CorteCaja
      setTurnoFinalizado(corteData)
      setCorteActivo(null)
      // D3 — Audit log: corte de caja
      registrarAccion(
        'corte_caja',
        { total: totalEfectivoVentas + totalTarjetaVentas + totalMixtoVentas, diferencia },
        cajero.nombre,
      )
      // Consultar propinas de ambos turnos del día para incluir en el ticket
      const { data: cortesHoy } = await supabase
        .from('cortes_caja')
        .select('turno, total_propinas_tarjeta, total_propinas_efectivo')
        .gte('apertura_at', hoyISO)
      const propinasTurnos = { manana: { tarjeta: 0, efectivo: 0 }, tarde: { tarjeta: 0, efectivo: 0 } }
      ;(cortesHoy || []).forEach((c: { turno: string | null; total_propinas_tarjeta: number; total_propinas_efectivo: number }) => {
        const turno = c.turno === 'tarde' ? 'tarde' : 'manana'
        propinasTurnos[turno].tarjeta  += Number(c.total_propinas_tarjeta ?? 0)
        propinasTurnos[turno].efectivo += Number(c.total_propinas_efectivo ?? 0)
      })
      setPropinasTurnos(propinasTurnos)
      // Imprimir resumen del turno automáticamente
      imprimirCierre(corteData, movimientos, propinasTurnos)
      // Cerrar sesión y volver a pantalla principal
      if (onCerrarSesion) {
        cerrarSesionTimerRef.current = setTimeout(() => onCerrarSesion(), 4000)
      }
    } finally {
      setCerrando(false)
      setConfirmandoCierre(false)
    }
  }

  const balanceCajaChica = corteActivo
    ? corteActivo.fondo_inicial +
      movimientos.filter((m) => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0) -
      movimientos.filter((m) => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0)
    : 0

  const efectivoEsperadoCierre = corteActivo
    ? corteActivo.fondo_inicial +
      (ventasResumen?.totalEfectivo ?? 0) +
      movimientos.filter((m) => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0) -
      movimientos.filter((m) => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0)
    : 0

  const diferenciaPreview = efectivoContado !== ''
    ? parseFloat(efectivoContado) - efectivoEsperadoCierre
    : null

  const fmt = (n: number) =>
    n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

  const fmtHora = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: 'var(--yellow)',
            fontWeight: 900,
            fontSize: '1.1rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          ⚙️ Cargando...
        </span>
      </div>
    )
  }

  // --- SUCCESS SCREEN ---
  if (turnoFinalizado) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--dark)', padding: '1.5rem' }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <div
            style={{
              background: 'var(--charcoal)',
              border: '1px solid var(--border)',
              borderTop: '4px solid var(--yellow)',
              borderRadius: 4,
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>⚙️</div>
            <h2
              style={{
                color: 'var(--yellow)',
                fontWeight: 900,
                fontSize: '1.4rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                margin: '0 0 0.25rem',
              }}
            >
              Turno Cerrado
            </h2>
            <p
              style={{
                color: 'var(--muted)',
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                marginBottom: '2rem',
              }}
            >
              {fmtFecha(turnoFinalizado.cierre_at || '')} —{' '}
              {fmtHora(turnoFinalizado.cierre_at || '')}
            </p>

            {[
              { label: 'Fondo inicial', value: fmt(turnoFinalizado.fondo_inicial) },
              { label: 'Ventas efectivo', value: fmt(turnoFinalizado.total_efectivo) },
              { label: 'Ventas tarjeta', value: fmt(turnoFinalizado.total_tarjeta) },
              { label: 'Ventas mixto', value: fmt(turnoFinalizado.total_mixto) },
              { label: 'Total ventas', value: fmt(turnoFinalizado.total_ventas) },
              { label: 'Num. ventas', value: String(turnoFinalizado.num_ventas) },
              { label: '💳 Propinas tarjeta', value: fmt(turnoFinalizado.total_propinas_tarjeta ?? 0) },
              { label: '💵 Propinas efectivo', value: fmt(turnoFinalizado.total_propinas_efectivo ?? 0) },
              { label: 'Total propinas', value: fmt(turnoFinalizado.total_propinas ?? 0) },
              {
                label: 'Efectivo contado',
                value: fmt(turnoFinalizado.efectivo_contado ?? 0),
              },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border)',
                  padding: '0.5rem 0',
                }}
              >
                <span
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.75rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 900,
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    color: 'var(--text)',
                    fontWeight: 900,
                    fontSize: '0.9rem',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}

            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'var(--dark)',
                borderRadius: 4,
                border: `2px solid ${(turnoFinalizado.diferencia ?? 0) >= 0 ? '#22c55e' : '#ef4444'}`,
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.7rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.25rem',
                }}
              >
                Diferencia
              </div>
              <div
                style={{
                  fontSize: '1.8rem',
                  fontWeight: 900,
                  color: (turnoFinalizado.diferencia ?? 0) >= 0 ? '#22c55e' : '#ef4444',
                  letterSpacing: '0.05em',
                }}
              >
                {fmt(turnoFinalizado.diferencia ?? 0)}
              </div>
            </div>

            {turnoFinalizado.notas && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  background: 'var(--dark)',
                  borderRadius: 4,
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.7rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    fontWeight: 900,
                    marginBottom: '0.25rem',
                  }}
                >
                  Notas
                </div>
                <div style={{ color: 'var(--text)', fontSize: '0.85rem' }}>
                  {turnoFinalizado.notas}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => imprimirCierre(turnoFinalizado!, movimientos, propinasTurnos)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'var(--dark)',
                  color: 'var(--yellow)',
                  border: '1px solid var(--yellow)',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                🖨️ Imprimir
              </button>
              <button
                onClick={() => onCerrarSesion ? onCerrarSesion() : onVolver()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'var(--yellow)',
                  color: 'var(--black)',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- APERTURA MODE ---
  if (!corteActivo) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--dark)', padding: '1.5rem' }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <button
              onClick={onVolver}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '0.4rem 0.75rem',
                color: 'var(--muted)',
                fontWeight: 900,
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ← Volver
            </button>
            <h1
              style={{
                color: 'var(--yellow)',
                fontWeight: 900,
                fontSize: '1.1rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              ⚙️ Corte de Caja
            </h1>
          </div>

          {/* No turno card */}
          <div
            style={{
              background: 'var(--charcoal)',
              border: '1px solid var(--border)',
              borderLeft: '4px solid var(--yellow)',
              borderRadius: 4,
              padding: '1.5rem',
              marginBottom: '1.5rem',
            }}
          >
            <p
              style={{
                color: 'var(--muted)',
                fontSize: '0.75rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontWeight: 900,
                marginBottom: '0.75rem',
              }}
            >
              No hay turno abierto hoy
            </p>
            <p
              style={{
                color: 'var(--muted)',
                fontSize: '0.85rem',
                marginBottom: '1.25rem',
              }}
            >
              Para abrir un turno debes contar el fondo inicial en billetes desde la página de{' '}
              <strong style={{ color: 'var(--yellow)' }}>Apertura de Caja</strong>.
            </p>
            <button
              onClick={() => onIrApertura ? onIrApertura() : onVolver()}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'var(--yellow)',
                color: 'var(--black)',
                border: 'none',
                borderRadius: 4,
                fontWeight: 900,
                fontSize: '0.85rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ⚙️ Ir a Apertura de Caja
            </button>
          </div>

          {/* Historial */}
          {historialCortes.length > 0 && (
            <div>
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.7rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Últimos Turnos
              </div>
              {historialCortes.map((c) => (
                <div
                  key={c.id}
                  style={{
                    background: 'var(--charcoal)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${(c.diferencia ?? 0) >= 0 ? '#22c55e' : '#ef4444'}`,
                    borderRadius: 4,
                    padding: '1rem',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: 'var(--text)',
                        fontWeight: 900,
                        fontSize: '0.85rem',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {fmtFecha(c.apertura_at)}
                    </div>
                    <div
                      style={{
                        color: 'var(--muted)',
                        fontSize: '0.7rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontWeight: 900,
                      }}
                    >
                      {c.num_ventas} ventas · {fmt(c.total_ventas)}
                    </div>
                  </div>
                  <div
                    style={{
                      color: (c.diferencia ?? 0) >= 0 ? '#22c55e' : '#ef4444',
                      fontWeight: 900,
                      fontSize: '0.9rem',
                    }}
                  >
                    {fmt(c.diferencia ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- TURNO ACTIVO MODE ---
  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark)', padding: '1.5rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={onVolver}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '0.4rem 0.75rem',
                color: 'var(--muted)',
                fontWeight: 900,
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ← Volver
            </button>
            <h1
              style={{
                color: 'var(--yellow)',
                fontWeight: 900,
                fontSize: '1.1rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              ⚙️ Corte de Caja
            </h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                color: 'var(--muted)',
                fontSize: '0.65rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                fontWeight: 900,
              }}
            >
              Apertura
            </div>
            <div
              style={{
                color: 'var(--text)',
                fontWeight: 900,
                fontSize: '0.85rem',
              }}
            >
              {fmtFecha(corteActivo.apertura_at)} · {fmtHora(corteActivo.apertura_at)}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            marginBottom: '1.5rem',
            background: 'var(--charcoal)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '0.25rem',
          }}
        >
          {(
            [
              { key: 'resumen', label: 'Resumen' },
              { key: 'caja-chica', label: 'Caja Chica' },
              { key: 'cerrar', label: 'Cerrar Turno' },
              { key: 'semana', label: 'Semana' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: '0.5rem',
                background: tab === t.key ? 'var(--yellow)' : 'transparent',
                color: tab === t.key ? 'var(--black)' : 'var(--muted)',
                border: 'none',
                borderRadius: 3,
                fontWeight: 900,
                fontSize: '0.7rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* --- TAB: RESUMEN --- */}
        {tab === 'resumen' && (
          <div>
            {/* Stats bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              {[
                {
                  label: 'Ventas del turno',
                  value: ventasResumen ? String(ventasResumen.numVentas) : '0',
                  accent: 'var(--yellow)',
                },
                {
                  label: 'Total recaudado',
                  value: ventasResumen ? fmt(ventasResumen.totalVentas) : fmt(0),
                  accent: '#22c55e',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    background: 'var(--charcoal)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${stat.accent}`,
                    borderRadius: 4,
                    padding: '1rem',
                  }}
                >
                  <div
                    style={{
                      color: 'var(--muted)',
                      fontSize: '0.65rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      fontWeight: 900,
                      marginBottom: '0.25rem',
                    }}
                  >
                    {stat.label}
                  </div>
                  <div
                    style={{
                      color: stat.accent,
                      fontWeight: 900,
                      fontSize: '1.3rem',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Métodos de pago chips */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Por Método de Pago
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  {
                    label: 'Efectivo',
                    value: ventasResumen?.totalEfectivo ?? 0,
                    color: '#22c55e',
                  },
                  {
                    label: 'Tarjeta',
                    value: ventasResumen?.totalTarjeta ?? 0,
                    color: '#3b82f6',
                  },
                  {
                    label: 'Mixto',
                    value: ventasResumen?.totalMixto ?? 0,
                    color: '#f59e0b',
                  },
                ].map((m) => (
                  <div
                    key={m.label}
                    style={{
                      padding: '0.4rem 0.75rem',
                      background: 'var(--dark)',
                      border: `1px solid ${m.color}`,
                      borderRadius: 100,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--muted)',
                        fontSize: '0.65rem',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        fontWeight: 900,
                      }}
                    >
                      {m.label}
                    </span>
                    <span
                      style={{
                        color: m.color,
                        fontWeight: 900,
                        fontSize: '0.85rem',
                      }}
                    >
                      {fmt(m.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comparativa con turno anterior */}
            {turnoAnterior && (
              <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.75rem' }}>
                  vs. Turno Anterior ({fmtFecha(turnoAnterior.apertura_at)})
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {[
                    {
                      label: 'Ventas',
                      actual: ventasResumen?.numVentas ?? 0,
                      anterior: turnoAnterior.num_ventas,
                      fmt: (n: number) => String(n),
                    },
                    {
                      label: 'Total',
                      actual: ventasResumen?.totalVentas ?? 0,
                      anterior: turnoAnterior.total_ventas,
                      fmt: (n: number) => fmt(n),
                    },
                  ].map(item => {
                    const diff = item.actual - item.anterior
                    const pct = item.anterior > 0 ? Math.round((diff / item.anterior) * 100) : null
                    const color = diff >= 0 ? '#22c55e' : '#ef4444'
                    return (
                      <div key={item.label} style={{ flex: 1, background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.75rem', textAlign: 'center' }}>
                        <div style={{ color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.25rem' }}>{item.label}</div>
                        <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem' }}>{item.fmt(item.actual)}</div>
                        {pct !== null && (
                          <div style={{ color, fontSize: '0.7rem', fontWeight: 900, marginTop: '0.2rem' }}>
                            {diff >= 0 ? '▲' : '▼'} {Math.abs(pct)}%
                          </div>
                        )}
                        <div style={{ color: 'var(--muted)', fontSize: '0.65rem', marginTop: '0.2rem' }}>Ant: {item.fmt(item.anterior)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Gráfica de ventas por hora */}
            {ventasResumen && ventasResumen.numVentas > 0 && (
              <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.75rem' }}>
                  Ventas por Hora
                </div>
                {(() => {
                  const horas = Array.from({ length: 17 }, (_, i) => i + 6) // 6am a 10pm
                  const maxVal = Math.max(...horas.map(h => ventasResumen.porHora[h] ?? 0), 1)
                  return (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 80 }}>
                      {horas.map(h => {
                        const val = ventasResumen.porHora[h] ?? 0
                        const pct = val / maxVal
                        const isActive = val > 0
                        const horaActual = new Date().getHours()
                        const isCurrent = h === horaActual
                        return (
                          <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}
                            title={val > 0 ? `${h}:00 — ${fmt(val)}` : `${h}:00 — Sin ventas`}>
                            <div style={{
                              width: '100%',
                              height: `${Math.max(pct * 64, isActive ? 4 : 2)}px`,
                              background: isCurrent ? 'var(--yellow)' : isActive ? '#22c55e' : 'var(--border)',
                              transition: 'height 0.3s',
                              opacity: isActive ? 1 : 0.3,
                            }} />
                            <span style={{ fontSize: '0.5rem', color: isCurrent ? 'var(--yellow)' : 'var(--muted)', fontWeight: isCurrent ? 900 : 400 }}>
                              {h}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <div style={{ width: 8, height: 8, background: '#22c55e' }} />
                    <span style={{ color: 'var(--muted)', fontSize: '0.6rem' }}>Con ventas</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <div style={{ width: 8, height: 8, background: 'var(--yellow)' }} />
                    <span style={{ color: 'var(--muted)', fontSize: '0.6rem' }}>Hora actual</span>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline movimientos */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Movimientos de Caja Chica
              </div>
              {movimientos.length === 0 ? (
                <div
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    padding: '1rem',
                  }}
                >
                  Sin movimientos registrados
                </div>
              ) : (
                movimientos.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderLeft: `3px solid ${m.tipo === 'entrada' ? '#22c55e' : '#ef4444'}`,
                      paddingLeft: '0.75rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: 'var(--text)',
                          fontWeight: 900,
                          fontSize: '0.85rem',
                        }}
                      >
                        {m.motivo}
                      </div>
                      <div
                        style={{
                          color: 'var(--muted)',
                          fontSize: '0.65rem',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          fontWeight: 900,
                        }}
                      >
                        {fmtHora(m.created_at)}
                      </div>
                    </div>
                    <div
                      style={{
                        color: m.tipo === 'entrada' ? '#22c55e' : '#ef4444',
                        fontWeight: 900,
                        fontSize: '0.9rem',
                      }}
                    >
                      {m.tipo === 'entrada' ? '+' : '-'}
                      {fmt(m.monto)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* --- TAB: CAJA CHICA --- */}
        {tab === 'caja-chica' && (
          <div>
            {/* Balance */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid var(--yellow)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.7rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                }}
              >
                Balance de Caja Chica
              </div>
              <div
                style={{
                  color: 'var(--yellow)',
                  fontWeight: 900,
                  fontSize: '1.4rem',
                }}
              >
                {fmt(balanceCajaChica)}
              </div>
            </div>

            {/* Movimientos list */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Movimientos
              </div>
              {movimientos.length === 0 ? (
                <div
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    padding: '1rem',
                  }}
                >
                  Sin movimientos
                </div>
              ) : (
                movimientos.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.6rem 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: m.tipo === 'entrada' ? '#22c55e' : '#ef4444',
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div
                          style={{
                            color: 'var(--text)',
                            fontWeight: 900,
                            fontSize: '0.85rem',
                          }}
                        >
                          {m.motivo}
                        </div>
                        <div
                          style={{
                            color: 'var(--muted)',
                            fontSize: '0.65rem',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            fontWeight: 900,
                          }}
                        >
                          {m.tipo === 'entrada' ? 'Entrada' : 'Salida'} · {fmtHora(m.created_at)}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        color: m.tipo === 'entrada' ? '#22c55e' : '#ef4444',
                        fontWeight: 900,
                        fontSize: '0.9rem',
                      }}
                    >
                      {m.tipo === 'entrada' ? '+' : '-'}
                      {fmt(m.monto)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Agregar movimiento */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Agregar Movimiento
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {(['entrada', 'salida'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMovTipo(t)}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      background: movTipo === t ? (t === 'entrada' ? '#22c55e' : '#ef4444') : 'var(--dark)',
                      color: movTipo === t ? '#fff' : 'var(--muted)',
                      border: `1px solid ${movTipo === t ? (t === 'entrada' ? '#22c55e' : '#ef4444') : 'var(--border)'}`,
                      borderRadius: 4,
                      fontWeight: 900,
                      fontSize: '0.7rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    {t === 'entrada' ? '↑ Entrada' : '↓ Salida'}
                  </button>
                ))}
              </div>

              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Monto"
                value={movMonto}
                onChange={(e) => setMovMonto(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--dark)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text)',
                  fontSize: '1rem',
                  fontWeight: 900,
                  marginBottom: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="text"
                placeholder="Concepto"
                value={movConcepto}
                onChange={(e) => setMovConcepto(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--dark)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text)',
                  fontSize: '0.9rem',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={agregarMovimiento}
                disabled={agregandoMov || !movMonto || !movConcepto}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  background: 'var(--yellow)',
                  color: 'var(--black)',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  cursor: agregandoMov || !movMonto || !movConcepto ? 'not-allowed' : 'pointer',
                  opacity: agregandoMov || !movMonto || !movConcepto ? 0.6 : 1,
                }}
              >
                {agregandoMov ? 'Guardando...' : 'Agregar'}
              </button>
            </div>
          </div>
        )}

        {/* --- TAB: CERRAR TURNO --- */}
        {tab === 'cerrar' && (
          <div>
            {/* Efectivo esperado */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid #3b82f6',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.25rem',
                }}
              >
                Efectivo Esperado en Caja
              </div>
              <div
                style={{
                  color: '#3b82f6',
                  fontWeight: 900,
                  fontSize: '1.6rem',
                  letterSpacing: '0.02em',
                }}
              >
                {fmt(efectivoEsperadoCierre)}
              </div>
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginTop: '0.25rem',
                }}
              >
                Fondo {fmt(corteActivo.fondo_inicial)} + Efectivo ventas{' '}
                {fmt(ventasResumen?.totalEfectivo ?? 0)} + Entradas −
                Salidas
              </div>
            </div>

            {/* Input conteo */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <label
                style={{
                  display: 'block',
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.4rem',
                }}
              >
                Efectivo Contado Físicamente
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={efectivoContado}
                onChange={(e) => setEfectivoContado(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.75rem',
                  background: 'var(--dark)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text)',
                  fontSize: '1.2rem',
                  fontWeight: 900,
                  boxSizing: 'border-box',
                }}
              />

              {/* Diferencia preview */}
              {diferenciaPreview !== null && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'var(--dark)',
                    borderRadius: 4,
                    border: `2px solid ${diferenciaPreview >= 0 ? '#22c55e' : '#ef4444'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--muted)',
                      fontSize: '0.65rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      fontWeight: 900,
                    }}
                  >
                    {diferenciaPreview >= 0 ? 'Sobrante' : 'Faltante'}
                  </span>
                  <span
                    style={{
                      color: diferenciaPreview >= 0 ? '#22c55e' : '#ef4444',
                      fontWeight: 900,
                      fontSize: '1.2rem',
                    }}
                  >
                    {fmt(Math.abs(diferenciaPreview))}
                  </span>
                </div>
              )}
            </div>

            {/* Notas */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <label
                style={{
                  display: 'block',
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.4rem',
                }}
              >
                Notas (opcional)
              </label>
              <textarea
                rows={3}
                placeholder="Observaciones del turno..."
                value={notasCierre}
                onChange={(e) => setNotasCierre(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--dark)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text)',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Cerrar button */}
            {!confirmandoCierre ? (
              <button
                onClick={() => setConfirmandoCierre(true)}
                disabled={!efectivoContado}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.9rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  cursor: !efectivoContado ? 'not-allowed' : 'pointer',
                  opacity: !efectivoContado ? 0.5 : 1,
                }}
              >
                Cerrar Turno
              </button>
            ) : (
              <div
                style={{
                  background: 'var(--charcoal)',
                  border: '2px solid #ef4444',
                  borderRadius: 4,
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <p
                  style={{
                    color: 'var(--text)',
                    fontWeight: 900,
                    fontSize: '0.85rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginBottom: '0.5rem',
                  }}
                >
                  ¿Confirmar cierre de turno?
                </p>
                <p
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  Esta acción no se puede deshacer.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setConfirmandoCierre(false)}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      background: 'var(--dark)',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      fontWeight: 900,
                      fontSize: '0.75rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={cerrarTurno}
                    disabled={cerrando}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      fontWeight: 900,
                      fontSize: '0.75rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      cursor: cerrando ? 'not-allowed' : 'pointer',
                      opacity: cerrando ? 0.7 : 1,
                    }}
                  >
                    {cerrando ? 'Cerrando...' : 'Sí, Cerrar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- TAB: SEMANA --- */}
        {tab === 'semana' && (
          <div>
            {/* Filtros */}
            <div
              style={{
                background: 'var(--charcoal)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.75rem',
                }}
              >
                Rango de fechas
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label
                    style={{
                      display: 'block',
                      color: 'var(--muted)',
                      fontSize: '0.6rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      fontWeight: 900,
                      marginBottom: '0.3rem',
                    }}
                  >
                    Desde
                  </label>
                  <input
                    type="date"
                    value={semanaDesde}
                    onChange={(e) => setSemanaDesde(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.6rem',
                      background: 'var(--dark)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label
                    style={{
                      display: 'block',
                      color: 'var(--muted)',
                      fontSize: '0.6rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      fontWeight: 900,
                      marginBottom: '0.3rem',
                    }}
                  >
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={semanaHasta}
                    onChange={(e) => setSemanaHasta(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.6rem',
                      background: 'var(--dark)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Turno filter */}
              <div
                style={{
                  color: 'var(--muted)',
                  fontSize: '0.6rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontWeight: 900,
                  marginBottom: '0.4rem',
                }}
              >
                Turno
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.85rem' }}>
                {(['todos', 'mañana', 'tarde'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSemanaTurno(t)}
                    style={{
                      flex: 1,
                      padding: '0.45rem',
                      background: semanaTurno === t ? 'var(--yellow)' : 'var(--dark)',
                      color: semanaTurno === t ? 'var(--black)' : 'var(--muted)',
                      border: `1px solid ${semanaTurno === t ? 'var(--yellow)' : 'var(--border)'}`,
                      borderRadius: 4,
                      fontWeight: 900,
                      fontSize: '0.7rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    {t === 'todos' ? 'Todos' : t === 'mañana' ? 'Mañana' : 'Tarde'}
                  </button>
                ))}
              </div>

              <button
                onClick={consultarSemana}
                disabled={cargandoSemana}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  background: 'var(--yellow)',
                  color: 'var(--black)',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  cursor: cargandoSemana ? 'not-allowed' : 'pointer',
                  opacity: cargandoSemana ? 0.7 : 1,
                }}
              >
                {cargandoSemana ? 'Consultando...' : 'Consultar'}
              </button>
            </div>

            {/* Results */}
            {semanaData.length > 0 && (
              <div
                style={{
                  background: 'var(--charcoal)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.65rem',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    fontWeight: 900,
                    marginBottom: '0.75rem',
                  }}
                >
                  Ventas por cajero
                </div>

                {/* Table header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 60px 90px 80px 80px',
                    gap: '0.25rem',
                    paddingBottom: '0.4rem',
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '0.4rem',
                  }}
                >
                  {['Nombre', 'Vtas', 'Total', 'Prop.Tarj', 'Prop.Ef'].map((h) => (
                    <div
                      key={h}
                      style={{
                        color: 'var(--muted)',
                        fontSize: '0.6rem',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        fontWeight: 900,
                        textAlign: h === 'Nombre' || h === 'Vtas' ? 'left' : 'right',
                      }}
                    >
                      {h}
                    </div>
                  ))}
                </div>

                {semanaData.map((r) => (
                  <div
                    key={r.cajero_nombre}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 60px 90px 80px 80px',
                      gap: '0.25rem',
                      padding: '0.4rem 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.8rem' }}>{r.cajero_nombre}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontWeight: 700 }}>{r.num_ventas}</div>
                    <div style={{ color: '#22c55e', fontWeight: 900, fontSize: '0.8rem', textAlign: 'right' }}>{fmt(r.total_ventas)}</div>
                    <div style={{ color: '#3b82f6', fontWeight: 700, fontSize: '0.8rem', textAlign: 'right' }}>{fmt(r.propinas_tarjeta)}</div>
                    <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.8rem', textAlign: 'right' }}>{fmt(r.propinas_efectivo)}</div>
                  </div>
                ))}

                {/* Totals row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 60px 90px 80px 80px',
                    gap: '0.25rem',
                    padding: '0.5rem 0 0',
                  }}
                >
                  <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Total</div>
                  <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.8rem' }}>
                    {semanaData.reduce((s, r) => s + r.num_ventas, 0)}
                  </div>
                  <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem', textAlign: 'right' }}>
                    {fmt(semanaData.reduce((s, r) => s + r.total_ventas, 0))}
                  </div>
                  <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.8rem', textAlign: 'right' }}>
                    {fmt(semanaData.reduce((s, r) => s + r.propinas_tarjeta, 0))}
                  </div>
                  <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.8rem', textAlign: 'right' }}>
                    {fmt(semanaData.reduce((s, r) => s + r.propinas_efectivo, 0))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Reparto de propinas ── */}
            {semanaData.length > 0 && semanaPersonal.length > 0 && (() => {
              const totalPropTarjeta = semanaData.reduce((s, r) => s + r.propinas_tarjeta, 0)
              const totalPropEfectivo = semanaData.reduce((s, r) => s + r.propinas_efectivo, 0)
              const sumPct = semanaPersonal.reduce((s, p) => s + Number(p.porcentaje_propina ?? 0), 0)
              const reparto = semanaPersonal.map(p => ({
                ...p,
                monto: sumPct > 0 ? (Number(p.porcentaje_propina) / sumPct) * totalPropTarjeta : 0,
              }))
              const ROL_COLOR: Record<string, string> = { cocinero: '#ef4444', cajero: '#F0A800', mesero: '#22c55e', gerente: '#a855f7' }
              return (
                <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #a855f7', borderRadius: 4, padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ color: '#a855f7', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.5rem' }}>
                    💜 Reparto de propinas — tarjeta
                  </div>

                  {/* Total a repartir */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 4, padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
                    <span style={{ color: '#a855f7', fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total a repartir</span>
                    <span style={{ color: '#fff', fontWeight: 900, fontSize: '1.1rem' }}>{fmt(totalPropTarjeta)}</span>
                  </div>

                  {/* Tabla por empleado */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 45px 80px', gap: '0.2rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', marginBottom: '0.3rem' }}>
                    {['Empleado', 'Rol', '%', 'Recibe'].map((h, i) => (
                      <div key={h} style={{ color: 'var(--muted)', fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: i > 1 ? 'right' : 'left' }}>{h}</div>
                    ))}
                  </div>
                  {reparto.map(p => (
                    <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 45px 80px', gap: '0.2rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
                      <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.8rem' }}>{p.nombre} {p.apellido}</div>
                      <div>
                        <span style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'capitalize', padding: '1px 5px', borderRadius: 3, background: `${ROL_COLOR[p.rol] ?? '#666'}22`, color: ROL_COLOR[p.rol] ?? '#666', border: `1px solid ${ROL_COLOR[p.rol] ?? '#666'}44` }}>
                          {p.rol}
                        </span>
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 700, textAlign: 'right' }}>{p.porcentaje_propina}%</div>
                      <div style={{ color: '#22c55e', fontWeight: 900, fontSize: '0.85rem', textAlign: 'right' }}>{fmt(p.monto)}</div>
                    </div>
                  ))}

                  {/* Propinas efectivo (no se reparte automáticamente) */}
                  {totalPropEfectivo > 0 && (
                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#f59e0b', fontSize: '0.68rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>💵 Propinas efectivo</span>
                        <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: '0.9rem' }}>{fmt(totalPropEfectivo)}</span>
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.62rem', marginTop: 3 }}>Repartir manualmente entre el equipo</div>
                    </div>
                  )}
                </div>
              )
            })()}

            {semanaData.length === 0 && !cargandoSemana && (
              <div
                style={{
                  background: 'var(--charcoal)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '1.5rem',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                }}
              >
                Selecciona un rango y presiona Consultar
              </div>
            )}

            {semanaData.length > 0 && (
              <button
                onClick={imprimirSemana}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  background: 'var(--dark)',
                  color: 'var(--yellow)',
                  border: '1px solid var(--yellow)',
                  borderRadius: 4,
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                🖨️ Imprimir
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
