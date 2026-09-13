import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'
import { crearTicket, imprimirPorTipo, hayImpresora } from '../services/printer'

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

interface Insumo {
  id: string
  nombre: string
  unidad: string
  stock_actual: number
  stock_minimo: number
  costo_unitario: number
}

interface Proveedor {
  id: string
  nombre: string
  telefono: string | null
  correo: string | null
  categoria: string | null
  activo: boolean
}

interface OrdenCompra {
  id: string
  proveedor_id: string
  cajero_nombre: string
  estado: 'pendiente' | 'recibida' | 'cancelada'
  total: number
  notas: string | null
  created_at: string
  proveedores?: { nombre: string; telefono: string | null } | null
}

interface OrdenCompraItem {
  id: string
  orden_compra_id: string
  inventario_id: string
  nombre_insumo: string
  cantidad_solicitada: number
  costo_unitario: number
  subtotal: number
}

interface ItemSeleccionado {
  insumo: Insumo
  cantidad: number
  costoUnitario: number
}

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtFecha = (s: string) => new Date(s).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtHora = (s: string) => new Date(s).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

const ESTADO_COLOR: Record<string, string> = {
  pendiente: '#f59e0b',
  recibida: '#22c55e',
  cancelada: '#ef4444',
}

export default function OrdenesCompraPage({ cajero, onVolver }: Props) {
  const [tab, setTab] = useState<'nueva' | 'historial'>('nueva')

  // Tab nueva OC
  const [insumosStockBajo, setInsumosStockBajo] = useState<Insumo[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [proveedorId, setProveedorId] = useState('')
  const [seleccionados, setSeleccionados] = useState<Record<string, ItemSeleccionado>>({})
  const [notas, setNotas] = useState('')
  const [loadingInsumos, setLoadingInsumos] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ocGenerada, setOcGenerada] = useState<{ id: string; proveedor: Proveedor; items: ItemSeleccionado[]; total: number; notas: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; tipo: 'ok' | 'error' } | null>(null)
  const [errorTabla, setErrorTabla] = useState(false)
  const [sinProveedores, setSinProveedores] = useState(false)

  // Tab historial
  const [historial, setHistorial] = useState<OrdenCompra[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)
  const [itemsExpandida, setItemsExpandida] = useState<OrdenCompraItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)

  useEffect(() => {
    if (tab === 'nueva') cargarDatosNueva()
    if (tab === 'historial') cargarHistorial()
  }, [tab])

  async function cargarDatosNueva() {
    setLoadingInsumos(true)
    setErrorTabla(false)
    setSinProveedores(false)
    try {
      // Cargar insumos con stock bajo
      const { data: insumos, error: errInsumos } = await supabase
        .from('inventario')
        .select('id, nombre, unidad, stock_actual, stock_minimo, costo_unitario')
        .order('nombre', { ascending: true })

      if (errInsumos) {
        if ((errInsumos as any).code === '42P01') {
          setErrorTabla(true)
        }
        return
      }

      const stockBajo = (insumos ?? []).filter(
        (i: Insumo) => Number(i.stock_actual) <= Number(i.stock_minimo)
      )
      setInsumosStockBajo(stockBajo)

      // Pre-seleccionar todos con déficit
      const preseleccion: Record<string, ItemSeleccionado> = {}
      for (const i of stockBajo) {
        const deficit = Math.max(0, Number(i.stock_minimo) - Number(i.stock_actual))
        preseleccion[i.id] = { insumo: i, cantidad: deficit || 1, costoUnitario: Number(i.costo_unitario) }
      }
      setSeleccionados(preseleccion)

      // Cargar proveedores activos
      const { data: provs, error: errProvs } = await supabase
        .from('proveedores')
        .select('id, nombre, telefono, correo, categoria, activo')
        .eq('activo', true)
        .order('nombre', { ascending: true })

      if (errProvs && (errProvs as any).code === '42P01') {
        setErrorTabla(true)
        return
      }

      if (!provs || provs.length === 0) {
        setSinProveedores(true)
      } else {
        setProveedores(provs)
        setProveedorId(provs[0].id)
      }
    } catch {
      // error de red
    } finally {
      setLoadingInsumos(false)
    }
  }

  async function cargarHistorial() {
    setLoadingHistorial(true)
    try {
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select('*, proveedores(nombre, telefono)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        if ((error as any).code === '42P01') setErrorTabla(true)
        return
      }
      setHistorial((data ?? []) as OrdenCompra[])
    } catch {
      // error de red
    } finally {
      setLoadingHistorial(false)
    }
  }

  async function cargarItemsOC(ocId: string) {
    if (expandida === ocId) { setExpandida(null); return }
    setExpandida(ocId)
    setLoadingItems(true)
    const { data, error } = await supabase
      .from('ordenes_compra_items')
      .select('*')
      .eq('orden_compra_id', ocId)
    if (error) {
      toast.error('Error al cargar items de la orden')
      setLoadingItems(false)
      return
    }
    setItemsExpandida((data ?? []) as OrdenCompraItem[])
    setLoadingItems(false)
  }

  function toggleSeleccion(insumo: Insumo) {
    setSeleccionados(prev => {
      if (prev[insumo.id]) {
        const next = { ...prev }
        delete next[insumo.id]
        return next
      }
      const deficit = Math.max(0, Number(insumo.stock_minimo) - Number(insumo.stock_actual))
      return { ...prev, [insumo.id]: { insumo, cantidad: deficit || 1, costoUnitario: Number(insumo.costo_unitario) } }
    })
  }

  function updateCantidad(insumoId: string, valor: string) {
    const n = parseFloat(valor)
    if (isNaN(n) || n <= 0) return
    setSeleccionados(prev => ({ ...prev, [insumoId]: { ...prev[insumoId], cantidad: n } }))
  }

  function updateCosto(insumoId: string, valor: string) {
    const n = parseFloat(valor)
    if (isNaN(n) || n < 0) return
    setSeleccionados(prev => ({ ...prev, [insumoId]: { ...prev[insumoId], costoUnitario: n } }))
  }

  const itemsSeleccionados = Object.values(seleccionados)
  const totalOC = itemsSeleccionados.reduce((s, it) => s + it.cantidad * it.costoUnitario, 0)

  async function generarOC() {
    if (guardando) return
    if (!proveedorId) { setMsg({ text: 'Selecciona un proveedor', tipo: 'error' }); return }
    if (itemsSeleccionados.length === 0) { setMsg({ text: 'Selecciona al menos un insumo', tipo: 'error' }); return }

    setGuardando(true)
    setMsg(null)

    const cajeroNombre = `${cajero.nombre} ${cajero.last_name}`

    const { data: oc, error: errOC } = await supabase
      .from('ordenes_compra')
      .insert({
        proveedor_id: proveedorId,
        cajero_nombre: cajeroNombre,
        estado: 'pendiente',
        total: totalOC,
        notas: notas.trim() || null,
      })
      .select()
      .single()

    if (errOC || !oc) {
      setMsg({ text: `Error al crear OC: ${errOC?.message ?? 'desconocido'}`, tipo: 'error' })
      setGuardando(false)
      return
    }

    const items = itemsSeleccionados.map(it => ({
      orden_compra_id: oc.id,
      inventario_id: it.insumo.id,
      nombre_insumo: it.insumo.nombre,
      cantidad_solicitada: it.cantidad,
      costo_unitario: it.costoUnitario,
      subtotal: it.cantidad * it.costoUnitario,
    }))

    const { error: errItems } = await supabase.from('ordenes_compra_items').insert(items)

    if (errItems) {
      setMsg({ text: `Error al insertar items: ${errItems.message}`, tipo: 'error' })
      setGuardando(false)
      return
    }

    const proveedor = proveedores.find(p => p.id === proveedorId)!
    setOcGenerada({ id: oc.id, proveedor, items: itemsSeleccionados, total: totalOC, notas: notas.trim() })
    setMsg({ text: '✓ Orden de compra generada correctamente', tipo: 'ok' })
    setNotas('')
    setGuardando(false)
  }

  async function imprimirOC() {
    if (!ocGenerada) return
    if (!hayImpresora('caja')) { return }

    const oc = ocGenerada
    const fecha = new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

    const t = crearTicket()
    t.encabezado('ORDEN DE COMPRA', 'EL CAFE DEL CONSTRUCTOR', [
      fecha,
      `OC #${oc.id.slice(-8).toUpperCase()}`,
    ])
    t.fila('Proveedor:', oc.proveedor.nombre)
    if (oc.proveedor.telefono) t.fila('Tel:', oc.proveedor.telefono)
    t.fila('Solicitante:', `${cajero.nombre} ${cajero.last_name}`)
    t.sep()
    t.filaB('Insumo                  Cant  Subtotal', '')
    t.sep()
    for (const it of oc.items) {
      const nom     = it.insumo.nombre.slice(0, 20).padEnd(20)
      const cant    = `${it.cantidad}${it.insumo.unidad ?? ''}`.slice(0, 6).padStart(6)
      const subtot  = `$${(it.cantidad * it.costoUnitario).toFixed(2)}`.padStart(9)
      t.linea(`${nom} ${cant} ${subtot}`)
    }
    t.sepDoble()
    t.totalGrande('TOTAL', `$${oc.total.toFixed(2)}`)
    if (oc.notas) { t.sep(); t.linea(`Notas: ${oc.notas}`) }
    t.sep()
    t.centrar('Estado: PENDIENTE')
    t.centrar('El Cafe del Constructor')

    await imprimirPorTipo('caja', t.fin())
  }

  function enviarWhatsApp() {
    if (!ocGenerada) return
    const tel = ocGenerada.proveedor.telefono?.replace(/\D/g, '')
    if (!tel) { setMsg({ text: 'El proveedor no tiene teléfono registrado', tipo: 'error' }); return }

    const lineas = ocGenerada.items.map(
      it => `• ${it.insumo.nombre}: ${it.cantidad} ${it.insumo.unidad ?? ''} × $${it.costoUnitario.toFixed(2)} = $${(it.cantidad * it.costoUnitario).toFixed(2)}`
    ).join('\n')

    const mensaje = encodeURIComponent(
      `*ORDEN DE COMPRA — El Café del Constructor*\n` +
      `OC #${ocGenerada.id.slice(-8).toUpperCase()}\n` +
      `Fecha: ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}\n\n` +
      `*Insumos solicitados:*\n${lineas}\n\n` +
      `*TOTAL: $${ocGenerada.total.toFixed(2)} MXN*\n` +
      (ocGenerada.notas ? `\nNotas: ${ocGenerada.notas}\n` : '') +
      `\nSolicitado por: ${cajero.nombre} ${cajero.last_name}`
    )

    window.open(`https://wa.me/${tel}?text=${mensaje}`, '_blank')
  }

  async function marcarRecibida(ocId: string) {
    if (marcando) return
    if (!confirm('¿Marcar como recibida y actualizar el inventario?')) return
    setMarcando(ocId)

    try {
      // Intentar RPC atómico primero
      const { data: rpcData, error: rpcErr } = await supabase.rpc('recibir_orden_compra', { p_oc_id: ocId })
      if (!rpcErr && (rpcData as any)?.ok) {
        toast.success('Orden recibida e inventario actualizado')
        setMarcando(null)
        cargarHistorial()
        if (expandida === ocId) setExpandida(null)
        return
      }

      // Fallback: loop manual — solo marca OC si TODOS los items actualizan correctamente
      const { data: items, error: itemsError } = await supabase
        .from('ordenes_compra_items')
        .select('*')
        .eq('orden_compra_id', ocId)

      if (itemsError) {
        toast.error('Error al cargar items de la OC')
        setMarcando(null)
        return
      }

      if (items && items.length > 0) {
        for (const item of items as OrdenCompraItem[]) {
          // Obtener stock actual
          const { data: inv, error: invError } = await supabase
            .from('inventario')
            .select('stock_actual')
            .eq('id', item.inventario_id)
            .single()

          if (invError || !inv) {
            toast.error(`Error al leer stock del insumo ${item.inventario_id}`)
            setMarcando(null)
            return
          }

          const nuevoStock = Number(inv.stock_actual) + Number(item.cantidad_solicitada)
          const { error: updateError } = await supabase
            .from('inventario')
            .update({ stock_actual: nuevoStock })
            .eq('id', item.inventario_id)

          if (updateError) {
            toast.error('Error al actualizar inventario — OC no marcada como recibida para evitar inconsistencias')
            setMarcando(null)
            return
          }
        }
      }

      const { error: ocError } = await supabase
        .from('ordenes_compra')
        .update({ estado: 'recibida' })
        .eq('id', ocId)

      if (ocError) {
        toast.error('Error al marcar OC como recibida')
        setMarcando(null)
        return
      }

      toast.success('Orden recibida e inventario actualizado')
      setMarcando(null)
      cargarHistorial()
      if (expandida === ocId) setExpandida(null)
    } catch (err: any) {
      toast.error('Error inesperado: ' + (err?.message ?? 'desconocido'))
      setMarcando(null)
    }
  }

  // ── Estilos reutilizables ──────────────────────────────────────────
  const s = { background: 'var(--dark)', minHeight: '100vh', fontFamily: 'inherit' }
  const card: React.CSSProperties = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 0, padding: '1.25rem', marginBottom: '1rem' }
  const inp: React.CSSProperties = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 0, color: 'var(--text)', fontSize: '0.88rem', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }
  const labelStyle: React.CSSProperties = { display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button
            onClick={onVolver}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 0, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            ← Volver
          </button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>
            📦 Órdenes de Compra
          </h1>
        </div>

        {/* Error tabla */}
        {errorTabla && (
          <div style={{ ...card, borderLeft: '4px solid #ef4444', color: '#ef4444' }}>
            <p style={{ fontWeight: 900, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Tabla no encontrada</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              Ejecuta el SQL de órdenes de compra primero en el panel de Supabase.
            </p>
          </div>
        )}

        {!errorTabla && (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 0, padding: '0.25rem' }}>
              {(['nueva', 'historial'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setMsg(null) }}
                  style={{ flex: 1, padding: '0.5rem', background: tab === t ? 'var(--yellow)' : 'transparent', color: tab === t ? '#000' : 'var(--muted)', border: 'none', borderRadius: 0, fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  {t === 'nueva' ? '+ Nueva OC' : 'Historial'}
                </button>
              ))}
            </div>

            {/* Mensaje de estado */}
            {msg && (
              <div style={{ padding: '0.75rem', marginBottom: '1rem', background: msg.tipo === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.tipo === 'ok' ? '#22c55e' : '#ef4444'}`, borderRadius: 0, color: msg.tipo === 'ok' ? '#22c55e' : '#ef4444', fontWeight: 900, fontSize: '0.85rem' }}>
                {msg.text}
              </div>
            )}

            {/* ── TAB NUEVA OC ─────────────────────────────── */}
            {tab === 'nueva' && (
              <>
                {loadingInsumos ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem', fontWeight: 900 }}>Cargando...</div>
                ) : ocGenerada ? (
                  /* OC generada — mostrar acciones */
                  <div style={{ ...card, borderLeft: '4px solid #22c55e' }}>
                    <p style={{ color: '#22c55e', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                      OC Generada #{ocGenerada.id.slice(-8).toUpperCase()}
                    </p>
                    <p style={{ color: 'var(--text)', fontWeight: 700, marginBottom: '0.5rem' }}>
                      Proveedor: {ocGenerada.proveedor.nombre}
                    </p>
                    <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.2rem', marginBottom: '1rem' }}>
                      Total: {fmt(ocGenerada.total)}
                    </p>
                    <div style={{ marginBottom: '1rem' }}>
                      {ocGenerada.items.map(it => (
                        <div key={it.insumo.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                          <span style={{ color: 'var(--text)' }}>{it.insumo.nombre}</span>
                          <span style={{ color: 'var(--muted)' }}>{it.cantidad} {it.insumo.unidad} × ${it.costoUnitario.toFixed(2)}</span>
                          <span style={{ color: 'var(--yellow)', fontWeight: 900 }}>${(it.cantidad * it.costoUnitario).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={imprimirOC}
                        style={{ flex: 1, padding: '0.7rem', background: 'var(--dark)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 0, fontWeight: 900, fontSize: '0.78rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer', minWidth: 140 }}
                      >
                        🖨️ Imprimir OC
                      </button>
                      <button
                        onClick={enviarWhatsApp}
                        style={{ flex: 1, padding: '0.7rem', background: '#25D366', color: '#fff', border: 'none', borderRadius: 0, fontWeight: 900, fontSize: '0.78rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer', minWidth: 140 }}
                      >
                        📱 Enviar WhatsApp
                      </button>
                      <button
                        onClick={() => { setOcGenerada(null); setMsg(null); setSeleccionados({}); cargarDatosNueva() }}
                        style={{ flex: 1, padding: '0.7rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 0, fontWeight: 900, fontSize: '0.78rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer', minWidth: 140 }}
                      >
                        + Nueva OC
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Aviso sin proveedores */}
                    {sinProveedores && (
                      <div style={{ ...card, borderLeft: '4px solid #f59e0b', marginBottom: '1rem' }}>
                        <p style={{ color: '#f59e0b', fontWeight: 900, fontSize: '0.82rem' }}>
                          Sin proveedores activos. Agrega proveedores primero en el panel de administración.
                        </p>
                      </div>
                    )}

                    {/* Sección stock bajo */}
                    <div style={card}>
                      <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                        ⚠️ Insumos con stock bajo ({insumosStockBajo.length})
                      </div>

                      {insumosStockBajo.length === 0 ? (
                        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '1.5rem 0', fontSize: '0.85rem' }}>
                          Todos los insumos tienen stock suficiente ✓
                        </div>
                      ) : (
                        <>
                          {/* Cabecera tabla */}
                          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 80px 80px 80px 100px 100px', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem' }}>
                            {['', 'Insumo', 'Actual', 'Mínimo', 'Déficit', 'Cantidad', 'Costo Unit.'].map((h, i) => (
                              <span key={i} style={{ color: 'var(--muted)', fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{h}</span>
                            ))}
                          </div>

                          {insumosStockBajo.map(insumo => {
                            const sel = seleccionados[insumo.id]
                            const deficit = Math.max(0, Number(insumo.stock_minimo) - Number(insumo.stock_actual))
                            return (
                              <div
                                key={insumo.id}
                                style={{ display: 'grid', gridTemplateColumns: '24px 1fr 80px 80px 80px 100px 100px', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={!!sel}
                                  onChange={() => toggleSeleccion(insumo)}
                                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--yellow)' }}
                                />
                                <div>
                                  <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.82rem' }}>{insumo.nombre}</div>
                                  <div style={{ color: 'var(--muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{insumo.unidad}</div>
                                </div>
                                <span style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.82rem' }}>{Number(insumo.stock_actual)}</span>
                                <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{Number(insumo.stock_minimo)}</span>
                                <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: '0.82rem' }}>+{deficit}</span>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={sel?.cantidad ?? (deficit !== 0 ? deficit : 1)}
                                  onChange={e => updateCantidad(insumo.id, e.target.value)}
                                  disabled={!sel}
                                  style={{ ...inp, padding: '0.35rem 0.5rem', fontSize: '0.8rem', opacity: sel ? 1 : 0.3 }}
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={sel?.costoUnitario ?? Number(insumo.costo_unitario)}
                                  onChange={e => updateCosto(insumo.id, e.target.value)}
                                  disabled={!sel}
                                  style={{ ...inp, padding: '0.35rem 0.5rem', fontSize: '0.8rem', opacity: sel ? 1 : 0.3 }}
                                />
                              </div>
                            )
                          })}

                          {/* Total parcial */}
                          {itemsSeleccionados.length > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.75rem', gap: '1rem', alignItems: 'center' }}>
                              <span style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{itemsSeleccionados.length} item{itemsSeleccionados.length !== 1 ? 's' : ''} seleccionados</span>
                              <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem' }}>{fmt(totalOC)}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Proveedor y notas */}
                    {!sinProveedores && (
                      <div style={{ ...card, borderLeft: '4px solid var(--yellow)' }}>
                        <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Datos de la orden</div>

                        <label style={labelStyle}>Proveedor</label>
                        <select
                          value={proveedorId}
                          onChange={e => setProveedorId(e.target.value)}
                          style={{ ...inp, marginBottom: '1rem' }}
                        >
                          {proveedores.map(p => (
                            <option key={p.id} value={p.id}>{p.nombre}{p.categoria ? ` — ${p.categoria}` : ''}</option>
                          ))}
                        </select>

                        <label style={labelStyle}>Notas (opcional)</label>
                        <textarea
                          value={notas}
                          onChange={e => setNotas(e.target.value)}
                          placeholder="Indicaciones especiales, fecha de entrega esperada..."
                          rows={3}
                          style={{ ...inp, resize: 'vertical', marginBottom: '1rem', fontFamily: 'inherit' }}
                        />

                        <button
                          onClick={generarOC}
                          disabled={guardando || itemsSeleccionados.length === 0}
                          style={{ width: '100%', padding: '0.8rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 0, fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', cursor: guardando || itemsSeleccionados.length === 0 ? 'not-allowed' : 'pointer', opacity: guardando || itemsSeleccionados.length === 0 ? 0.5 : 1 }}
                        >
                          {guardando ? 'Generando...' : `📦 Generar OC — ${fmt(totalOC)}`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── TAB HISTORIAL ────────────────────────────── */}
            {tab === 'historial' && (
              <>
                {loadingHistorial ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem', fontWeight: 900 }}>Cargando...</div>
                ) : historial.length === 0 ? (
                  <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
                    No hay órdenes de compra registradas
                  </div>
                ) : (
                  historial.map(oc => {
                    const prov = (oc.proveedores as any)
                    const isOpen = expandida === oc.id
                    const estadoColor = ESTADO_COLOR[oc.estado] ?? 'var(--muted)'
                    return (
                      <div key={oc.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                        {/* Fila cabecera */}
                        <button
                          onClick={() => cargarItemsOC(oc.id)}
                          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '1rem', alignItems: 'center', textAlign: 'left' }}
                        >
                          <div>
                            <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.88rem' }}>
                              {prov?.nombre ?? 'Proveedor desconocido'}
                            </div>
                            <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '0.2rem' }}>
                              OC #{oc.id.slice(-8).toUpperCase()} · {fmtFecha(oc.created_at)} {fmtHora(oc.created_at)}
                            </div>
                            <div style={{ color: 'var(--muted)', fontSize: '0.65rem', marginTop: '0.1rem' }}>
                              Por: {oc.cajero_nombre}
                            </div>
                          </div>
                          <span style={{ background: `${estadoColor}18`, border: `1px solid ${estadoColor}55`, color: estadoColor, fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', padding: '0.25rem 0.6rem', borderRadius: 0, whiteSpace: 'nowrap' }}>
                            {oc.estado}
                          </span>
                          <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1rem', whiteSpace: 'nowrap' }}>
                            {fmt(oc.total)}
                          </span>
                          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{isOpen ? '▲' : '▼'}</span>
                        </button>

                        {/* Detalle expandible */}
                        {isOpen && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', background: 'var(--dark)' }}>
                            {loadingItems ? (
                              <div style={{ color: 'var(--muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1rem' }}>Cargando items...</div>
                            ) : (
                              <>
                                {/* Tabla items */}
                                <div style={{ marginBottom: '0.75rem' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 90px', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                                    {['Insumo', 'Cantidad', 'Unidad', 'Costo U.', 'Subtotal'].map((h, i) => (
                                      <span key={i} style={{ color: 'var(--muted)', fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{h}</span>
                                    ))}
                                  </div>
                                  {itemsExpandida.map(it => (
                                    <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 90px', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
                                      <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{it.nombre_insumo}</span>
                                      <span style={{ color: 'var(--text)', fontSize: '0.82rem' }}>{it.cantidad_solicitada}</span>
                                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>—</span>
                                      <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>${Number(it.costo_unitario).toFixed(2)}</span>
                                      <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.82rem' }}>${Number(it.subtotal).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>

                                {oc.notas && (
                                  <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                                    <strong style={{ color: 'var(--text)' }}>Notas:</strong> {oc.notas}
                                  </p>
                                )}

                                {/* Acciones */}
                                {oc.estado === 'pendiente' && (
                                  <button
                                    onClick={() => marcarRecibida(oc.id)}
                                    disabled={marcando === oc.id}
                                    style={{ padding: '0.6rem 1.2rem', background: '#22c55e', color: '#000', border: 'none', borderRadius: 0, fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: marcando === oc.id ? 'not-allowed' : 'pointer', opacity: marcando === oc.id ? 0.6 : 1 }}
                                  >
                                    {marcando === oc.id ? 'Actualizando...' : '✓ Marcar como recibida'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
