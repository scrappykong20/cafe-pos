import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

type Tab = 'rentabilidad' | 'abc' | 'horas' | 'cajeros'
type Periodo = 'hoy' | 'semana' | 'mes'

function fmt(n: number) {
  return '$' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

// ── RENTABILIDAD ─────────────────────────────────────────────────────────────

interface MenuItemR {
  id: string
  nombre: string
  precio: number
  emoji?: string
}

interface VentaItemR {
  nombre: string
  precio: number
  cantidad: number
}

interface ProdRent {
  nombre: string
  emoji: string
  precio: number
  costo: number
  margen: number
  unidades: number
  ganancia: number
}

function TabRentabilidad() {
  const [menuItems, setMenuItems] = useState<MenuItemR[]>([])
  const [ventaItems, setVentaItems] = useState<VentaItemR[]>([])
  const [costos, setCostos] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('pos_costos_estimados')
    if (saved) {
      try { setCostos(JSON.parse(saved)) } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      try {
        const hace30dias = new Date()
        hace30dias.setDate(hace30dias.getDate() - 30)
        const [menuRes, itemsRes] = await Promise.all([
          supabase.from('menu').select('id,nombre,precio,emoji'),
          supabase.from('venta_items').select('nombre,precio,cantidad').gte('created_at', hace30dias.toISOString()),
        ])
        if (menuRes.error || itemsRes.error) {
          return
        }
        const menu = menuRes.data ?? []
        const items = itemsRes.data ?? []
        setMenuItems(menu)
        setVentaItems(items)
      } catch {
        // error de red
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [])

  function setCosto(nombre: string, valor: number) {
    const next = { ...costos, [nombre]: valor }
    setCostos(next)
    localStorage.setItem('pos_costos_estimados', JSON.stringify(next))
  }

  // Aggregate venta_items by nombre
  const ventaMap = new Map<string, { cantidad: number; precio: number }>()
  for (const vi of ventaItems) {
    const prev = ventaMap.get(vi.nombre) ?? { cantidad: 0, precio: vi.precio }
    ventaMap.set(vi.nombre, { cantidad: prev.cantidad + vi.cantidad, precio: vi.precio })
  }

  const rows: ProdRent[] = menuItems.map(m => {
    const costo = costos[m.nombre] ?? 0
    const precio = Number(m.precio) || 0
    const margen = precio > 0 ? ((precio - costo) / precio) * 100 : 0
    const v = ventaMap.get(m.nombre) ?? { cantidad: 0, precio }
    const ganancia = (precio - costo) * (Number(v.cantidad) || 0)
    return {
      nombre: m.nombre,
      emoji: m.emoji ?? '🍽️',
      precio: m.precio,
      costo,
      margen,
      unidades: v.cantidad,
      ganancia,
    }
  }).sort((a, b) => b.ganancia - a.ganancia)

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={S.sectionLabel}>RENTABILIDAD POR PRODUCTO</div>
      <p style={{ color: 'var(--muted)', fontSize: 11, margin: 0 }}>
        Ingresa el costo estimado por producto. Los valores se guardan localmente.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Producto', 'Precio venta', 'Costo estimado', 'Margen %', 'Unidades vendidas', 'Ganancia est.'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.nombre} style={S.tr}>
                <td style={S.td}>
                  <span style={{ marginRight: 6 }}>{r.emoji}</span>
                  <span style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.nombre}</span>
                </td>
                <td style={{ ...S.td, color: 'var(--yellow)', fontWeight: 900 }}>{fmt(r.precio)}</td>
                <td style={S.td}>
                  <input
                    type="number"
                    value={r.costo === 0 ? '' : r.costo}
                    placeholder="0.00"
                    onChange={e => setCosto(r.nombre, parseFloat(e.target.value) || 0)}
                    style={S.costoInput}
                  />
                </td>
                <td style={{ ...S.td, color: r.margen >= 50 ? '#22c55e' : r.margen >= 25 ? 'var(--yellow)' : '#ef4444', fontWeight: 900 }}>
                  {fmtPct(r.margen)}
                </td>
                <td style={{ ...S.td, textAlign: 'center' }}>{r.unidades}</td>
                <td style={{ ...S.td, color: r.ganancia > 0 ? '#22c55e' : 'var(--muted)', fontWeight: 900 }}>
                  {fmt(r.ganancia)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── ABC ──────────────────────────────────────────────────────────────────────

interface ABCRow {
  nombre: string
  emoji: string
  revenue: number
  pctAcum: number
  clase: 'A' | 'B' | 'C'
}

function TabABC() {
  const [rows, setRows] = useState<ABCRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totales, setTotales] = useState({ a: 0, b: 0, c: 0, total: 0 })

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      try {
        const hace30diasABC = new Date()
        hace30diasABC.setDate(hace30diasABC.getDate() - 30)
        const { data, error } = await supabase
          .from('venta_items')
          .select('nombre,emoji,precio,cantidad,ventas!inner(estado)')
          .eq('ventas.estado', 'completada')
          .gte('created_at', hace30diasABC.toISOString())

        if (error) {
          return
        }

        const prodMap = new Map<string, { revenue: number; emoji: string }>()
        for (const item of (data ?? []) as any[]) {
          const prev = prodMap.get(item.nombre) ?? { revenue: 0, emoji: item.emoji ?? '🍽️' }
          prodMap.set(item.nombre, {
            revenue: prev.revenue + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)),
            emoji: prev.emoji,
          })
        }

        const sorted = Array.from(prodMap.entries())
          .map(([nombre, v]) => ({ nombre, ...v }))
          .sort((a, b) => b.revenue - a.revenue)

        const totalRev = sorted.reduce((s, r) => s + r.revenue, 0)
        let acum = 0
        let revA = 0, revB = 0, revC = 0

        const result: ABCRow[] = sorted.map(r => {
          acum += r.revenue
          const pctAcum = totalRev > 0 ? (acum / totalRev) * 100 : 0
          const clase: 'A' | 'B' | 'C' = pctAcum <= 70 ? 'A' : pctAcum <= 90 ? 'B' : 'C'
          if (clase === 'A') revA += r.revenue
          else if (clase === 'B') revB += r.revenue
          else revC += r.revenue
          return { nombre: r.nombre, emoji: r.emoji, revenue: r.revenue, pctAcum, clase }
        })

        setRows(result)
        setTotales({ a: revA, b: revB, c: revC, total: totalRev })
      } catch {
        // error de red
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [])

  if (loading) return <LoadingSpinner />

  const totalWidth = totales.total > 0 ? totales.total : 1
  const wA = (totales.a / totalWidth) * 100
  const wB = (totales.b / totalWidth) * 100
  const wC = (totales.c / totalWidth) * 100

  const claseCfg = {
    A: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)', label: 'CLASE A — 70% ingresos' },
    B: { color: 'var(--yellow)', bg: 'rgba(240,168,0,0.12)', border: 'rgba(240,168,0,0.4)', label: 'CLASE B — 20% ingresos' },
    C: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', label: 'CLASE C — 10% ingresos' },
  }

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Bar summary */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={S.sectionLabel}>DISTRIBUCIÓN ABC</div>
        <div style={{ height: 36, display: 'flex', border: '1px solid var(--border)', overflow: 'hidden' }}>
          {(['A', 'B', 'C'] as const).map(cls => {
            const w = cls === 'A' ? wA : cls === 'B' ? wB : wC
            const cfg = claseCfg[cls]
            return (
              <div key={cls} style={{ width: `${w}%`, background: cfg.bg, borderRight: `1px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: w > 3 ? undefined : 0, overflow: 'hidden' }}>
                {w > 5 && <span style={{ fontSize: 10, fontWeight: 900, color: cfg.color, letterSpacing: '0.15em' }}>
                  {cls} {w.toFixed(0)}%
                </span>}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['A', 'B', 'C'] as const).map(cls => {
            const cfg = claseCfg[cls]
            const cnt = rows.filter(r => r.clase === cls).length
            return (
              <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, background: cfg.color, borderRadius: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.1em' }}>
                  {cfg.label} · {cnt} productos
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['#', 'Producto', 'Ingresos', '% Acumulado', 'Clase'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cfg = claseCfg[r.clase]
              return (
                <tr key={r.nombre} style={S.tr}>
                  <td style={{ ...S.td, color: 'var(--muted)', width: 32 }}>{i + 1}</td>
                  <td style={S.td}>
                    <span style={{ marginRight: 6 }}>{r.emoji}</span>
                    <span style={{ fontWeight: 900, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.nombre}</span>
                  </td>
                  <td style={{ ...S.td, color: 'var(--yellow)', fontWeight: 900 }}>{fmt(r.revenue)}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: 'var(--dark)', maxWidth: 100 }}>
                        <div style={{ width: `${r.pctAcum}%`, height: '100%', background: cfg.color }} />
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--muted)', minWidth: 36 }}>{fmtPct(r.pctAcum)}</span>
                    </div>
                  </td>
                  <td style={S.td}>
                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.15em', color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, padding: '3px 10px' }}>
                      {r.clase}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── HORAS PICO ────────────────────────────────────────────────────────────────

interface HeatCell {
  day: number   // 0=Lun … 6=Dom
  hour: number  // 6..22
  total: number
}

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 6..22

function TabHorasPico() {
  const [cells, setCells] = useState<HeatCell[]>([])
  const [maxVal, setMaxVal] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      try {
        const hace30 = new Date(Date.now() - 30 * 86400000).toISOString()
        const { data, error } = await supabase
          .from('ventas')
          .select('total,created_at')
          .eq('estado', 'completada')
          .gte('created_at', hace30)

        if (error) return

        const map = new Map<string, number>()
        for (const v of (data ?? [])) {
          const d = new Date(v.created_at)
          // JS getDay: 0=Dom, 1=Lun … 6=Sáb → convert to 0=Lun..6=Dom
          const jsDay = d.getDay()
          const day = jsDay === 0 ? 6 : jsDay - 1
          const hour = d.getHours()
          if (hour < 6 || hour > 22) continue
          const key = `${day}-${hour}`
          map.set(key, (map.get(key) ?? 0) + (v.total ?? 0))
        }

        const allCells: HeatCell[] = []
        let mx = 0
        for (let day = 0; day < 7; day++) {
          for (const hour of HOURS) {
            const total = map.get(`${day}-${hour}`) ?? 0
            if (total > mx) mx = total
            allCells.push({ day, hour, total })
          }
        }
        setCells(allCells)
        setMaxVal(mx || 1)
      } catch {
        // error de red
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [])

  if (loading) return <LoadingSpinner />

  function cellColor(total: number): string {
    if (total === 0) return 'var(--dark)'
    const intensity = total / maxVal
    if (intensity < 0.2) return 'rgba(240,168,0,0.15)'
    if (intensity < 0.4) return 'rgba(240,168,0,0.3)'
    if (intensity < 0.6) return 'rgba(240,168,0,0.5)'
    if (intensity < 0.8) return 'rgba(240,168,0,0.7)'
    return '#F0A800'
  }

  function cellTextColor(total: number): string {
    if (total === 0) return 'transparent'
    const intensity = total / maxVal
    return intensity >= 0.6 ? '#000' : 'var(--muted)'
  }

  function fmtHour(h: number) {
    const suffix = h < 12 ? 'am' : 'pm'
    const disp = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${disp}${suffix}`
  }

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={S.sectionLabel}>MAPA DE CALOR — ÚLTIMOS 30 DÍAS</div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'inline-block', minWidth: 600 }}>
          {/* Hour headers */}
          <div style={{ display: 'flex', marginLeft: 40 }}>
            {HOURS.map(h => (
              <div key={h} style={{ width: 38, textAlign: 'center', fontSize: 8, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.05em', paddingBottom: 4 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>
          {/* Rows */}
          {DAYS.map((dayLabel, dayIdx) => (
            <div key={dayLabel} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
              <div style={{ width: 36, fontSize: 9, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.1em', textAlign: 'right', paddingRight: 6 }}>
                {dayLabel}
              </div>
              {HOURS.map(hour => {
                const cell = cells.find(c => c.day === dayIdx && c.hour === hour)
                const total = cell?.total ?? 0
                return (
                  <div
                    key={hour}
                    title={total > 0 ? `${dayLabel} ${fmtHour(hour)}: ${fmt(total)}` : ''}
                    style={{
                      width: 36,
                      height: 28,
                      background: cellColor(total),
                      border: '1px solid var(--black)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 7,
                      fontWeight: 900,
                      color: cellTextColor(total),
                      cursor: total > 0 ? 'default' : 'default',
                      transition: 'background 0.15s',
                      marginRight: 2,
                    }}
                  >
                    {total > 0 && total / maxVal > 0.4 ? `$${Math.round(total / 1000) > 0 ? Math.round(total / 1000) + 'k' : Math.round(total)}` : ''}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.1em' }}>BAJO</span>
        {[0.1, 0.3, 0.5, 0.7, 1.0].map(v => (
          <div key={v} style={{ width: 20, height: 14, background: cellColor(v * maxVal), border: '1px solid var(--border)' }} />
        ))}
        <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.1em' }}>ALTO</span>
      </div>
    </div>
  )
}

// ── CAJEROS ───────────────────────────────────────────────────────────────────

interface CajeroRow {
  nombre: string
  ventas: number
  total: number
  efectivo: number
  tarjeta: number
}

function TabCajeros({ periodo, setPeriodo }: { periodo: Periodo; setPeriodo: (p: Periodo) => void }) {
  const [rows, setRows] = useState<CajeroRow[]>([])
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const ahora = new Date()
      const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

      let desde: string
      if (periodo === 'hoy') desde = hoy.toISOString()
      else if (periodo === 'semana') desde = new Date(hoy.getTime() - hoy.getDay() * 86400000).toISOString()
      else desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()

      const { data, error } = await supabase
        .from('ventas')
        .select('cajero_nombre,total,metodo_pago,created_at')
        .eq('estado', 'completada')
        .gte('created_at', desde)

      if (error) return

      const map = new Map<string, CajeroRow>()
      for (const v of (data ?? [])) {
        const nombre = v.cajero_nombre ?? 'Desconocido'
        const prev = map.get(nombre) ?? { nombre, ventas: 0, total: 0, efectivo: 0, tarjeta: 0 }
        map.set(nombre, {
          ...prev,
          ventas: prev.ventas + 1,
          total: prev.total + (v.total ?? 0),
          efectivo: prev.efectivo + (v.metodo_pago === 'efectivo' ? 1 : 0),
          tarjeta: prev.tarjeta + (v.metodo_pago === 'tarjeta' ? 1 : 0),
        })
      }

      setRows(Array.from(map.values()).sort((a, b) => b.total - a.total))
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }, [periodo])

  useEffect(() => { cargar() }, [cargar])

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.sectionLabel}>DESEMPEÑO POR CAJERO</div>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['hoy', 'semana', 'mes'] as Periodo[]).map(p => (
            <button key={p} onClick={() => setPeriodo(p)} style={{
              ...S.periodoBtn,
              ...(periodo === p ? S.periodoBtnActive : {}),
            }}>
              {p === 'hoy' ? 'HOY' : p === 'semana' ? 'SEMANA' : 'MES'}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingSpinner /> : rows.length === 0 ? (
        <div style={S.empty}>SIN DATOS PARA ESTE PERÍODO</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['', 'Cajero', '# Ventas', 'Total', 'Ticket Prom.', '% Efectivo', '% Tarjeta'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ticket = r.ventas > 0 ? r.total / r.ventas : 0
                const pctEfectivo = r.ventas > 0 ? (r.efectivo / r.ventas) * 100 : 0
                const pctTarjeta = r.ventas > 0 ? (r.tarjeta / r.ventas) * 100 : 0
                return (
                  <tr key={r.nombre} style={S.tr}>
                    <td style={{ ...S.td, width: 32, fontSize: 18 }}>{medals[i] ?? ''}</td>
                    <td style={{ ...S.td, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.nombre}</td>
                    <td style={{ ...S.td, textAlign: 'center' }}>{r.ventas}</td>
                    <td style={{ ...S.td, color: 'var(--yellow)', fontWeight: 900 }}>{fmt(r.total)}</td>
                    <td style={{ ...S.td, color: 'var(--text)' }}>{fmt(ticket)}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 48, height: 4, background: 'var(--dark)' }}>
                          <div style={{ width: `${pctEfectivo}%`, height: '100%', background: '#22c55e' }} />
                        </div>
                        <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 900 }}>{fmtPct(pctEfectivo)}</span>
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 48, height: 4, background: 'var(--dark)' }}>
                          <div style={{ width: `${pctTarjeta}%`, height: '100%', background: '#3b82f6' }} />
                        </div>
                        <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 900 }}>{fmtPct(pctTarjeta)}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── LOADING ───────────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12 }}>
      <div style={{ fontSize: 36 }} className="animate-gear">⚙️</div>
      <p style={{ color: 'var(--muted)', fontWeight: 900, letterSpacing: '0.2em', fontSize: 10, margin: 0 }}>CARGANDO DATOS...</p>
    </div>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function AnalisisPage({ cajero: _cajero, onVolver }: Props) {
  const [tab, setTab] = useState<Tab>('rentabilidad')
  const [periodo, setPeriodo] = useState<Periodo>('hoy')

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'rentabilidad', label: 'RENTABILIDAD', icon: '💹' },
    { key: 'abc', label: 'ABC', icon: '📊' },
    { key: 'horas', label: 'HORAS PICO', icon: '🕐' },
    { key: 'cajeros', label: 'CAJEROS', icon: '👤' },
  ]

  return (
    <div style={S.root}>
      {/* Header */}
      <header style={S.header}>
        <button onClick={onVolver} style={S.backBtn}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
          ← VOLVER
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📈</span>
          <h1 style={S.headerTitle}>ANÁLISIS AVANZADO</h1>
        </div>
        <div style={{ width: 90 }} />
      </header>

      {/* Tabs */}
      <div style={S.tabsBar}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            ...S.tabBtn,
            ...(tab === t.key ? S.tabBtnActive : {}),
          }}>
            <span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={S.main}>
        <div style={S.content}>
          {tab === 'rentabilidad' && <TabRentabilidad />}
          {tab === 'abc' && <TabABC />}
          {tab === 'horas' && <TabHorasPico />}
          {tab === 'cajeros' && <TabCajeros periodo={periodo} setPeriodo={setPeriodo} />}
        </div>
      </main>
    </div>
  )
}

// ── STYLES ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: 'var(--dark)', color: 'var(--text)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 20px', height: 58, background: 'var(--black)',
    borderBottom: '2px solid var(--yellow)', flexShrink: 0,
  },
  headerTitle: {
    margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: '0.2em',
    color: 'var(--yellow)', textTransform: 'uppercase',
  },
  backBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--muted)', padding: '6px 14px', cursor: 'pointer',
    fontWeight: 900, fontSize: 11, letterSpacing: '0.15em',
    textTransform: 'uppercase', borderRadius: 0, transition: 'all 0.15s', width: 90,
  },
  tabsBar: {
    display: 'flex', background: 'var(--black)',
    borderBottom: '1px solid var(--border)', flexShrink: 0, padding: '0 20px', overflowX: 'auto',
  },
  tabBtn: {
    background: 'transparent', border: 'none', borderBottom: '3px solid transparent',
    color: 'var(--muted)', padding: '12px 16px', cursor: 'pointer',
    fontWeight: 900, fontSize: 10, letterSpacing: '0.15em',
    textTransform: 'uppercase', transition: 'all 0.15s', marginBottom: -1,
    whiteSpace: 'nowrap',
  },
  tabBtnActive: { color: 'var(--yellow)', borderBottom: '3px solid var(--yellow)' },
  main: { flex: 1, overflowY: 'auto', overflowX: 'hidden' },
  content: { padding: '8px 24px 32px', maxWidth: 1100, margin: '0 auto' },
  sectionLabel: {
    fontSize: 10, fontWeight: 900, letterSpacing: '0.25em',
    color: 'var(--muted)', textTransform: 'uppercase',
  },
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: 12,
    background: 'var(--charcoal)', border: '1px solid var(--border)',
  },
  th: {
    padding: '10px 14px', textAlign: 'left', fontSize: 9,
    fontWeight: 900, letterSpacing: '0.2em', color: 'var(--muted)',
    textTransform: 'uppercase', background: 'var(--black)',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 14px', borderBottom: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 12, verticalAlign: 'middle',
  },
  tr: { transition: 'background 0.12s' },
  costoInput: {
    background: 'var(--dark)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '4px 8px', width: 90, fontSize: 12,
    fontWeight: 700, borderRadius: 0, outline: 'none',
  },
  periodoBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--muted)', padding: '5px 12px', cursor: 'pointer',
    fontWeight: 900, fontSize: 9, letterSpacing: '0.15em',
    textTransform: 'uppercase', borderRadius: 0, transition: 'all 0.15s',
  },
  periodoBtnActive: {
    background: 'rgba(240,168,0,0.08)', borderColor: 'var(--yellow)', color: 'var(--yellow)',
  },
  empty: {
    padding: '48px 0', textAlign: 'center', fontSize: 10,
    fontWeight: 900, letterSpacing: '0.2em', color: 'var(--muted)',
  },
}
