/**
 * KitchenStandalonePage — Vista de cocina standalone para terminales Wiseasy u otros
 * Acceso: ?cocina=1  (no requiere login)
 * Optimizada para pantalla táctil, botones grandes, sin navegación de POS.
 */
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

interface OrdenItem {
  id: string
  nombre: string
  emoji: string
  cantidad: number
  notas: string | null
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

const PREP_DEFAULT = 5

function minutosTranscurridos(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
}

function colorPorTiempo(mins: number, max: number): string {
  if (mins < max * 0.6) return '#22c55e'
  if (mins < max) return '#f59e0b'
  return '#ef4444'
}

function estimarPrep(items: OrdenItem[]): number {
  if (items.length === 0) return PREP_DEFAULT
  return Math.max(...items.map(item => {
    const n = item.nombre.toLowerCase()
    if (item.emoji === '🧇' || n.includes('waffle')) return 8
    if (item.emoji === '🥞' || n.includes('crepa')) return 7
    if (n.includes('sandwich') || item.emoji === '🥪') return 5
    if (item.emoji === '☕' || item.emoji === '🧋' || n.includes('frappe')) return 5
    return 3
  }))
}

function esLlevar(orden: Orden): boolean {
  return orden.tipo === 'llevar' || orden.mesa_nombre === 'Para Llevar' || orden.mesa_nombre === 'LLEVAR'
}

function playBeep(tipo?: string | null) {
  try {
    const ctx = new AudioContext()
    if (tipo === 'llevar') {
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.15)
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.15)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.05)
        osc.start(ctx.currentTime + i * 0.15); osc.stop(ctx.currentTime + i * 0.15 + 0.05)
      }
    } else {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4)
    }
  } catch {}
}

export default function KitchenStandalonePage() {
  const [ordenes, setOrdenes] = useState<Orden[]>([])
  const [loading, setLoading] = useState(true)
  const [ahora, setAhora] = useState(new Date())
  const prevIds = useRef<Set<string>>(new Set())
  const alertadas = useRef<Set<string>>(new Set())

  useEffect(() => {
    cargar()

    const iv = setInterval(() => {
      setAhora(new Date())
      setOrdenes(prev => {
        prev.forEach(o => {
          const mins = minutosTranscurridos(o.created_at)
          if (mins >= 10 && !alertadas.current.has(o.id)) {
            playBeep(o.tipo); alertadas.current = new Set([...alertadas.current, o.id])
          }
        })
        return prev
      })
    }, 30000)

    const canal = supabase
      .channel(`kitchen-standalone-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orden_items' }, cargar)
      .subscribe()

    return () => { clearInterval(iv); supabase.removeChannel(canal) }
  }, [])

  useEffect(() => {
    const pendientes = ordenes.filter(o => o.estado === 'abierta').length
    document.title = pendientes > 0 ? `(${pendientes}) 🍳 Cocina` : '🍳 Cocina'
  }, [ordenes])

  async function cargar() {
    try {
      const { data } = await supabase
        .from('ordenes')
        .select('id, mesa_nombre, cajero_nombre, created_at, estado, tipo, numero_diario, orden_items(id, nombre, emoji, cantidad, notas)')
        .in('estado', ['abierta', 'lista'])
        .order('created_at', { ascending: true })

      const nuevas = (data as Orden[]) ?? []
      const idsNuevas = new Set(nuevas.map(o => o.id))
      if (prevIds.current.size > 0) {
        nuevas.forEach(o => { if (!prevIds.current.has(o.id)) playBeep(o.tipo) })
      }
      prevIds.current = idsNuevas
      setOrdenes(nuevas)
    } catch { /* mantener lista */ }
    finally { setLoading(false) }
  }

  async function marcarLista(id: string) {
    const { error } = await supabase.from('ordenes').update({ estado: 'lista' }).eq('id', id)
    if (error) toast.error('Error al actualizar')
    else toast.success('¡Lista!')
  }

  async function marcarEntregada(id: string) {
    const { error } = await supabase.from('ordenes').update({ estado: 'entregada', cerrada_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error('Error al actualizar')
    else toast.success('Entregada ✓')
  }

  async function devolverACocina(id: string) {
    const { error } = await supabase.from('ordenes').update({ estado: 'abierta' }).eq('id', id)
    if (error) toast.error('Error al devolver a cocina')
  }

  const enPrep = ordenes.filter(o => o.estado === 'abierta')
  const listas  = ordenes.filter(o => o.estado === 'lista')
  const urgentes = enPrep.filter(o => minutosTranscurridos(o.created_at) >= 10).length

  if (loading) {
    return (
      <div style={{ background: '#0a0a0a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>⚙️</div>
          <p style={{ color: '#666', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 4, fontSize: 12 }}>Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#0a0a0a', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{
        background: '#111',
        borderBottom: '2px solid #ef4444',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 22 }}>🍳</span>
        <div style={{ flex: 1 }}>
          <p style={{ color: '#fff', fontWeight: 900, fontSize: 14, textTransform: 'uppercase', letterSpacing: 2, margin: 0 }}>
            Vista de Cocina
          </p>
          <p style={{ color: '#666', fontSize: 11, margin: 0 }}>
            {enPrep.length} en preparación
            {urgentes > 0 && <span style={{ color: '#ef4444' }}> · ⚠ {urgentes} urgente{urgentes > 1 ? 's' : ''}</span>}
            {listas.length > 0 && <span style={{ color: '#a855f7' }}> · {listas.length} lista{listas.length > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <p style={{ color: '#f59e0b', fontWeight: 900, fontSize: 18, margin: 0 }}>
          {ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </p>
      </header>

      {/* Split view: En preparación | Listas */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Panel izquierdo — En preparación */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid #222', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.07)', borderBottom: '1px solid rgba(34,197,94,0.2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>🍳 En preparación</span>
            <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontWeight: 900, fontSize: 11, padding: '1px 7px' }}>{enPrep.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {enPrep.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#333', textAlign: 'center' }}>
                <span style={{ fontSize: 48, marginBottom: 8 }}>✓</span>
                <p style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>Sin órdenes pendientes</p>
              </div>
            ) : enPrep.map(o => (
              <OrdenCard key={o.id} orden={o} onLista={marcarLista} onEntregada={marcarEntregada} onDevolver={devolverACocina} />
            ))}
          </div>
        </div>

        {/* Panel derecho — Listas para entregar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: 'rgba(168,85,247,0.07)', borderBottom: '1px solid rgba(168,85,247,0.2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#a855f7', fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>✓ Listas para entregar</span>
            <span style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)', fontWeight: 900, fontSize: 11, padding: '1px 7px' }}>{listas.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {listas.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#333', textAlign: 'center' }}>
                <span style={{ fontSize: 48, marginBottom: 8 }}>⏳</span>
                <p style={{ fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>Ninguna lista aún</p>
              </div>
            ) : listas.map(o => (
              <OrdenCard key={o.id} orden={o} onLista={marcarLista} onEntregada={marcarEntregada} onDevolver={devolverACocina} />
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Tarjeta de orden ────────────────────────────────────────────────────────
interface OrdenCardProps {
  orden: Orden
  onLista: (id: string) => void
  onEntregada: (id: string) => void
  onDevolver: (id: string) => void
}

function OrdenCard({ orden, onLista, onEntregada, onDevolver }: OrdenCardProps) {
  const mins    = minutosTranscurridos(orden.created_at)
  const prepMax = estimarPrep(orden.orden_items)
  const tc      = orden.estado === 'lista' ? '#a855f7' : colorPorTiempo(mins, prepMax)
  const isLista   = orden.estado === 'lista'
  const isUrgente = mins >= prepMax && !isLista
  const isLlevar  = esLlevar(orden)

  return (
    <div style={{
      background: isLista ? 'rgba(168,85,247,0.05)' : isUrgente ? 'rgba(239,68,68,0.04)' : '#111',
      border: `1px solid ${isLista ? 'rgba(168,85,247,0.3)' : isUrgente ? 'rgba(239,68,68,0.3)' : '#222'}`,
      borderTop: `3px solid ${isLlevar ? '#f0a800' : tc}`,
      display: 'flex',
      flexDirection: 'column',
    }}>

      {/* Header de la orden */}
      <div style={{ padding: '10px 14px', background: '#0f0f0f', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
            {/* Nombre de mesa grande */}
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 20 }}>{orden.mesa_nombre}</span>
            {orden.numero_diario != null && (
              <span style={{ color: '#666', fontWeight: 900, fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid #222', padding: '1px 5px' }}>
                #{String(orden.numero_diario).padStart(3, '0')}
              </span>
            )}
            {isLlevar && (
              <span style={{ background: 'rgba(240,168,0,0.15)', color: '#f0a800', border: '1px solid rgba(240,168,0,0.4)', fontWeight: 900, fontSize: 10, padding: '2px 7px' }}>🛍 LLEVAR</span>
            )}
            {isLista && (
              <span style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)', fontWeight: 900, fontSize: 10, padding: '2px 7px' }}>✓ LISTA</span>
            )}
            {isUrgente && (
              <span style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 900, fontSize: 10, padding: '2px 7px' }}>⚠ URGENTE</span>
            )}
          </div>
          <p style={{ color: '#555', fontSize: 11, margin: 0 }}>{orden.cajero_nombre}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ color: tc, fontWeight: 900, fontSize: 18, margin: 0 }}>
            🕐 {mins < 1 ? '< 1' : mins} min
          </p>
          <p style={{ color: '#444', fontSize: 10, margin: 0 }}>/ ~{prepMax} min</p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.04)' }}>
        <div style={{ height: '100%', width: `${Math.min(100, (mins / prepMax) * 100)}%`, background: tc, transition: 'width 1s' }} />
      </div>

      {/* Items — texto grande y legible desde lejos */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orden.orden_items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{item.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>
                <span style={{ color: tc, fontWeight: 900 }}>{item.cantidad}×</span>{' '}
                {item.nombre}
              </p>
              {item.notas && (
                <p style={{ color: '#f0a800', fontSize: 12, margin: '2px 0 0 0', fontStyle: 'italic' }}>⚠ {item.notas}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Botones táctiles grandes */}
      <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLista ? (
          <>
            <button
              onClick={() => onEntregada(orden.id)}
              style={{
                width: '100%', padding: '14px 0', fontWeight: 900, fontSize: 14,
                textTransform: 'uppercase', letterSpacing: 2, background: '#a855f7',
                color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              ✓ Entregada — cerrar
            </button>
            <button
              onClick={() => onDevolver(orden.id)}
              style={{
                width: '100%', padding: '10px 0', fontWeight: 900, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: 1, background: 'transparent',
                color: '#555', border: '1px solid #2a2a2a', cursor: 'pointer',
              }}
            >
              ↩ Devolver a cocina
            </button>
          </>
        ) : (
          <button
            onClick={() => onLista(orden.id)}
            style={{
              width: '100%', padding: '16px 0', fontWeight: 900, fontSize: 16,
              textTransform: 'uppercase', letterSpacing: 2, background: '#22c55e',
              color: '#000', border: 'none', cursor: 'pointer',
            }}
          >
            ✓ Lista — entregar
          </button>
        )}
      </div>
    </div>
  )
}
