import React, { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import { exportarCSV, exportarPDF } from '../services/exportar'

type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes'

interface ResumenVentas {
  total: number
  count: number
  engranajes: number
}

interface VentaPorHora {
  hora: number
  total: number
  count: number
}

interface ProductoTop {
  nombre: string
  emoji: string
  cantidad: number
  total: number
}

interface MetodoPagoStats {
  metodo: string
  count: number
  total: number
}

interface CajeroStats {
  cajero_nombre: string
  count: number
  total: number
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

function getRangoAnterior(p: Periodo): { desde: string; hasta: string } {
  const ahora = new Date()
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  switch (p) {
    case 'hoy': {
      // hoy → compara con ayer
      const ayer = new Date(hoy.getTime() - 86400000)
      return { desde: ayer.toISOString(), hasta: hoy.toISOString() }
    }
    case 'ayer': {
      // ayer → compara con anteayer
      const anteayer = new Date(hoy.getTime() - 2 * 86400000)
      const ayer = new Date(hoy.getTime() - 86400000)
      return { desde: anteayer.toISOString(), hasta: ayer.toISOString() }
    }
    case 'semana': {
      // esta semana → semana pasada
      const inicioEstaSemana = new Date(hoy.getTime() - hoy.getDay() * 86400000)
      const inicioSemanaPasada = new Date(inicioEstaSemana.getTime() - 7 * 86400000)
      return { desde: inicioSemanaPasada.toISOString(), hasta: inicioEstaSemana.toISOString() }
    }
    case 'mes': {
      // este mes → mes pasado
      const inicioEsteMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
      const inicioMesPasado = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)
      return { desde: inicioMesPasado.toISOString(), hasta: inicioEsteMes.toISOString() }
    }
  }
}

function calcularPorcentajeCambio(actual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return ((actual - anterior) / anterior) * 100
}

function fmt(n: number) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtHora(h: number) {
  const suffix = h < 12 ? 'AM' : 'PM'
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${display}${suffix}`
}

export default function ReportesPage({ cajero: _cajero, onVolver }: { cajero: CajeroActivo; onVolver: () => void }) {
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const [loading, setLoading] = useState(true)
  const [resumen, setResumen] = useState<ResumenVentas>({ total: 0, count: 0, engranajes: 0 })
  const [porHora, setPorHora] = useState<VentaPorHora[]>([])
  const [topProductos, setTopProductos] = useState<ProductoTop[]>([])
  const [porMetodo, setPorMetodo] = useState<MetodoPagoStats[]>([])
  const [porCajero, setPorCajero] = useState<CajeroStats[]>([])
  const [hoveredHora, setHoveredHora] = useState<number | null>(null)

  // Comparativa de períodos
  const [compararActivo, setCompararActivo] = useState(false)
  const [resumenAnterior, setResumenAnterior] = useState<ResumenVentas | null>(null)

  // Ventas brutas para exportar CSV
  const [ventasBrutas, setVentasBrutas] = useState<Record<string, unknown>[]>([])

  async function cargarPeriodoAnterior(p: Periodo) {
    try {
      const { desde, hasta } = getRangoAnterior(p)
      const { data: ventas } = await supabase
        .from('ventas')
        .select('total, engranajes_ganados')
        .gte('created_at', desde)
        .lt('created_at', hasta)
        .eq('estado', 'completada')
      const v = ventas ?? []
      const totalSum = v.reduce((s: number, x: { total?: number }) => s + (x.total ?? 0), 0)
      const engranajesSum = v.reduce((s: number, x: { engranajes_ganados?: number }) => s + (x.engranajes_ganados ?? 0), 0)
      setResumenAnterior({ total: totalSum, count: v.length, engranajes: engranajesSum })
    } catch {
      setResumenAnterior(null)
    }
  }

  async function cargarDatos(p: Periodo) {
    setLoading(true)
    const { desde, hasta } = getRango(p)

    const { data: ventas } = await supabase
      .from('ventas')
      .select('id, total, metodo_pago, cajero_nombre, mesa_nombre, engranajes_ganados, created_at')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .eq('estado', 'completada')

    const v = ventas ?? []

    // Guardar ventas brutas para exportación CSV
    setVentasBrutas(v.map(x => ({
      fecha: new Date(x.created_at).toLocaleDateString('es-MX'),
      hora: new Date(x.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      total: x.total ?? 0,
      metodo_pago: x.metodo_pago ?? 'efectivo',
      cajero: x.cajero_nombre ?? '',
      mesa: (x as any).mesa_nombre ?? '',
    })))

    const totalSum = v.reduce((s, x) => s + (x.total ?? 0), 0)
    const engranajesSum = v.reduce((s, x) => s + (x.engranajes_ganados ?? 0), 0)
    setResumen({ total: totalSum, count: v.length, engranajes: engranajesSum })

    const horaMap = new Map<number, { total: number; count: number }>()
    v.forEach(venta => {
      const hora = new Date(venta.created_at).getHours()
      const prev = horaMap.get(hora) ?? { total: 0, count: 0 }
      horaMap.set(hora, { total: prev.total + (venta.total ?? 0), count: prev.count + 1 })
    })
    const horasArray: VentaPorHora[] = []
    for (let h = 6; h <= 22; h++) {
      const d = horaMap.get(h) ?? { total: 0, count: 0 }
      horasArray.push({ hora: h, ...d })
    }
    setPorHora(horasArray)

    const metodoMap = new Map<string, { count: number; total: number }>()
    v.forEach(venta => {
      const m = venta.metodo_pago ?? 'efectivo'
      const prev = metodoMap.get(m) ?? { count: 0, total: 0 }
      metodoMap.set(m, { count: prev.count + 1, total: prev.total + (venta.total ?? 0) })
    })
    setPorMetodo(Array.from(metodoMap.entries()).map(([metodo, stats]) => ({ metodo, ...stats })))

    const cajeroMap = new Map<string, { count: number; total: number }>()
    v.forEach(venta => {
      const c = venta.cajero_nombre ?? 'Desconocido'
      const prev = cajeroMap.get(c) ?? { count: 0, total: 0 }
      cajeroMap.set(c, { count: prev.count + 1, total: prev.total + (venta.total ?? 0) })
    })
    setPorCajero(
      Array.from(cajeroMap.entries())
        .map(([cajero_nombre, stats]) => ({ cajero_nombre, ...stats }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
    )

    const ventaIds = v.map(x => x.id)
    if (ventaIds.length > 0) {
      const { data: items } = await supabase
        .from('venta_items')
        .select('nombre, emoji, cantidad, subtotal')
        .in('venta_id', ventaIds)

      const prodMap = new Map<string, ProductoTop>()
      ;(items ?? []).forEach(item => {
        const prev = prodMap.get(item.nombre) ?? { nombre: item.nombre, emoji: item.emoji ?? '🍽️', cantidad: 0, total: 0 }
        prodMap.set(item.nombre, { ...prev, cantidad: prev.cantidad + (item.cantidad ?? 0), total: prev.total + (item.subtotal ?? 0) })
      })
      setTopProductos(
        Array.from(prodMap.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
      )
    } else {
      setTopProductos([])
    }

    setLoading(false)
  }

  useEffect(() => {
    cargarDatos(periodo)
    setResumenAnterior(null)
  }, [periodo])

  useEffect(() => {
    if (compararActivo) {
      cargarPeriodoAnterior(periodo)
    } else {
      setResumenAnterior(null)
    }
  }, [compararActivo, periodo])

  const maxHora = Math.max(...porHora.map(h => h.total), 1)
  const ticketPromedio = resumen.count > 0 ? resumen.total / resumen.count : 0
  const ticketPromedioAnterior = resumenAnterior && resumenAnterior.count > 0
    ? resumenAnterior.total / resumenAnterior.count
    : null

  // Etiqueta del período de comparación
  const labelComparacion: Record<Periodo, string> = {
    hoy: 'ayer',
    ayer: 'anteayer',
    semana: 'sem. pasada',
    mes: 'mes pasado',
  }

  // Helper: renderiza flecha con porcentaje de cambio
  function renderDelta(actual: number, anterior: number | null | undefined): React.ReactNode {
    if (!compararActivo || resumenAnterior === null || anterior == null) return null
    const pct = calcularPorcentajeCambio(actual, anterior)
    if (pct === null) return null
    const subida = pct >= 0
    return (
      <span style={{
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: '0.08em',
        color: subida ? '#4ade80' : '#f87171',
        marginTop: 2,
      }}>
        {subida ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% vs {labelComparacion[periodo]}
      </span>
    )
  }

  // Función de exportación CSV del período actual
  function handleExportarCSV() {
    const nombreArchivo = `reporte_${periodo}_${new Date().toISOString().slice(0, 10)}`
    exportarCSV(ventasBrutas, nombreArchivo)
  }

  // Función de exportación PDF
  function handleExportarPDF() {
    const titulo = `Reporte — ${periodos.find(p => p.key === periodo)?.label ?? periodo}`

    const kpiHtml = `
      <h2>Resumen del período</h2>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value">${fmt(resumen.total)}</div>
          <div class="kpi-label">Total recaudado</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${resumen.count}</div>
          <div class="kpi-label">Número de ventas</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${fmt(ticketPromedio)}</div>
          <div class="kpi-label">Ticket promedio</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${resumen.engranajes}</div>
          <div class="kpi-label">Engranajes otorgados</div>
        </div>
      </div>`

    const topProductosHtml = topProductos.length === 0 ? '' : `
      <h2>Top 5 productos</h2>
      <table>
        <thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${topProductos.map((p, i) => `
            <tr>
              <td class="rank">#${i + 1}</td>
              <td>${p.emoji} ${p.nombre}</td>
              <td>${p.cantidad} pcs</td>
              <td class="total-cell">${fmt(p.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`

    const topCajerosHtml = porCajero.length === 0 ? '' : `
      <h2>Top 5 cajeros</h2>
      <table>
        <thead><tr><th>#</th><th>Cajero</th><th>Ventas</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${porCajero.map((c, i) => `
            <tr>
              <td class="rank">#${i + 1}</td>
              <td>${c.cajero_nombre}</td>
              <td>${c.count}</td>
              <td class="total-cell">${fmt(c.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`

    exportarPDF(titulo, kpiHtml + topProductosHtml + topCajerosHtml)
  }

  const periodos: { key: Periodo; label: string }[] = [
    { key: 'hoy', label: 'HOY' },
    { key: 'ayer', label: 'AYER' },
    { key: 'semana', label: 'ESTA SEMANA' },
    { key: 'mes', label: 'ESTE MES' },
  ]

  const metodosAll: { key: string; icon: string; label: string }[] = [
    { key: 'efectivo', icon: '💵', label: 'EFECTIVO' },
    { key: 'tarjeta', icon: '💳', label: 'TARJETA' },
    { key: 'mixto', icon: '💵', label: 'MIXTO' },
  ]

  return (
    <div style={styles.root}>
      {/* HEADER */}
      <header style={styles.header}>
        <button onClick={onVolver} style={styles.backBtn}>
          ← VOLVER
        </button>
        <div style={styles.headerCenter}>
          <span style={styles.headerIcon}>📊</span>
          <h1 style={styles.headerTitle}>REPORTES</h1>
        </div>
        <div style={styles.headerActions}>
          {/* Toggle comparar */}
          <button
            onClick={() => setCompararActivo(v => !v)}
            style={{
              ...styles.actionBtn,
              ...(compararActivo ? styles.actionBtnActive : {}),
            }}
            title="Comparar con período anterior"
          >
            {compararActivo ? '⇄ COMPARANDO' : '⇄ COMPARAR'}
          </button>
          {/* Exportar CSV */}
          <button
            onClick={handleExportarCSV}
            style={styles.actionBtn}
            title="Exportar a CSV"
            disabled={ventasBrutas.length === 0}
          >
            📥 CSV
          </button>
          {/* Exportar PDF */}
          <button
            onClick={handleExportarPDF}
            style={styles.actionBtn}
            title="Imprimir / exportar PDF"
          >
            🖨️ PDF
          </button>
        </div>
      </header>

      {/* PERIOD TABS */}
      <div style={styles.tabsBar}>
        {periodos.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodo(p.key)}
            style={{
              ...styles.tabBtn,
              ...(periodo === p.key ? styles.tabBtnActive : {}),
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* MAIN SCROLL AREA */}
      <main style={styles.main}>
        {loading ? (
          <div style={styles.loadingWrap}>
            <div style={styles.spinnerEmoji}>⚙️</div>
            <p style={styles.loadingText}>CARGANDO DATOS...</p>
          </div>
        ) : (
          <div style={styles.content}>

            {/* SUMMARY CARDS */}
            <section style={styles.section}>
              <div style={styles.sectionLabel}>RESUMEN DEL PERIODO</div>
              <div style={styles.statsGrid}>
                <div style={{ ...styles.statCard, ...styles.statCardHighlight }}>
                  <div style={styles.statCardIconRow}>
                    <span style={styles.statIcon}>💰</span>
                  </div>
                  <div style={styles.statValueBig}>{fmt(resumen.total)}</div>
                  <div style={styles.statLabel}>TOTAL RECAUDADO</div>
                  {renderDelta(resumen.total, resumenAnterior?.total)}
                </div>

                <div style={styles.statCard}>
                  <div style={styles.statCardIconRow}>
                    <span style={styles.statIcon}>🧾</span>
                  </div>
                  <div style={styles.statValue}>{resumen.count}</div>
                  <div style={styles.statLabel}>NÚMERO DE VENTAS</div>
                  {renderDelta(resumen.count, resumenAnterior?.count)}
                </div>

                <div style={styles.statCard}>
                  <div style={styles.statCardIconRow}>
                    <span style={styles.statIcon}>📈</span>
                  </div>
                  <div style={styles.statValue}>{fmt(ticketPromedio)}</div>
                  <div style={styles.statLabel}>TICKET PROMEDIO</div>
                  {renderDelta(ticketPromedio, ticketPromedioAnterior)}
                </div>

                <div style={styles.statCard}>
                  <div style={styles.statCardIconRow}>
                    <span style={styles.statIcon}>⚙️</span>
                  </div>
                  <div style={styles.statValue}>{resumen.engranajes}</div>
                  <div style={styles.statLabel}>ENGRANAJES OTORGADOS</div>
                  {renderDelta(resumen.engranajes, resumenAnterior?.engranajes)}
                </div>
              </div>
            </section>

            {/* BAR CHART: VENTAS POR HORA */}
            <section style={styles.section}>
              <div style={styles.sectionLabel}>VENTAS POR HORA</div>
              <div style={styles.chartCard}>
                {porHora.map(h => {
                  const pct = maxHora > 0 ? (h.total / maxHora) * 100 : 0
                  const isHovered = hoveredHora === h.hora
                  const hasData = h.total > 0
                  return (
                    <div
                      key={h.hora}
                      style={styles.chartRow}
                      onMouseEnter={() => setHoveredHora(h.hora)}
                      onMouseLeave={() => setHoveredHora(null)}
                    >
                      <div style={styles.chartHourLabel}>{fmtHora(h.hora)}</div>
                      <div style={styles.chartBarTrack}>
                        <div
                          style={{
                            ...styles.chartBar,
                            width: `${pct}%`,
                            background: hasData
                              ? (isHovered ? '#FFD04D' : 'var(--yellow)')
                              : 'var(--border)',
                            minWidth: hasData ? 4 : 0,
                          }}
                        />
                      </div>
                      <div style={{
                        ...styles.chartAmount,
                        color: hasData ? (isHovered ? 'var(--yellow)' : 'var(--text)') : 'var(--muted)',
                      }}>
                        {hasData ? fmt(h.total) : '—'}
                      </div>
                      {isHovered && hasData && (
                        <div style={styles.chartTooltip}>
                          {h.count} {h.count === 1 ? 'venta' : 'ventas'} · {fmt(h.total)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* BOTTOM GRID */}
            <div style={styles.bottomGrid}>

              {/* TOP PRODUCTOS */}
              <section style={styles.section}>
                <div style={styles.sectionLabel}>TOP 5 PRODUCTOS</div>
                <div style={styles.listCard}>
                  {topProductos.length === 0 ? (
                    <div style={styles.emptyState}>SIN DATOS</div>
                  ) : (
                    topProductos.map((p, i) => (
                      <div key={p.nombre} style={{
                        ...styles.listRow,
                        borderBottom: i < topProductos.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <div style={styles.listRank}>#{i + 1}</div>
                        <div style={styles.listEmoji}>{p.emoji}</div>
                        <div style={styles.listInfo}>
                          <div style={styles.listName}>{p.nombre}</div>
                          <div style={styles.listSub}>{p.cantidad} pcs</div>
                        </div>
                        <div style={styles.listTotal}>{fmt(p.total)}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* TOP CAJEROS */}
              <section style={styles.section}>
                <div style={styles.sectionLabel}>TOP 5 CAJEROS</div>
                <div style={styles.listCard}>
                  {porCajero.length === 0 ? (
                    <div style={styles.emptyState}>SIN DATOS</div>
                  ) : (
                    porCajero.map((c, i) => (
                      <div key={c.cajero_nombre} style={{
                        ...styles.listRow,
                        borderBottom: i < porCajero.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <div style={styles.listRank}>#{i + 1}</div>
                        <div style={styles.listEmoji}>👤</div>
                        <div style={styles.listInfo}>
                          <div style={styles.listName}>{c.cajero_nombre}</div>
                          <div style={styles.listSub}>{c.count} ventas</div>
                        </div>
                        <div style={styles.listTotal}>{fmt(c.total)}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* METODOS DE PAGO */}
            <section style={styles.section}>
              <div style={styles.sectionLabel}>MÉTODOS DE PAGO</div>
              <div style={styles.metodosGrid}>
                {metodosAll.map(m => {
                  const stats = porMetodo.find(x => x.metodo === m.key)
                  const count = stats?.count ?? 0
                  const total = stats?.total ?? 0
                  return (
                    <div key={m.key} style={{
                      ...styles.metodoCard,
                      ...(count > 0 ? styles.metodoCardActive : {}),
                    }}>
                      <div style={styles.metodoIcon}>
                        {m.key === 'mixto' ? '💵+💳' : m.icon}
                      </div>
                      <div style={styles.metodoLabel}>{m.label}</div>
                      <div style={{
                        ...styles.metodoTotal,
                        color: count > 0 ? 'var(--yellow)' : 'var(--muted)',
                      }}>
                        {fmt(total)}
                      </div>
                      <div style={styles.metodoCount}>
                        {count} {count === 1 ? 'VENTA' : 'VENTAS'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

          </div>
        )}
      </main>
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
    borderRadius: 2,
    transition: 'all 0.15s',
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
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    borderRadius: 2,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  actionBtnActive: {
    border: '1px solid var(--yellow)',
    color: 'var(--yellow)',
    background: 'rgba(240, 168, 0, 0.08)',
  },

  // TABS
  tabsBar: {
    display: 'flex',
    gap: 0,
    background: 'var(--black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    padding: '0 20px',
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    color: 'var(--muted)',
    padding: '12px 18px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    transition: 'all 0.15s',
    marginBottom: -1,
  },
  tabBtnActive: {
    color: 'var(--yellow)',
    borderBottom: '3px solid var(--yellow)',
  },

  // MAIN
  main: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  content: {
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
    maxWidth: 1000,
    margin: '0 auto',
  },

  // LOADING
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    gap: 16,
  },
  spinnerEmoji: {
    fontSize: 48,
    animation: 'spin 1.5s linear infinite',
  },
  loadingText: {
    color: 'var(--muted)',
    fontWeight: 900,
    letterSpacing: '0.2em',
    fontSize: 12,
    margin: 0,
  },

  // SECTION
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    paddingLeft: 2,
  },

  // STATS GRID
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  },
  statCard: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  statCardHighlight: {
    border: '1px solid var(--yellow)',
    background: 'rgba(240, 168, 0, 0.06)',
  },
  statCardIconRow: {
    display: 'flex',
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 20,
  },
  statValueBig: {
    fontSize: 26,
    fontWeight: 900,
    color: 'var(--yellow)',
    letterSpacing: '0.05em',
    lineHeight: 1.1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 900,
    color: 'var(--text)',
    letterSpacing: '0.05em',
    lineHeight: 1.1,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // BAR CHART
  chartCard: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  chartRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
    cursor: 'default',
  },
  chartHourLabel: {
    width: 38,
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
    textAlign: 'right',
    flexShrink: 0,
  },
  chartBarTrack: {
    flex: 1,
    height: 8,
    background: 'var(--dark)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  chartBar: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease, background 0.15s',
  },
  chartAmount: {
    width: 74,
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.08em',
    textAlign: 'right',
    flexShrink: 0,
  },
  chartTooltip: {
    position: 'absolute',
    right: 80,
    top: -28,
    background: 'var(--black)',
    border: '1px solid var(--yellow)',
    color: 'var(--yellow)',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.1em',
    padding: '4px 10px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
    zIndex: 10,
    pointerEvents: 'none',
  },

  // BOTTOM GRID
  bottomGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },

  // LIST CARD
  listCard: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    transition: 'background 0.15s',
  },
  listRank: {
    fontSize: 10,
    fontWeight: 900,
    color: 'var(--yellow)',
    letterSpacing: '0.1em',
    width: 24,
    flexShrink: 0,
  },
  listEmoji: {
    fontSize: 18,
    flexShrink: 0,
    width: 26,
    textAlign: 'center',
  },
  listInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  listName: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  listSub: {
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--muted)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  listTotal: {
    fontSize: 12,
    fontWeight: 900,
    color: 'var(--yellow)',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  emptyState: {
    padding: '24px 16px',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
  },

  // METODOS
  metodosGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  metodoCard: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
  },
  metodoCardActive: {
    border: '1px solid rgba(240, 168, 0, 0.4)',
    background: 'rgba(240, 168, 0, 0.04)',
  },
  metodoIcon: {
    fontSize: 28,
    lineHeight: 1,
  },
  metodoLabel: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  metodoTotal: {
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '0.05em',
  },
  metodoCount: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
}
