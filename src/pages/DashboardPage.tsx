import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'

interface Props { cajero: CajeroActivo; onVolver: () => void }

interface KPI {
  ventasHoy: number
  ticketsHoy: number
  ticketPromedio: number
  ventasSemana: number
  productoTop: string
  productoTopVentas: number
  cajeroTop: string
  cajeroTopVentas: number
  mesasOcupadas: number
  mesasTotal: number
  ordenesActivas: number
}

interface OrdenActiva {
  id: string
  mesa_nombre: string
  total: number
  created_at: string
  items_count: number
}

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtMin = (ms: number) => {
  const min = Math.floor(ms / 60000)
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`
}

export default function DashboardPage({ cajero: _cajero, onVolver }: Props) {
  const [kpi, setKpi] = useState<KPI | null>(null)
  const [ordenesActivas, setOrdenesActivas] = useState<OrdenActiva[]>([])
  const [loading, setLoading] = useState(true)
  const [ahora, setAhora] = useState(new Date())
  const [ultimaActualizacion, setUltimaActualizacion] = useState(new Date())

  const cargar = useCallback(async () => {
    try {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const hoyStr = hoy.toISOString()

    const inicioSemana = new Date(hoy)
    inicioSemana.setDate(hoy.getDate() - hoy.getDay())
    const semanaStr = inicioSemana.toISOString()

    const [ventasRes, ordenesRes, mesasRes] = await Promise.all([
      supabase.from('ventas').select('id, total, cajero_nombre, created_at').gte('created_at', hoyStr).eq('estado', 'completada'),
      supabase.from('ordenes').select('id, mesa_nombre, created_at, estado, orden_items(id, precio, cantidad)').eq('estado', 'abierta'),
      supabase.from('mesas').select('id, estado'),
    ])

    if (ventasRes.error || ordenesRes.error || mesasRes.error) {
      toast.error('Error al cargar datos del dashboard')
      setLoading(false)
      return
    }

    const ventas = ventasRes.data ?? []
    const ordenes = ordenesRes.data ?? []
    const mesas = mesasRes.data ?? []

    // Ventas hoy
    const ventasHoy = ventas.reduce((s, v) => s + Number(v.total), 0)
    const ticketsHoy = ventas.length
    const ticketPromedio = ticketsHoy > 0 ? ventasHoy / ticketsHoy : 0

    // Top cajero
    const porCajero: Record<string, number> = {}
    ventas.forEach(v => {
      if (!v.cajero_nombre) return
      porCajero[v.cajero_nombre] = (porCajero[v.cajero_nombre] ?? 0) + Number(v.total)
    })
    const cajeroTop = Object.entries(porCajero).sort((a, b) => b[1] - a[1])[0]

    // Top producto — filtrar por IDs de ventas de hoy (venta_items no tiene created_at)
    const ventaIds = ventas.map((v: { id: string }) => v.id)
    const porProducto: Record<string, number> = {}
    if (ventaIds.length > 0) {
      const { data: detalleData, error: detalleErr } = await supabase
        .from('venta_items')
        .select('nombre, subtotal')
        .in('venta_id', ventaIds)
      if (!detalleErr) {
        ;(detalleData ?? []).forEach((d: { nombre: string; subtotal: number }) => {
          porProducto[d.nombre] = (porProducto[d.nombre] ?? 0) + Number(d.subtotal)
        })
      }
    }
    const productoTop = Object.entries(porProducto).sort((a, b) => b[1] - a[1])[0]

    // Ventas semana
    const { data: ventasSemanaData, error: semanaErr } = await supabase.from('ventas').select('total').gte('created_at', semanaStr).eq('estado', 'completada')
    const ventasSemana = semanaErr ? 0 : (ventasSemanaData ?? []).reduce((s, v) => s + Number(v.total ?? 0), 0)

    // Mesas
    const mesasOcupadas = mesas.filter(m => m.estado === 'ocupada').length

    setKpi({
      ventasHoy,
      ticketsHoy,
      ticketPromedio,
      ventasSemana,
      productoTop: productoTop?.[0] ?? '—',
      productoTopVentas: productoTop?.[1] ?? 0,
      cajeroTop: cajeroTop?.[0] ?? '—',
      cajeroTopVentas: cajeroTop?.[1] ?? 0,
      mesasOcupadas,
      mesasTotal: mesas.length,
      ordenesActivas: ordenes.length,
    })

    setOrdenesActivas(
      ordenes.map(o => {
        const items = Array.isArray((o as any).orden_items) ? (o as any).orden_items : []
        const total = items.reduce((s: number, it: { precio: number; cantidad: number }) => s + Number(it.precio ?? 0) * Number(it.cantidad ?? 0), 0)
        return { id: o.id, mesa_nombre: o.mesa_nombre, total, created_at: o.created_at, items_count: items.length }
      })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(0, 8)
    )

    setUltimaActualizacion(new Date())
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const interval = setInterval(() => {
      cargar()
      setAhora(new Date())
    }, 30000)
    const clockInterval = setInterval(() => setAhora(new Date()), 1000)
    return () => { clearInterval(interval); clearInterval(clockInterval) }
  }, [cargar])

  const s = { background: 'var(--dark)', minHeight: '100vh' }

  const KPICard = ({ label, value, sub, color = 'var(--text)', accent = false }: { label: string; value: string; sub?: string; color?: string; accent?: boolean }) => (
    <div style={{ background: accent ? 'rgba(240,168,0,0.07)' : 'var(--charcoal)', border: `1px solid ${accent ? 'rgba(240,168,0,0.3)' : 'var(--border)'}`, borderRadius: 2, padding: '1rem 1.25rem', flex: '1 1 180px', minWidth: 140 }}>
      <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.55rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: 'var(--muted)', fontWeight: 700, fontSize: '0.65rem', marginTop: '0.3rem' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={s}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>📊 Dashboard en Vivo</h1>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem', fontVariantNumeric: 'tabular-nums' }}>
              {ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '4rem', fontWeight: 900 }}>Cargando datos...</div>
        ) : kpi ? (
          <>
            {/* KPIs Row 1 - Ventas */}
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Ventas</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <KPICard label="Ventas hoy" value={fmt(kpi.ventasHoy)} accent color="var(--yellow)" />
                <KPICard label="Tickets hoy" value={String(kpi.ticketsHoy)} sub="transacciones" />
                <KPICard label="Ticket promedio" value={fmt(kpi.ticketPromedio)} />
                <KPICard label="Ventas semana" value={fmt(kpi.ventasSemana)} sub="últimos 7 días" color="#a855f7" />
              </div>
            </div>

            {/* KPIs Row 2 - Operaciones */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.5rem', marginTop: '1rem' }}>Operaciones</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <KPICard label="Mesas ocupadas" value={`${kpi.mesasOcupadas}/${kpi.mesasTotal}`} color={kpi.mesasOcupadas > 0 ? '#22c55e' : 'var(--muted)'} />
                <KPICard label="Órdenes abiertas" value={String(kpi.ordenesActivas)} color={kpi.ordenesActivas > 0 ? '#f59e0b' : 'var(--muted)'} />
                <KPICard label="Top producto" value={kpi.productoTop} sub={kpi.productoTopVentas > 0 ? fmt(kpi.productoTopVentas) : undefined} color="var(--yellow)" />
                <KPICard label="Top cajero" value={kpi.cajeroTop.split(' ')[0]} sub={kpi.cajeroTopVentas > 0 ? fmt(kpi.cajeroTopVentas) : undefined} color="#22c55e" />
              </div>
            </div>

            {/* Órdenes activas */}
            {ordenesActivas.length > 0 && (
              <div>
                <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Órdenes activas ({ordenesActivas.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
                  {ordenesActivas.map(o => {
                    const elapsed = ahora.getTime() - new Date(o.created_at).getTime()
                    const urgent = elapsed > 20 * 60000
                    return (
                      <div key={o.id} style={{ background: urgent ? 'rgba(239,68,68,0.08)' : 'var(--charcoal)', border: `1px solid ${urgent ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, borderRadius: 2, padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.85rem' }}>{o.mesa_nombre}</span>
                          <span style={{ color: urgent ? '#ef4444' : 'var(--muted)', fontWeight: 900, fontSize: '0.65rem' }}>{fmtMin(elapsed)}</span>
                        </div>
                        <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.9rem', marginTop: '0.25rem' }}>{fmt(o.total)}</div>
                        {urgent && <div style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.25rem' }}>⚠ Tiempo largo</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: '2rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', textAlign: 'center', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Actualización automática cada 30s · Última: {ultimaActualizacion.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
