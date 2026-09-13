import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

interface Props {
  clienteId: string
  clienteNombre: string
  onClose: () => void
}

interface VentaHistorial {
  id: string
  created_at: string
  mesa_nombre: string | null
  total: number
  metodo_pago: string
  items?: VentaItemHistorial[]
  expandida?: boolean
}

interface VentaItemHistorial {
  id: string
  nombre: string
  emoji: string
  cantidad: number
  precio: number
  subtotal: number
}

interface Stats {
  totalVisitas: number
  totalGastado: number
  productoFavorito: string | null
}

export default function ClienteHistorialModal({ clienteId, clienteNombre, onClose }: Props) {
  const [ventas, setVentas] = useState<VentaHistorial[]>([])
  const [stats, setStats] = useState<Stats>({ totalVisitas: 0, totalGastado: 0, productoFavorito: null })
  const [cargando, setCargando] = useState(true)
  const [ventasExpandidas, setVentasExpandidas] = useState<Set<string>>(new Set())
  const [itemsPorVenta, setItemsPorVenta] = useState<Record<string, VentaItemHistorial[]>>({})
  const [cargandoItems, setCargandoItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    cargarHistorial()
  }, [clienteId])

  async function cargarHistorial() {
    setCargando(true)
    try {
      // Fetch últimas 10 ventas
      const { data: ventasData, error: ventasError } = await supabase
        .from('ventas')
        .select('id, created_at, mesa_nombre, total, metodo_pago')
        .eq('usuario_id', clienteId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (ventasError || !ventasData) {
        setCargando(false)
        return
      }

      setVentas(ventasData as VentaHistorial[])

      // Stats: total visitas y total gastado (todas las ventas, no solo las últimas 10)
      const { data: statsData, error: statsError } = await supabase
        .from('ventas')
        .select('total')
        .eq('usuario_id', clienteId)

      if (statsError) { console.error('Error al cargar stats:', statsError.message); return }

      const totalVisitas = statsData?.length ?? 0
      const totalGastado = statsData?.reduce((s, v) => s + (v.total ?? 0), 0) ?? 0

      // Producto favorito: item más pedido (qty total)
      let productoFavorito: string | null = null
      try {
        const { data: itemsAll } = await supabase
          .from('venta_items')
          .select('nombre, emoji, cantidad, venta_id, ventas!inner(usuario_id)')
          .eq('ventas.usuario_id', clienteId)

        if (itemsAll && itemsAll.length > 0) {
          const conteo: Record<string, { nombre: string; emoji: string; total: number }> = {}
          for (const item of itemsAll) {
            const key = item.nombre
            if (!conteo[key]) conteo[key] = { nombre: item.nombre, emoji: item.emoji ?? '', total: 0 }
            conteo[key].total += item.cantidad ?? 1
          }
          const top = Object.values(conteo).sort((a, b) => b.total - a.total)[0]
          if (top) productoFavorito = `${top.emoji} ${top.nombre}`
        }
      } catch {
        // silencioso
      }

      setStats({ totalVisitas, totalGastado, productoFavorito })
    } catch {
      // silencioso
    } finally {
      setCargando(false)
    }
  }

  async function toggleVenta(ventaId: string) {
    const nuevasExpandidas = new Set(ventasExpandidas)
    if (nuevasExpandidas.has(ventaId)) {
      nuevasExpandidas.delete(ventaId)
      setVentasExpandidas(nuevasExpandidas)
      return
    }
    nuevasExpandidas.add(ventaId)
    setVentasExpandidas(nuevasExpandidas)

    // Si ya tenemos los items, no refetchar
    if (itemsPorVenta[ventaId]) return

    setCargandoItems(prev => new Set(prev).add(ventaId))
    try {
      const { data, error } = await supabase
        .from('venta_items')
        .select('id, nombre, emoji, cantidad, precio, subtotal')
        .eq('venta_id', ventaId)

      if (error) return
      if (data) {
        setItemsPorVenta(prev => ({ ...prev, [ventaId]: data as VentaItemHistorial[] }))
      }
    } catch {
      // silencioso
    } finally {
      setCargandoItems(prev => {
        const next = new Set(prev)
        next.delete(ventaId)
        return next
      })
    }
  }

  function formatFecha(iso: string) {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  function labelMetodo(metodo: string) {
    if (metodo === 'efectivo') return '💵'
    if (metodo === 'tarjeta') return '💳'
    if (metodo === 'mixto') return '💵+💳'
    return metodo
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-slide-up"
        style={{
          background: 'var(--charcoal)',
          border: '1px solid var(--border)',
          borderTop: '3px solid var(--yellow)',
          maxHeight: '88dvh',
          overflowY: 'auto',
          borderRadius: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--dark)',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <div>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
              // Historial
            </p>
            <p className="font-black text-base" style={{ color: 'var(--text)' }}>
              📋 {clienteNombre}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl transition-colors"
            style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            ✕
          </button>
        </div>

        {cargando ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <span className="text-3xl animate-gear inline-block">⚙️</span>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
              Cargando historial...
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0">

            {/* Stats */}
            <div
              className="grid grid-cols-3 divide-x"
              style={{ borderBottom: '1px solid var(--border)', borderColor: 'var(--border)' }}
            >
              <div className="px-3 py-4 text-center">
                <p className="font-black text-2xl" style={{ color: 'var(--yellow)' }}>
                  {stats.totalVisitas}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Visitas</p>
              </div>
              <div className="px-3 py-4 text-center">
                <p className="font-black text-xl" style={{ color: '#22c55e' }}>
                  ${stats.totalGastado.toFixed(0)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Total gastado</p>
              </div>
              <div className="px-3 py-4 text-center">
                {stats.productoFavorito ? (
                  <>
                    <p className="font-black text-sm leading-tight" style={{ color: 'var(--text)' }}>
                      {stats.productoFavorito}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Favorito</p>
                  </>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Sin datos</p>
                )}
              </div>
            </div>

            {/* Lista de ventas */}
            {ventas.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-2xl mb-2">📭</p>
                <p className="text-sm font-black" style={{ color: 'var(--muted)' }}>
                  Sin ventas registradas
                </p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {ventas.map(venta => {
                  const expandida = ventasExpandidas.has(venta.id)
                  const items = itemsPorVenta[venta.id] ?? []
                  const cargandoEsta = cargandoItems.has(venta.id)

                  return (
                    <div key={venta.id}>
                      {/* Fila principal */}
                      <button
                        onClick={() => toggleVenta(venta.id)}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-all"
                        style={{
                          background: expandida ? 'rgba(240,168,0,0.04)' : 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          borderRadius: 0,
                        }}
                        onMouseEnter={e => !expandida && (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={e => !expandida && (e.currentTarget.style.background = 'transparent')}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-sm" style={{ color: 'var(--text)' }}>
                              {labelMetodo(venta.metodo_pago)} ${venta.total.toFixed(2)}
                            </span>
                            {venta.mesa_nombre && (
                              <span
                                className="text-xs px-1.5 py-0.5 font-black"
                                style={{
                                  background: 'rgba(240,168,0,0.1)',
                                  border: '1px solid rgba(240,168,0,0.25)',
                                  color: 'var(--yellow)',
                                  borderRadius: 0,
                                }}
                              >
                                {venta.mesa_nombre}
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                            {formatFecha(venta.created_at)}
                          </p>
                        </div>
                        <span
                          className="text-sm shrink-0 transition-transform"
                          style={{
                            color: 'var(--muted)',
                            transform: expandida ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}
                        >
                          ▶
                        </span>
                      </button>

                      {/* Items expandidos */}
                      {expandida && (
                        <div
                          className="px-5 pb-3"
                          style={{ background: 'rgba(240,168,0,0.03)', borderTop: '1px solid rgba(240,168,0,0.12)' }}
                        >
                          {cargandoEsta ? (
                            <p className="text-xs py-3 text-center" style={{ color: 'var(--muted)' }}>
                              Cargando items...
                            </p>
                          ) : items.length === 0 ? (
                            <p className="text-xs py-3 text-center" style={{ color: 'var(--muted)' }}>
                              Sin detalle disponible
                            </p>
                          ) : (
                            <div className="space-y-1 pt-2">
                              {items.map(item => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span style={{ color: 'var(--muted)' }}>
                                    {item.emoji} {item.nombre} ×{item.cantidad}
                                  </span>
                                  <span className="font-black" style={{ color: 'var(--text)' }}>
                                    ${(item.subtotal ?? item.precio * item.cantidad).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
