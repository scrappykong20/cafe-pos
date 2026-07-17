import React, { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'
import DevolucionModal from '../components/DevolucionModal'

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes'
type Metodo = 'todos' | 'efectivo' | 'tarjeta' | 'mixto'

interface Venta {
  id: string
  total: number
  metodo_pago: string
  cajero_nombre: string
  mesa_nombre: string
  engranajes_ganados: number
  estado: string
  created_at: string
  descuento: number
  subtotal: number
  efectivo_recibido: number
  cambio: number
  devuelta?: boolean
}

interface Devolucion {
  id: string
  venta_id: string
  cajero_nombre: string
  motivo: string
  monto: number
  metodo_devolucion: string
  created_at: string
}

interface VentaItem {
  id: string
  venta_id: string
  nombre: string
  emoji: string
  precio: number
  cantidad: number
  subtotal: number
}

function getRango(p: Periodo): { desde: string; hasta: string } {
  const ahora = new Date()
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  switch (p) {
    case 'hoy':
      return { desde: hoy.toISOString(), hasta: new Date(hoy.getTime() + 86400000).toISOString() }
    case 'ayer': {
      const ayer = new Date(hoy.getTime() - 86400000)
      return { desde: ayer.toISOString(), hasta: hoy.toISOString() }
    }
    case 'semana': {
      const inicioSemana = new Date(hoy.getTime() - hoy.getDay() * 86400000)
      return { desde: inicioSemana.toISOString(), hasta: new Date(hoy.getTime() + 86400000).toISOString() }
    }
    case 'mes': {
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
      return { desde: inicioMes.toISOString(), hasta: new Date(hoy.getTime() + 86400000).toISOString() }
    }
  }
}

function fmt(n: number) {
  return '$' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtHora(dateStr: string) {
  const d = new Date(dateStr)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function fmtFecha(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

function metodoBadge(metodo: string): string {
  switch ((metodo ?? '').toLowerCase()) {
    case 'tarjeta': return '💳'
    case 'mixto': return '💵+💳'
    default: return '💵'
  }
}

function metodoLabel(metodo: string): string {
  switch ((metodo ?? '').toLowerCase()) {
    case 'tarjeta': return 'TARJETA'
    case 'mixto': return 'MIXTO'
    default: return 'EFECTIVO'
  }
}

export default function HistorialPage({ cajero: _cajero, onVolver }: Props) {
  const cajero = _cajero
  const [ventas, setVentas] = useState<Venta[]>([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const [metodo, setMetodo] = useState<Metodo>('todos')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itemsCache, setItemsCache] = useState<Record<string, VentaItem[]>>({})
  const [loadingItems, setLoadingItems] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Devoluciones
  const [ventaParaDevolver, setVentaParaDevolver] = useState<Venta | null>(null)
  const [devolucionesCache, setDevolucionesCache] = useState<Record<string, Devolucion[]>>({})

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const cargarVentas = useCallback(async () => {
    setLoading(true)
    const { desde, hasta } = getRango(periodo)

    let query = supabase
      .from('ventas')
      .select('id, total, metodo_pago, cajero_nombre, mesa_nombre, engranajes_ganados, estado, created_at, descuento, subtotal, efectivo_recibido, cambio, devuelta')
      .eq('estado', 'completada')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at', { ascending: false })
      .limit(100)

    if (metodo !== 'todos') {
      query = query.eq('metodo_pago', metodo)
    }

    const { data, error } = await query
    if (error) {
      toast.error('Error al cargar historial de ventas')
    }
    setVentas(data ?? [])
    setLoading(false)
  }, [periodo, metodo])

  useEffect(() => {
    cargarVentas()
  }, [cargarVentas])

  async function expandVenta(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)

    // Cargar items si no están en caché
    if (!itemsCache[id]) {
      setLoadingItems(id)
      const { data, error } = await supabase
        .from('venta_items')
        .select('id, venta_id, nombre, emoji, precio, cantidad, subtotal')
        .eq('venta_id', id)
      if (error) {
        toast.error('Error al cargar detalle de la venta')
      }
      setItemsCache(prev => ({ ...prev, [id]: data ?? [] }))
      setLoadingItems(null)
    }

    // Cargar devoluciones si no están en caché
    if (!devolucionesCache[id]) {
      try {
        const { data: devData } = await supabase
          .from('devoluciones')
          .select('id, venta_id, cajero_nombre, motivo, monto, metodo_devolucion, created_at')
          .eq('venta_id', id)
          .order('created_at', { ascending: false })
        setDevolucionesCache(prev => ({ ...prev, [id]: devData ?? [] }))
      } catch (_e) {
        // silencioso
      }
    }
  }

  // Client-side search filter
  const filtered = ventas.filter(v => {
    if (!debouncedSearch) return true
    const s = debouncedSearch.toLowerCase()
    return (
      (v.mesa_nombre ?? '').toLowerCase().includes(s) ||
      (v.cajero_nombre ?? '').toLowerCase().includes(s)
    )
  })

  const totalRecaudado = filtered.reduce((s, v) => s + (v.total ?? 0), 0)
  const avgTicket = filtered.length > 0 ? totalRecaudado / filtered.length : 0

  const periodos: { key: Periodo; label: string }[] = [
    { key: 'hoy', label: 'HOY' },
    { key: 'ayer', label: 'AYER' },
    { key: 'semana', label: 'ESTA SEMANA' },
    { key: 'mes', label: 'ESTE MES' },
  ]

  const metodos: { key: Metodo; label: string }[] = [
    { key: 'todos', label: 'TODOS' },
    { key: 'efectivo', label: 'EFECTIVO' },
    { key: 'tarjeta', label: 'TARJETA' },
    { key: 'mixto', label: 'MIXTO' },
  ]

  return (
    <div style={styles.root}>
      {/* HEADER */}
      <header style={styles.header}>
        <button onClick={onVolver} style={styles.backBtn}>
          ← VOLVER
        </button>
        <div style={styles.headerCenter}>
          <span style={styles.headerIcon}>📋</span>
          <h1 style={styles.headerTitle}>HISTORIAL DE VENTAS</h1>
        </div>
        <div style={{ width: 100 }} />
      </header>

      {/* FILTERS BAR */}
      <div style={styles.filtersBar}>
        {/* Search */}
        <div style={styles.searchWrap}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="BUSCAR MESA O CAJERO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          {search && (
            <button onClick={() => setSearch('')} style={styles.clearBtn}>✕</button>
          )}
        </div>

        {/* Period tabs */}
        <div style={styles.filterGroup}>
          <div style={styles.filterGroupLabel}>PERIODO</div>
          <div style={styles.filterTabs}>
            {periodos.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriodo(p.key)}
                style={{
                  ...styles.filterTab,
                  ...(periodo === p.key ? styles.filterTabActive : {}),
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Method filter */}
        <div style={styles.filterGroup}>
          <div style={styles.filterGroupLabel}>MÉTODO</div>
          <div style={styles.filterTabs}>
            {metodos.map(m => (
              <button
                key={m.key}
                onClick={() => setMetodo(m.key)}
                style={{
                  ...styles.filterTab,
                  ...(metodo === m.key ? styles.filterTabActive : {}),
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Count badge */}
        <div style={styles.countBadge}>
          <span style={styles.countNum}>{filtered.length}</span>
          <span style={styles.countLabel}>RESULTADO{filtered.length !== 1 ? 'S' : ''}</span>
        </div>
      </div>

      {/* MAIN SCROLL AREA */}
      <main style={styles.main}>
        {loading ? (
          <div style={styles.loadingWrap}>
            <div style={styles.spinnerEmoji}>⚙️</div>
            <p style={styles.loadingText}>CARGANDO HISTORIAL...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.emptyWrap}>
            <div style={styles.emptyIcon}>📋</div>
            <div style={styles.emptyTitle}>SIN VENTAS</div>
            <div style={styles.emptySubtitle}>
              {search ? `NO SE ENCONTRARON RESULTADOS PARA "${search.toUpperCase()}"` : 'NO HAY VENTAS EN ESTE PERIODO'}
            </div>
          </div>
        ) : (
          <div style={styles.listWrap}>
            {filtered.map((venta, idx) => {
              const isExpanded = expandedId === venta.id
              const isLoadingThis = loadingItems === venta.id
              const items = itemsCache[venta.id] ?? []

              return (
                <div
                  key={venta.id}
                  style={{
                    ...styles.ventaCard,
                    ...(isExpanded ? styles.ventaCardExpanded : {}),
                    borderTop: idx === 0 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {/* MAIN ROW */}
                  <div
                    style={styles.ventaRow}
                    onClick={() => expandVenta(venta.id)}
                  >
                    {/* LEFT */}
                    <div style={styles.ventaLeft}>
                      <div style={styles.ventaMesa}>{venta.mesa_nombre ?? '—'}</div>
                      <div style={styles.ventaCajero}>{venta.cajero_nombre ?? '—'}</div>
                      <div style={styles.ventaHora}>
                        <span style={styles.ventaFecha}>{fmtFecha(venta.created_at)}</span>
                        <span style={styles.ventaHoraSep}>·</span>
                        {fmtHora(venta.created_at)}
                      </div>
                    </div>

                    {/* CENTER */}
                    <div style={styles.ventaCenter}>
                      <div style={styles.metodoPill}>
                        <span style={styles.metodoEmoji}>{metodoBadge(venta.metodo_pago)}</span>
                        <span style={styles.metodoText}>{metodoLabel(venta.metodo_pago)}</span>
                      </div>
                      {(venta.engranajes_ganados ?? 0) > 0 && (
                        <div style={styles.engranajesBadge}>
                          ⚙️ +{venta.engranajes_ganados}
                        </div>
                      )}
                    </div>

                    {/* RIGHT */}
                    <div style={styles.ventaRight}>
                      <div style={styles.ventaTotal}>{fmt(venta.total)}</div>
                      {(venta.descuento ?? 0) > 0 && (
                        <div style={styles.ventaDescuento}>-{fmt(venta.descuento)}</div>
                      )}
                      <div style={styles.expandArrow}>{isExpanded ? '▲' : '▼'}</div>
                    </div>
                  </div>

                  {/* EXPANDED ITEMS */}
                  {isExpanded && (
                    <div style={styles.itemsPanel}>
                      <div style={styles.itemsPanelLabel}>DETALLE DE LA ORDEN</div>
                      {isLoadingThis ? (
                        <div style={styles.itemsLoading}>CARGANDO ITEMS...</div>
                      ) : items.length === 0 ? (
                        <div style={styles.itemsEmpty}>SIN ITEMS REGISTRADOS</div>
                      ) : (
                        <div style={styles.itemsList}>
                          {items.map((item) => (
                            <div key={item.id} style={styles.itemRow}>
                              <span style={styles.itemEmoji}>{item.emoji ?? '🍽️'}</span>
                              <span style={styles.itemNombre}>{item.nombre}</span>
                              <span style={styles.itemCant}>×{item.cantidad}</span>
                              <span style={styles.itemSubtotal}>{fmt(item.subtotal)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Extra info row */}
                      {!isLoadingThis && (
                        <div style={styles.itemsFooter}>
                          {(venta.descuento ?? 0) > 0 && (
                            <div style={styles.itemsFooterRow}>
                              <span style={styles.itemsFooterLabel}>DESCUENTO</span>
                              <span style={styles.itemsFooterVal}>-{fmt(venta.descuento)}</span>
                            </div>
                          )}
                          {venta.metodo_pago === 'efectivo' || venta.metodo_pago === 'mixto' ? (
                            <>
                              {(venta.efectivo_recibido ?? 0) > 0 && (
                                <div style={styles.itemsFooterRow}>
                                  <span style={styles.itemsFooterLabel}>EFECTIVO RECIBIDO</span>
                                  <span style={styles.itemsFooterVal}>{fmt(venta.efectivo_recibido)}</span>
                                </div>
                              )}
                              {(venta.cambio ?? 0) > 0 && (
                                <div style={styles.itemsFooterRow}>
                                  <span style={styles.itemsFooterLabel}>CAMBIO</span>
                                  <span style={styles.itemsFooterVal}>{fmt(venta.cambio)}</span>
                                </div>
                              )}
                            </>
                          ) : null}
                          <div style={{ ...styles.itemsFooterRow, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                            <span style={{ ...styles.itemsFooterLabel, color: 'var(--yellow)' }}>TOTAL</span>
                            <span style={{ ...styles.itemsFooterVal, color: 'var(--yellow)', fontSize: 15 }}>{fmt(venta.total)}</span>
                          </div>
                        </div>
                      )}

                      {/* SECCIÓN DEVOLUCIÓN */}
                      {!isLoadingThis && (() => {
                        const devoluciones = devolucionesCache[venta.id] ?? []
                        return (
                          <>
                            {venta.devuelta === true && devoluciones.length > 0 && (
                              <div style={styles.devolucionPanel}>
                                <div style={styles.devolucionPanelLabel}>↩ DEVOLUCIÓN REGISTRADA</div>
                                {devoluciones.map(dev => (
                                  <div key={dev.id} style={styles.devolucionInfo}>
                                    <div style={styles.itemsFooterRow}>
                                      <span style={styles.itemsFooterLabel}>MOTIVO</span>
                                      <span style={{ ...styles.itemsFooterVal, color: '#F87171', textTransform: 'uppercase', fontSize: 10 }}>{dev.motivo}</span>
                                    </div>
                                    <div style={styles.itemsFooterRow}>
                                      <span style={styles.itemsFooterLabel}>MONTO DEVUELTO</span>
                                      <span style={{ ...styles.itemsFooterVal, color: '#F87171' }}>{fmt(dev.monto)}</span>
                                    </div>
                                    <div style={styles.itemsFooterRow}>
                                      <span style={styles.itemsFooterLabel}>MÉTODO DEVOL.</span>
                                      <span style={{ ...styles.itemsFooterVal, fontSize: 10, textTransform: 'uppercase' }}>{dev.metodo_devolucion}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* BOTÓN DEVOLVER o BADGE DEVUELTA */}
                            <div style={styles.devolverRow}>
                              {venta.devuelta === true ? (
                                <div style={styles.devueltaBadge}>DEVUELTA</div>
                              ) : (
                                <button
                                  style={styles.devolverBtn}
                                  onClick={e => {
                                    e.stopPropagation()
                                    setVentaParaDevolver(venta)
                                  }}
                                >
                                  ↩ DEVOLVER
                                </button>
                              )}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* MODAL DEVOLUCIÓN */}
      {ventaParaDevolver && (
        <DevolucionModal
          venta={{
            ...ventaParaDevolver,
            items: (itemsCache[ventaParaDevolver.id] ?? []).map(item => ({
              nombre: item.nombre,
              emoji: item.emoji,
              cantidad: item.cantidad,
              precio: item.precio,
              subtotal: item.subtotal,
            })),
          }}
          cajero={{
            id: cajero.id,
            nombre: cajero.nombre,
            last_name: cajero.last_name ?? '',
          }}
          onClose={() => setVentaParaDevolver(null)}
          onCompletado={() => {
            setVentaParaDevolver(null)
            // Limpiar caché de devoluciones para forzar recarga
            setDevolucionesCache({})
            cargarVentas()
          }}
        />
      )}

      {/* SUMMARY FOOTER */}
      {!loading && filtered.length > 0 && (
        <footer style={styles.footer}>
          <div style={styles.footerItem}>
            <div style={styles.footerLabel}>TOTAL DE VENTAS</div>
            <div style={styles.footerValue}>{filtered.length}</div>
          </div>
          <div style={styles.footerDivider} />
          <div style={styles.footerItem}>
            <div style={styles.footerLabel}>RECAUDADO</div>
            <div style={{ ...styles.footerValue, color: 'var(--yellow)' }}>{fmt(totalRecaudado)}</div>
          </div>
          <div style={styles.footerDivider} />
          <div style={styles.footerItem}>
            <div style={styles.footerLabel}>TICKET PROMEDIO</div>
            <div style={styles.footerValue}>{fmt(avgTicket)}</div>
          </div>
        </footer>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--dark)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    overflow: 'hidden',
  },

  // HEADER
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    height: 60,
    background: 'var(--black)',
    borderBottom: '2px solid var(--yellow)',
    flexShrink: 0,
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    padding: '6px 14px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 11,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    width: 100,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    fontSize: 20,
  },
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--yellow)',
    textTransform: 'uppercase',
  },

  // FILTERS BAR
  filtersBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '10px 20px',
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    flexWrap: 'wrap',
    position: 'sticky',
    top: 0,
    zIndex: 20,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    padding: '6px 10px',
    flex: '1 1 220px',
    minWidth: 180,
    maxWidth: 280,
  },
  searchIcon: {
    fontSize: 13,
    flexShrink: 0,
  },
  searchInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text)',
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    flex: 1,
    fontFamily: 'inherit',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 900,
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  filterGroupLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  filterTabs: {
    display: 'flex',
    gap: 0,
  },
  filterTab: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRight: 'none',
    color: 'var(--muted)',
    padding: '5px 10px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
  filterTabActive: {
    background: 'var(--yellow)',
    color: 'var(--black)',
    border: '1px solid var(--yellow)',
    borderRight: 'none',
  },
  countBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    padding: '6px 14px',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  countNum: {
    fontSize: 18,
    fontWeight: 900,
    color: 'var(--yellow)',
    lineHeight: 1.1,
  },
  countLabel: {
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // MAIN
  main: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  // LOADING
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    gap: 16,
  },
  spinnerEmoji: {
    fontSize: 40,
  },
  loadingText: {
    color: 'var(--muted)',
    fontWeight: 900,
    letterSpacing: '0.2em',
    fontSize: 11,
    margin: 0,
  },

  // EMPTY STATE
  emptyWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.3,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  emptySubtitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    opacity: 0.6,
    textAlign: 'center',
    maxWidth: 320,
  },

  // VENTA LIST
  listWrap: {
    display: 'flex',
    flexDirection: 'column',
    padding: '0 0 80px 0',
  },
  ventaCard: {
    background: 'var(--charcoal)',
    borderBottom: '1px solid var(--border)',
    borderLeft: '3px solid transparent',
    transition: 'border-color 0.15s',
  },
  ventaCardExpanded: {
    borderLeft: '3px solid var(--yellow)',
    background: 'rgba(240, 168, 0, 0.03)',
  },
  ventaRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    cursor: 'pointer',
    gap: 16,
    minHeight: 60,
  },

  // LEFT
  ventaLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: '0 0 200px',
    minWidth: 0,
  },
  ventaMesa: {
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.12em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ventaCajero: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ventaHora: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ventaFecha: {
    color: 'var(--muted)',
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  ventaHoraSep: {
    opacity: 0.4,
  },

  // CENTER
  ventaCenter: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  metodoPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    padding: '3px 10px',
  },
  metodoEmoji: {
    fontSize: 12,
  },
  metodoText: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  engranajesBadge: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--yellow)',
    background: 'rgba(240, 168, 0, 0.1)',
    border: '1px solid rgba(240, 168, 0, 0.3)',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },

  // RIGHT
  ventaRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 3,
    flexShrink: 0,
  },
  ventaTotal: {
    fontSize: 16,
    fontWeight: 900,
    color: '#4ADE80',
    letterSpacing: '0.05em',
  },
  ventaDescuento: {
    fontSize: 9,
    fontWeight: 700,
    color: '#F87171',
    letterSpacing: '0.1em',
  },
  expandArrow: {
    fontSize: 8,
    color: 'var(--muted)',
    marginTop: 2,
  },

  // EXPANDED ITEMS PANEL
  itemsPanel: {
    background: 'var(--dark)',
    borderTop: '1px solid var(--border)',
    padding: '14px 20px 16px 24px',
  },
  itemsPanelLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  itemsLoading: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    padding: '8px 0',
  },
  itemsEmpty: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    padding: '8px 0',
    opacity: 0.6,
  },
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 10,
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  itemEmoji: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
    flexShrink: 0,
  },
  itemNombre: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemCant: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
    flexShrink: 0,
    width: 28,
    textAlign: 'center',
  },
  itemSubtotal: {
    fontSize: 11,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
    flexShrink: 0,
    width: 70,
    textAlign: 'right',
  },
  itemsFooter: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px dashed var(--border)',
  },
  itemsFooterRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemsFooterLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  itemsFooterVal: {
    fontSize: 12,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
  },

  // DEVOLUCIÓN
  devolucionPanel: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: '1px dashed #F87171',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  devolucionPanelLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: '#F87171',
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  devolucionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  devolverRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  devolverBtn: {
    background: 'transparent',
    border: '1px solid #F87171',
    color: '#F87171',
    padding: '7px 18px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    fontFamily: 'inherit',
    transition: 'all 0.1s',
  },
  devueltaBadge: {
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid #F87171',
    color: '#F87171',
    padding: '6px 14px',
    fontWeight: 900,
    fontSize: 9,
    letterSpacing: '0.25em',
    textTransform: 'uppercase' as const,
  },

  // FOOTER
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    height: 60,
    background: 'var(--black)',
    borderTop: '2px solid var(--yellow)',
    flexShrink: 0,
    position: 'sticky',
    bottom: 0,
  },
  footerItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '0 32px',
  },
  footerLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  footerValue: {
    fontSize: 16,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
  },
  footerDivider: {
    width: 1,
    height: 32,
    background: 'var(--border)',
  },
}
