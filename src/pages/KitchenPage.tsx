import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import MermaModal from '../components/MermaModal'
import toast from 'react-hot-toast'

interface OrdenItem {
  id: string
  nombre: string
  emoji: string
  cantidad: number
  notas: string | null
  menu_id: string | null
}

interface Orden {
  id: string
  mesa_nombre: string
  cajero_nombre: string
  created_at: string
  estado: string
  tipo: string | null
  numero_diario: number | null
  orden_items: OrdenItem[]
}

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

// Tiempo estimado de preparación por categoría (minutos)
const PREP_TIMES: Record<string, number> = {
  cafe_caliente: 3,
  cafe_frio:     4,
  frappe:        5,
  sin_cafe:      3,
  cafe:          3,
  bebida_fria:   2,
  croissant:     2,
  baguette:      3,
  cuernito:      2,
  sandwich:      5,
  pan_dulce:     1,
  waffle:        8,
  crepa:         7,
  panaderia:     2,
  alimento:      6,
}

const DEFAULT_PREP = 5

function minutosTranscurridos(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
}

function colorPorTiempo(minutos: number, tiempoPrepMax: number): string {
  if (minutos < tiempoPrepMax * 0.6) return '#22c55e'
  if (minutos < tiempoPrepMax) return '#f59e0b'
  return '#ef4444'
}

function tiempoLabel(minutos: number): string {
  if (minutos < 1) return '< 1 min'
  return `${minutos} min`
}

// Estima tiempo de prep de la orden según los items
function estimarPrepOrden(items: OrdenItem[]): number {
  if (items.length === 0) return DEFAULT_PREP
  // Toma el máximo tiempo entre todos los items usando nombre y emoji de cada ítem
  return Math.max(...items.map(item => getItemPrepEstimate(item.nombre, item.emoji)))
}

function playAlertSound(tipoOrden?: string) {
  try {
    const ctx = new AudioContext()
    if (tipoOrden === 'llevar') {
      // Dos beeps cortos y agudos para órdenes para llevar
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.15)
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.15)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.05)
        osc.start(ctx.currentTime + i * 0.15)
        osc.stop(ctx.currentTime + i * 0.15 + 0.05)
      }
    } else {
      // Patrón cuadrado 440/880/440 para comedor
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    }
  } catch {}
}

function esLlevar(orden: Orden): boolean {
  return (
    orden.tipo === 'llevar' ||
    orden.mesa_nombre === 'Para Llevar' ||
    orden.mesa_nombre === 'LLEVAR'
  )
}

function getItemPrepEstimate(nombre: string, emoji: string): number {
  const n = nombre.toLowerCase()
  if (emoji === '🧇' || n.includes('waffle')) return 8
  if (emoji === '🥞' || n.includes('crepa')) return 7
  if (n.includes('sandwich') || emoji === '🥪') return 5
  if (emoji === '☕' || emoji === '🧋' || n.includes('frappe')) return 5
  if (n.includes('baguette') || emoji === '🥖') return 3
  return 3
}

export default function KitchenPage({ cajero, onVolver }: Props) {
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [loading, setLoading] = useState(true)
  const [ahora, setAhora] = useState(new Date())
  const [filtro, setFiltro] = useState<'todas' | 'urgentes'>('todas')
  const [vista, setVista] = useState<'todas' | 'dividida'>('todas')
  const [showMerma, setShowMerma] = useState(false)
  const [procesandoId, setProcesandoId] = useState<string | null>(null)
  const prevOrdenesRef = useRef<Set<string>>(new Set())
  // Ref para que el intervalo siempre lea el set actualizado sin closure stale
  const alertadasRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    cargarOrdenes()
    const iv = setInterval(() => {
      setAhora(new Date())
      // Revisar órdenes urgentes cada 30s usando ref para evitar closure stale
      setOrdenes(prev => {
        prev.forEach(o => {
          const mins = minutosTranscurridos(o.created_at)
          if (mins >= 10 && !alertadasRef.current.has(o.id)) {
            playAlertSound(o.tipo ?? undefined)
            alertadasRef.current = new Set([...alertadasRef.current, o.id])
          }
        })
        return prev
      })
    }, 30000)

    // Usar nombre de canal único para evitar colisión si el componente se desmonta y remonta
    const canalId = `kitchen-rt-${Date.now()}`
    const canal = supabase
      .channel(canalId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => cargarOrdenes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orden_items' }, () => cargarOrdenes())
      .subscribe()

    return () => { clearInterval(iv); supabase.removeChannel(canal) }
  }, [])

  useEffect(() => {
    const pending = ordenes.filter(o => o.estado === 'abierta').length
    document.title = pending > 0 ? `(${pending}) 🍳 Cocina` : '🍳 Cocina — Café del Constructor'
    return () => { document.title = 'Café del Constructor POS' }
  }, [ordenes])

  async function cargarOrdenes() {
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('id, mesa_nombre, cajero_nombre, created_at, estado, tipo, numero_diario, orden_items(id, nombre, emoji, cantidad, notas, menu_id)')
        .in('estado', ['abierta', 'lista'])
        .order('created_at', { ascending: true })

      if (error) { console.error('Error al cargar órdenes:', error.message); return; }

      const nuevas = (data as Orden[]) ?? []

      // Detectar órdenes recién llegadas (nuevas que no estaban antes)
      const idsActuales = new Set(nuevas.map(o => o.id))
      const idsAnteriores = prevOrdenesRef.current
      if (idsAnteriores.size > 0) {
        nuevas.forEach(o => {
          if (!idsAnteriores.has(o.id)) {
            playAlertSound(o.tipo ?? undefined)
          }
        })
      }
      prevOrdenesRef.current = idsActuales

      setOrdenes(nuevas)
    } catch {
      // error de red — mantener lista actual
    } finally {
      setLoading(false)
    }
  }

  async function marcarLista(ordenId: string) {
    if (procesandoId) return;
    setProcesandoId(ordenId)
    try {
      const { error } = await supabase.from('ordenes').update({ estado: 'lista' }).eq('id', ordenId)
      if (error) {
        toast.error('Error al actualizar orden')
      } else {
        toast.success('Orden lista')
      }
    } finally {
      setProcesandoId(null)
    }
  }

  async function marcarEntregada(ordenId: string) {
    if (procesandoId) return;
    setProcesandoId(ordenId)
    try {
      const { error } = await supabase.from('ordenes').update({ estado: 'entregada', cerrada_at: new Date().toISOString() }).eq('id', ordenId)
      if (error) {
        toast.error('Error al actualizar orden')
      } else {
        toast.success('Orden entregada')
      }
    } finally {
      setProcesandoId(null)
    }
  }

  async function devolverACocina(ordenId: string) {
    if (procesandoId) return;
    setProcesandoId(ordenId)
    try {
      const { error } = await supabase.from('ordenes').update({ estado: 'abierta' }).eq('id', ordenId)
      if (error) {
        toast.error('Error al actualizar orden')
      } else {
        toast.success('Orden devuelta a cocina')
      }
    } finally {
      setProcesandoId(null)
    }
  }

  const urgentes = ordenes.filter(o => minutosTranscurridos(o.created_at) >= 10 && o.estado === 'abierta')
  const ordenesFiltradas = filtro === 'urgentes' ? urgentes : ordenes

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--black)' }}>
      <div className="hazard-stripe-sm h-1 shrink-0" />

      {/* Header */}
      <header className="px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ background: 'var(--charcoal)', borderBottom: '2px solid #ef4444' }}>

        <button onClick={onVolver}
          className="text-xs font-black uppercase tracking-wider px-3 py-2 transition-colors shrink-0"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none', cursor: 'pointer', borderRadius: 0 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
          ←
        </button>

        <div className="flex-1 min-w-0">
          <p className="font-black text-sm uppercase tracking-wider" style={{ color: 'var(--text)' }}>
            🍳 Vista de Cocina
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {ordenes.filter(o => o.estado === 'abierta').length} pendiente{ordenes.filter(o => o.estado === 'abierta').length !== 1 ? 's' : ''}
            {urgentes.length > 0 && <span style={{ color: '#ef4444' }}> · ⚠ {urgentes.length} urgente{urgentes.length !== 1 ? 's' : ''}</span>}
            {' · '}{ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Filtro */}
        <div className="flex gap-1.5 shrink-0">
          {(['todas', 'urgentes'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-all"
              style={{
                background: filtro === f ? (f === 'urgentes' ? '#ef4444' : 'var(--yellow)') : 'var(--dark)',
                color: filtro === f ? '#000' : 'var(--muted)',
                border: `1px solid ${filtro === f ? (f === 'urgentes' ? '#ef4444' : 'var(--yellow)') : 'var(--border)'}`,
                borderRadius: 0, cursor: 'pointer',
              }}>
              {f === 'todas' ? 'Todas' : `⚠ Urgentes ${urgentes.length > 0 ? `(${urgentes.length})` : ''}`}
            </button>
          ))}
          <button
            onClick={() => setVista(v => v === 'dividida' ? 'todas' : 'dividida')}
            className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-all"
            style={{
              background: vista === 'dividida' ? '#3b82f6' : 'var(--dark)',
              color: vista === 'dividida' ? '#fff' : 'var(--muted)',
              border: `1px solid ${vista === 'dividida' ? '#3b82f6' : 'var(--border)'}`,
              borderRadius: 0, cursor: 'pointer',
            }}>
            ÷ División
          </button>
          <button
            onClick={() => setShowMerma(true)}
            className="text-xs font-black uppercase tracking-wider px-3 py-1.5"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 0, cursor: 'pointer' }}>
            🗑 Merma
          </button>
        </div>
      </header>
      {showMerma && <MermaModal cajeroNombre={`${cajero.nombre} ${cajero.last_name}`} onClose={() => setShowMerma(false)} />}

      {/* Leyenda tiempos */}
      <div className="px-4 py-1.5 flex items-center gap-4 shrink-0"
        style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        {[
          { color: '#22c55e', label: '< 60% del tiempo' },
          { color: '#f59e0b', label: '> 60% del tiempo' },
          { color: '#ef4444', label: 'Tiempo excedido' },
        ].map(({ color, label }) => (
          <div key={color} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5" style={{ background: color }} />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3">
          <span className="text-3xl animate-gear inline-block">⚙️</span>
          <p className="text-sm font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Cargando...</p>
        </div>
      ) : vista === 'dividida' ? (
        /* ── Split view ── */
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — En preparación */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ borderRight: '2px solid var(--border)' }}>
            <div className="px-4 py-2 shrink-0 flex items-center gap-2"
              style={{ background: 'rgba(34,197,94,0.08)', borderBottom: '1px solid rgba(34,197,94,0.25)' }}>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#22c55e' }}>
                🍳 En preparación
              </span>
              <span className="text-xs font-black px-1.5 py-0.5"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                {ordenes.filter(o => o.estado === 'abierta').length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {ordenes.filter(o => o.estado === 'abierta').length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
                  <span className="text-3xl opacity-20">✓</span>
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Sin órdenes</p>
                </div>
              ) : ordenes.filter(o => o.estado === 'abierta').map(orden => <OrdenCard key={orden.id} orden={orden} marcarLista={marcarLista} marcarEntregada={marcarEntregada} devolverACocina={devolverACocina} />)}
            </div>
          </div>
          {/* Right panel — Listas para entregar */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 shrink-0 flex items-center gap-2"
              style={{ background: 'rgba(168,85,247,0.08)', borderBottom: '1px solid rgba(168,85,247,0.25)' }}>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#a855f7' }}>
                ✓ Listas para entregar
              </span>
              <span className="text-xs font-black px-1.5 py-0.5"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                {ordenes.filter(o => o.estado === 'lista').length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {ordenes.filter(o => o.estado === 'lista').length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
                  <span className="text-3xl opacity-20">⏳</span>
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Ninguna lista aún</p>
                </div>
              ) : ordenes.filter(o => o.estado === 'lista').map(orden => <OrdenCard key={orden.id} orden={orden} marcarLista={marcarLista} marcarEntregada={marcarEntregada} devolverACocina={devolverACocina} />)}
            </div>
          </div>
        </div>
      ) : (
        /* ── Grid view (todas) ── */
        <div className="flex-1 overflow-y-auto p-4">
          {ordenesFiltradas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <span className="text-5xl opacity-20">✓</span>
              <p className="font-black text-sm uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                {filtro === 'urgentes' ? 'Sin órdenes urgentes' : 'Sin órdenes activas'}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)', opacity: 0.6 }}>
                Las nuevas órdenes aparecerán aquí automáticamente
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {ordenesFiltradas.map(orden => (
                <OrdenCard key={orden.id} orden={orden} marcarLista={marcarLista} marcarEntregada={marcarEntregada} devolverACocina={devolverACocina} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface OrdenCardProps {
  orden: Orden
  marcarLista: (id: string) => Promise<void>
  marcarEntregada: (id: string) => Promise<void>
  devolverACocina: (id: string) => Promise<void>
}

function OrdenCard({ orden, marcarLista, marcarEntregada, devolverACocina }: OrdenCardProps) {
  const mins = minutosTranscurridos(orden.created_at)
  const prepMax = estimarPrepOrden(orden.orden_items)
  const tc = orden.estado === 'lista' ? '#a855f7' : colorPorTiempo(mins, prepMax)
  const isLista = orden.estado === 'lista'
  const isUrgente = mins >= prepMax && !isLista
  const isLlevar = esLlevar(orden)
  const topBorderColor = isLlevar ? 'var(--yellow)' : tc

  return (
    <div
      className="flex flex-col"
      style={{
        background: isLista ? 'rgba(168,85,247,0.05)' : isUrgente ? 'rgba(239,68,68,0.04)' : 'var(--charcoal)',
        border: `1px solid ${isLista ? 'rgba(168,85,247,0.3)' : isUrgente ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
        borderTop: `3px solid ${topBorderColor}`,
        animation: isUrgente ? 'none' : undefined,
      }}
    >
      {/* Order header */}
      <div className="px-4 py-3 flex items-start justify-between"
        style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-base" style={{ color: 'var(--text)' }}>{orden.mesa_nombre}</p>
            {isLista && (
              <span className="text-xs font-black px-1.5 py-0.5"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                ✓ LISTA
              </span>
            )}
            {isUrgente && !isLista && (
              <span className="text-xs font-black px-1.5 py-0.5 animate-pulse"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                ⚠ URGENTE
              </span>
            )}
            {isLlevar ? (
              <span className="text-xs font-black px-1.5 py-0.5"
                style={{ background: 'rgba(240,168,0,0.15)', color: 'var(--yellow)', border: '1px solid rgba(240,168,0,0.4)' }}>
                🛍 LLEVAR
              </span>
            ) : (
              <span className="text-xs font-black px-1.5 py-0.5"
                style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                🪑 MESA
              </span>
            )}
          </div>
          {orden.numero_diario != null && (
            <p className="text-xs mt-0.5 font-black"
              style={{
                color: 'var(--muted)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                display: 'inline-block',
                padding: '0 4px',
              }}>
              #{String(orden.numero_diario).padStart(3, '0')}
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{orden.cajero_nombre}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-black text-lg" style={{ color: tc }}>🕐 {tiempoLabel(mins)}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>/ ~{prepMax} min</p>
        </div>
      </div>

      {/* Barra de progreso de tiempo */}
      <div className="h-1" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div
          className="h-full transition-all duration-1000"
          style={{
            width: `${Math.min(100, (mins / prepMax) * 100)}%`,
            background: tc,
          }}
        />
      </div>

      {/* Items */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {orden.orden_items.map(item => {
          const itemPrep = getItemPrepEstimate(item.nombre, item.emoji)
          const itemElapsed = minutosTranscurridos(orden.created_at)
          const dotColor = itemElapsed < itemPrep * 0.6 ? '#22c55e' : itemElapsed < itemPrep ? '#f59e0b' : '#ef4444'
          return (
            <div key={item.id} className="flex items-start gap-2">
              <div className="shrink-0 flex items-center gap-1.5 mt-1">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                <span className="text-lg">{item.emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  <span className="font-black" style={{ color: tc }}>{item.cantidad}×</span>{' '}
                  {item.nombre}
                </p>
                {item.notas && (
                  <p className="text-xs mt-0.5 italic" style={{ color: 'var(--yellow)' }}>
                    ⚠ {item.notas}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action button */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        {isLista ? (
          <>
            <button
              onClick={() => marcarEntregada(orden.id)}
              className="w-full py-3 font-black text-sm uppercase tracking-widest transition-all active:scale-95"
              style={{ background: '#a855f7', color: '#fff', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#9333ea')}
              onMouseLeave={e => (e.currentTarget.style.background = '#a855f7')}
            >
              ✓ Entregada — cerrar
            </button>
            <button
              onClick={() => devolverACocina(orden.id)}
              className="w-full py-2 font-black text-xs uppercase tracking-widest transition-all active:scale-95"
              style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              ↩ Devolver a cocina
            </button>
          </>
        ) : (
          <button
            onClick={() => marcarLista(orden.id)}
            className="w-full py-3 font-black text-sm uppercase tracking-widest transition-all active:scale-95"
            style={{ background: '#22c55e', color: '#000', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#16a34a')}
            onMouseLeave={e => (e.currentTarget.style.background = '#22c55e')}
          >
            ✓ Lista — entregar
          </button>
        )}
      </div>
    </div>
  )
}
