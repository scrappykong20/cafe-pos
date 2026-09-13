import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import type { Mesa } from '../types'
import type { CajeroActivo } from '../App'
import toast from 'react-hot-toast'

interface OrdenResumen {
  id: string
  mesa_id: string | null
  created_at: string
  notas: string | null
  num_personas: number | null
  orden_items: { nombre: string; cantidad: number; emoji: string; precio: number }[]
}

function minutosOcupada(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
}

function colorPorOcupacion(minutos: number): { border: string; bg: string; dot: string } {
  if (minutos < 30) return { border: 'rgba(34,197,94,0.5)', bg: 'rgba(34,197,94,0.06)', dot: '#22c55e' }
  if (minutos < 60) return { border: 'rgba(240,168,0,0.5)', bg: 'rgba(240,168,0,0.06)', dot: '#F0A800' }
  return { border: 'rgba(239,68,68,0.5)', bg: 'rgba(239,68,68,0.06)', dot: '#ef4444' }
}


interface Props {
  cajero: CajeroActivo
  onAbrirMesa: (id: string, nombre: string) => void
  onCambiarCajero: () => void
  onVolver: () => void
}

const ROL_COLORS: Record<string, string> = {
  admin:    '#a855f7',
  gerente:  '#3b82f6',
  cajero:   '#22c55e',
  mesero:   '#f59e0b',
  cocinero: '#ef4444',
}

const ROL_LABELS: Record<string, string> = {
  admin:    'Admin',
  gerente:  'Gerente',
  cajero:   'Cajero',
  mesero:   'Mesero',
  cocinero: 'Cocinero',
}

type VistaType = 'grid' | 'mapa'

export default function MesasPage({ cajero, onAbrirMesa, onCambiarCajero, onVolver }: Props) {
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [ordenesMap, setOrdenesMap] = useState<Record<string, OrdenResumen>>({})
  const [loading, setLoading] = useState(true)
  const [hora, setHora] = useState(new Date())
  const [filtro, setFiltro] = useState<'todas' | 'libres' | 'ocupadas'>('todas')
  const [turnoStats, setTurnoStats] = useState({ total: 0, ordenes: 0 })
  // B4 — Búsqueda de mesa por número o nombre
  const [busquedaMesa, setBusquedaMesa] = useState('')

  // ── Vista (grid / mapa) ──────────────────────────────────────────
  const [vista, setVista] = useState<VistaType>(() => {
    try {
      const saved = localStorage.getItem('pos_vista_mesas')
      if (saved === 'grid' || saved === 'mapa') return saved
    } catch {}
    return 'grid'
  })

  // ── Modo juntar mesas ────────────────────────────────────────────
  const [modoJuntar, setModoJuntar] = useState(false)
  const [mesasSeleccionadas, setMesasSeleccionadas] = useState<string[]>([])
  const [juntandoMesas, setJuntandoMesas] = useState(false)

  function toggleVista(v: VistaType) {
    setVista(v)
    try { localStorage.setItem('pos_vista_mesas', v) } catch {}
  }

  function entrarModoJuntar() {
    setModoJuntar(true)
    setMesasSeleccionadas([])
    setFiltro('todas') // mostrar todas para poder seleccionar libres
  }

  function salirModoJuntar() {
    setModoJuntar(false)
    setMesasSeleccionadas([])
  }

  function toggleSeleccionMesa(mesaId: string) {
    setMesasSeleccionadas(prev => {
      if (prev.includes(mesaId)) return prev.filter(id => id !== mesaId)
      if (prev.length >= 4) { toast.error('Máximo 4 mesas a la vez'); return prev }
      return [...prev, mesaId]
    })
  }

  async function confirmarUnion() {
    if (juntandoMesas) return;
    if (mesasSeleccionadas.length < 2) return
    setJuntandoMesas(true)
    try {
      const mesasElegidas = mesas.filter(m => mesasSeleccionadas.includes(m.id))
      const nombreUnion = mesasElegidas.map(m => m.nombre || `Mesa ${m.numero}`).join(' + ')

      // Crear orden especial con mesa_nombre combinado
      const { data: ordenData, error: ordenError } = await supabase
        .from('ordenes')
        .insert({
          cajero_id: cajero.id,
          cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
          mesa_id: mesasElegidas[0].id,
          estado: 'abierta',
          notas: `Mesas unidas: ${nombreUnion}`,
        })
        .select('id')
        .single()

      if (ordenError || !ordenData) {
        toast.error('Error al crear orden unida')
        return
      }

      // Marcar todas las mesas como ocupadas con esa orden
      const updates = await Promise.all(
        mesasElegidas.map(m =>
          supabase.from('mesas').update({ estado: 'ocupada', orden_id: ordenData.id }).eq('id', m.id)
        )
      )
      const mesaError = updates.find(r => r.error)
      if (mesaError?.error) {
        // Rollback: cancelar la orden y liberar todas las mesas que ya se marcaron como ocupadas
        await Promise.all([
          supabase.from('ordenes').update({ estado: 'cancelada', cerrada_at: new Date().toISOString() }).eq('id', ordenData.id),
          supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('orden_id', ordenData.id),
        ])
        toast.error('Error al marcar mesas como ocupadas: ' + mesaError.error.message)
        return
      }

      toast.success(`${nombreUnion} unidas`)
      salirModoJuntar()
      // Navegar a la orden creada con nombre combinado
      onAbrirMesa(mesasElegidas[0].id, nombreUnion)
    } catch (err) {
      toast.error('Error al unir mesas')
    } finally {
      // Siempre liberar el guard para que la UI no quede bloqueada
      setJuntandoMesas(false)
    }
  }

  useEffect(() => {
    cargarMesas()
    const interval = setInterval(() => setHora(new Date()), 1000)
    // Usar nombre de canal único para evitar colisión si el componente se desmonta y remonta
    const canalId = `mesas-pos-${Date.now()}`
    const canal = supabase
      .channel(canalId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas' }, cargarMesas)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargarMesas)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orden_items' }, cargarMesas)
      .subscribe()
    return () => {
      clearInterval(interval)
      supabase.removeChannel(canal)
    }
  }, [])

  async function cargarMesas() {
    const { data, error } = await supabase.from('mesas').select('*').order('numero')
    if (error) { toast.error(`Error mesas: ${error.message}`); return }
    const mesasData = data as Mesa[]
    setMesas(mesasData)
    setLoading(false)

    // Fetch ordenes activas para mesas ocupadas (para tiempo de ocupación + tooltip)
    const ordenIds = mesasData.filter(m => m.estado === 'ocupada' && m.orden_id).map(m => m.orden_id!)
    if (ordenIds.length > 0) {
      const { data: ordenes, error: ordenesErr } = await supabase
        .from('ordenes')
        .select('id, mesa_id, created_at, notas, num_personas, orden_items(nombre, cantidad, emoji, precio)')
        .in('id', ordenIds)
        .in('estado', ['en_caja', 'abierta'])
      if (ordenesErr) console.error('Error al cargar órdenes:', ordenesErr.message);
      const map: Record<string, OrdenResumen> = {}
      ;(ordenes ?? []).forEach((o: any) => { map[o.id] = o })
      setOrdenesMap(map)
    } else {
      setOrdenesMap({})
    }

    const ahora = new Date()
    const hoyLocal = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
    const { data: ventasHoy, error: ventasErr } = await supabase.from('ventas').select('total').gte('created_at', hoyLocal.toISOString())
    if (ventasErr) console.error('Error al cargar ventas de hoy:', ventasErr.message);
    const totalHoy = (ventasHoy ?? []).reduce((s: number, v: any) => s + (v.total || 0), 0)
    setTurnoStats({ total: totalHoy, ordenes: ventasHoy?.length ?? 0 })
  }

  function logout() {
    onCambiarCajero()
  }

  const mesasLibres   = mesas.filter(m => m.estado === 'libre').length
  const mesasOcupadas = mesas.filter(m => m.estado === 'ocupada').length
  const totalMesas    = mesas.length

  // Detectar mesas unidas: varias mesas con el mismo orden_id
  const ordenIdCount: Record<string, number> = {}
  mesas.forEach(m => { if (m.orden_id) ordenIdCount[m.orden_id] = (ordenIdCount[m.orden_id] || 0) + 1 })
  const mesasUnidasIds = new Set(mesas.filter(m => m.orden_id && ordenIdCount[m.orden_id] > 1).map(m => m.id))

  // Resolver la mesa y nombre correctos al abrir una mesa ocupada que puede ser parte de una unión
  function resolverMesaClick(mesa: Mesa) {
    const orden = mesa.orden_id ? ordenesMap[mesa.orden_id] : undefined
    // Si la orden fue creada para otra mesa (mesas unidas), navegar a la mesa primaria
    const mesaIdPrimaria = (orden?.mesa_id && orden.mesa_id !== mesa.id) ? orden.mesa_id : mesa.id
    // Extraer nombre combinado de las notas si aplica
    const nombreMostrado = orden?.notas?.startsWith('Mesas unidas:')
      ? orden.notas.replace('Mesas unidas: ', '')
      : mesa.nombre || `Mesa ${mesa.numero}`
    onAbrirMesa(mesaIdPrimaria, nombreMostrado)
  }

  const mesasFiltradas = mesas.filter(m => {
    if (filtro === 'libres')   return m.estado === 'libre'
    if (filtro === 'ocupadas') return m.estado === 'ocupada'
    return true
  }).filter(m => {
    // B4 — filtrar por búsqueda de número o nombre
    if (!busquedaMesa.trim()) return true
    const termino = busquedaMesa.trim().toLowerCase()
    return (
      String(m.numero).includes(termino) ||
      (m.nombre ?? '').toLowerCase().includes(termino)
    )
  })

  const rolColor = ROL_COLORS[cajero.rol] || 'var(--yellow)'
  const rolLabel = ROL_LABELS[cajero.rol] || cajero.rol

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--black)' }}>

      {/* Hazard top stripe */}
      <div className="hazard-stripe-sm h-1 shrink-0" />

      {/* Header */}
      <header className="px-4 py-3 flex items-center justify-between shrink-0"
        style={{ background: 'var(--charcoal)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl animate-gear inline-block">⚙️</span>
          <div>
            <h1 className="font-black text-sm uppercase tracking-wider" style={{ color: 'var(--text)' }}>
              Café del Constructor
            </h1>
            <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
              {hora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })}
              {' · '}
              <span className="font-mono">
                {hora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Volver */}
          <button onClick={onVolver}
            className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 0, background: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
            ← Tipo
          </button>

          {/* Toggle vista Grid / Mapa */}
          <div className="flex" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => toggleVista('grid')}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
              style={{
                background: vista === 'grid' ? 'var(--yellow)' : 'none',
                color: vista === 'grid' ? '#000' : 'var(--muted)',
                borderRadius: 0,
                cursor: 'pointer',
                border: 'none',
              }}>
              ⊞ Grid
            </button>
            <button
              onClick={() => toggleVista('mapa')}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
              style={{
                background: vista === 'mapa' ? 'var(--yellow)' : 'none',
                color: vista === 'mapa' ? '#000' : 'var(--muted)',
                borderRadius: 0,
                cursor: 'pointer',
                border: 'none',
                borderLeft: '1px solid var(--border)',
              }}>
              🗺️ Mapa
            </button>
          </div>

          {/* Botón Juntar mesas */}
          {!modoJuntar ? (
            <button
              onClick={entrarModoJuntar}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 0, background: 'none', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#06b6d4'; e.currentTarget.style.color = '#06b6d4' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
              ⊞ Juntar
            </button>
          ) : (
            <div className="flex gap-1 items-center">
              <span className="text-xs font-black uppercase tracking-wider px-2" style={{ color: '#06b6d4' }}>
                {mesasSeleccionadas.length}/4 sel.
              </span>
              {mesasSeleccionadas.length >= 2 && (
                <button
                  onClick={confirmarUnion}
                  disabled={juntandoMesas}
                  className="text-xs font-black uppercase tracking-wider px-3 py-1.5"
                  style={{ background: '#06b6d4', color: '#000', border: '1px solid #06b6d4', borderRadius: 0, cursor: 'pointer' }}>
                  {juntandoMesas ? '...' : '✓ Confirmar'}
                </button>
              )}
              <button
                onClick={salirModoJuntar}
                className="text-xs font-black uppercase tracking-wider px-3 py-1.5"
                style={{ background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 0, cursor: 'pointer' }}>
                ✕ Cancelar
              </button>
            </div>
          )}

          {/* Cajero info */}
          <div className="text-right hidden sm:block mr-1">
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {cajero.nombre} {cajero.last_name}
            </p>
            <span
              className="inline-block text-xs font-black uppercase tracking-widest px-2 py-0.5"
              style={{
                background: `${rolColor}18`,
                border: `1px solid ${rolColor}55`,
                color: rolColor,
                borderRadius: 0,
              }}
            >
              {rolLabel}
            </span>
          </div>

          {/* Cambiar cajero */}
          <button
            onClick={onCambiarCajero}
            className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 0, background: 'none', cursor: 'pointer' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--yellow)'
              e.currentTarget.style.color = 'var(--yellow)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--muted)'
            }}
          >
            ⇄ Cajero
          </button>

          {/* Salir */}
          <button
            onClick={logout}
            className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 0, background: 'none', cursor: 'pointer' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#ef4444'
              e.currentTarget.style.color = '#ef4444'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--muted)'
            }}
          >
            Salir
          </button>
        </div>
      </header>

      {/* Banner modo juntar */}
      {modoJuntar && (
        <div className="px-4 py-2 shrink-0 flex items-center gap-2"
          style={{ background: 'rgba(6,182,212,0.08)', borderBottom: '1px solid rgba(6,182,212,0.3)' }}>
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#06b6d4' }}>
            ⊞ MODO JUNTAR MESAS — Selecciona 2–4 mesas libres con borde punteado
          </span>
        </div>
      )}

      {/* Stats + filtros */}
      <div className="px-4 py-2.5 flex items-center gap-3 shrink-0"
        style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>

        {/* Stats */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 0 }}>
            <div className="w-1.5 h-1.5" style={{ background: 'var(--green)', borderRadius: '50%', boxShadow: '0 0 4px var(--green)' }} />
            <span className="text-xs font-black" style={{ color: 'var(--green)' }}>
              {mesasLibres} libres
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'rgba(240,168,0,0.08)', border: '1px solid rgba(240,168,0,0.2)', borderRadius: 0 }}>
            <div className="w-1.5 h-1.5" style={{ background: 'var(--yellow)', borderRadius: '50%', boxShadow: '0 0 4px var(--yellow)' }} />
            <span className="text-xs font-black" style={{ color: 'var(--yellow)' }}>
              {mesasOcupadas} ocupadas
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 hidden sm:flex"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 0 }}>
            <span className="text-xs font-black" style={{ color: 'var(--muted)' }}>
              {totalMesas} total
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 hidden sm:flex"
            style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 0 }}>
            <span className="text-xs font-black" style={{ color: '#3b82f6' }}>
              {turnoStats.ordenes} órdenes hoy
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 hidden sm:flex"
            style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 0 }}>
            <span className="text-xs font-black" style={{ color: '#a855f7' }}>
              ${turnoStats.total.toFixed(0)} recaudado
            </span>
          </div>
        </div>

        {/* B4 — Búsqueda de mesa */}
        <input
          type="text"
          value={busquedaMesa}
          onChange={e => setBusquedaMesa(e.target.value)}
          placeholder="Buscar mesa..."
          className="text-xs font-bold px-2.5 py-1.5 ml-2"
          style={{
            background: 'var(--charcoal)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            outline: 'none',
            borderRadius: 0,
            width: 130,
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--yellow)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />

        {/* Filtros */}
        <div className="flex gap-1 ml-auto">
          {([['todas', 'Todas'], ['libres', 'Libres'], ['ocupadas', 'Ocupadas']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFiltro(key)}
              className="text-xs font-black uppercase tracking-wider px-3 py-1.5 transition-all"
              style={{
                background: filtro === key ? 'var(--yellow)' : 'transparent',
                color: filtro === key ? '#000' : 'var(--muted)',
                border: `1px solid ${filtro === key ? 'var(--yellow)' : 'var(--border)'}`,
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Section label */}
      <div className="px-4 pt-3 pb-1 shrink-0 flex items-center gap-2">
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
          {modoJuntar
            ? 'Selecciona mesas libres para unir'
            : vista === 'mapa'
            ? 'Mapa de mesas'
            : 'Selecciona una mesa para abrir orden'}
        </p>
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </div>

      {/* Contenido principal */}
      <div className={`flex-1 ${vista === 'mapa' ? 'overflow-hidden' : 'overflow-y-auto px-4 pb-4 pt-2'}`}>
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <span className="text-2xl animate-gear inline-block">⚙️</span>
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Cargando mesas...
            </p>
          </div>
        ) : mesasFiltradas.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              {busquedaMesa.trim()
                ? 'No se encontró ninguna mesa'
                : `Sin mesas ${filtro !== 'todas' ? filtro : ''}`}
            </p>
          </div>
        ) : vista === 'mapa' ? (
          // ── Vista Mapa — Plano visual ──────────────────────────────
          <PlanoVisual
            mesas={mesas}
            ordenesMap={ordenesMap}
            modoJuntar={modoJuntar}
            mesasSeleccionadas={mesasSeleccionadas}
            cajeroEsAdmin={cajero.es_admin}
            onClickMesa={(mesa) => {
              if (modoJuntar) {
                if (mesa.estado !== 'libre') { toast.error('Solo se pueden juntar mesas libres'); return }
                toggleSeleccionMesa(mesa.id)
              } else {
                resolverMesaClick(mesa)
              }
            }}
          />
        ) : (
          // ── Vista Grid (default) ────────────────────────────────────
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {mesasFiltradas.map(mesa => (
              <MesaCard
                key={mesa.id}
                mesa={mesa}
                orden={mesa.orden_id ? ordenesMap[mesa.orden_id] : undefined}
                modoJuntar={modoJuntar}
                seleccionada={mesasSeleccionadas.includes(mesa.id)}
                esUnida={mesasUnidasIds.has(mesa.id)}
                onClick={() => {
                  if (modoJuntar) {
                    if (mesa.estado !== 'libre') { toast.error('Solo se pueden juntar mesas libres'); return }
                    toggleSeleccionMesa(mesa.id)
                  } else {
                    resolverMesaClick(mesa)
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MesaCard({
  mesa,
  orden,
  modoJuntar,
  seleccionada,
  esUnida,
  onClick,
}: {
  mesa: Mesa
  orden?: OrdenResumen
  modoJuntar?: boolean
  seleccionada?: boolean
  esUnida?: boolean
  onClick: () => void
}) {
  const ocupada = mesa.estado === 'ocupada'
  const esLibre = mesa.estado === 'libre'
  const [hovering, setHovering] = useState(false)
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    if (!ocupada) return
    const iv = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(iv)
  }, [ocupada])

  const mins = orden ? Math.floor((ahora - new Date(orden.created_at).getTime()) / 60000) : 0
  const ocColors = ocupada && orden ? colorPorOcupacion(mins) : null

  // Totales de la orden
  const totalOrden = orden
    ? orden.orden_items.reduce((sum, item) => sum + (item.precio ?? 0) * item.cantidad, 0)
    : 0
  const itemCount = orden ? orden.orden_items.reduce((sum, item) => sum + item.cantidad, 0) : 0

  // Si estamos en modo juntar, las mesas libres tienen borde punteado seleccionable
  const enModoJuntarSeleccionable = modoJuntar && esLibre

  const borderColor = seleccionada
    ? '#06b6d4'
    : ocupada
    ? (ocColors?.border ?? 'rgba(240,168,0,0.4)')
    : enModoJuntarSeleccionable
    ? 'rgba(6,182,212,0.5)'
    : 'var(--border)'

  const bgColor = seleccionada
    ? 'rgba(6,182,212,0.12)'
    : ocupada
    ? (ocColors?.bg ?? 'rgba(240,168,0,0.06)')
    : 'var(--charcoal)'

  const dotColor = ocupada
    ? (ocColors?.dot ?? 'var(--yellow)')
    : 'var(--green)'

  function tiempoLabel(m: number) {
    if (m < 1) return '< 1 min'
    if (m < 60) return `${m} min`
    return `${Math.floor(m / 60)}h ${m % 60}m`
  }

  const borderStyle = enModoJuntarSeleccionable || seleccionada ? 'dashed' : 'solid'

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className="relative w-full text-left transition-all active:scale-95"
        style={{
          background: bgColor,
          border: `${seleccionada ? 2 : 1}px ${borderStyle} ${borderColor}`,
          borderBottom: `3px ${borderStyle} ${borderColor}`,
          borderRadius: 0,
          padding: '1rem',
          cursor: 'pointer',
        }}
        onMouseEnter={e => {
          setHovering(true)
          if (!ocupada && !seleccionada) {
            e.currentTarget.style.borderColor = enModoJuntarSeleccionable ? '#06b6d4' : 'var(--yellow)'
            e.currentTarget.style.borderBottomColor = enModoJuntarSeleccionable ? '#06b6d4' : 'var(--yellow)'
          }
        }}
        onMouseLeave={e => {
          setHovering(false)
          if (!ocupada && !seleccionada) {
            e.currentTarget.style.borderColor = borderColor
            e.currentTarget.style.borderBottomColor = borderColor
          }
        }}
      >
        {/* Indicador seleccionada en modo juntar */}
        {seleccionada && (
          <div className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center font-black text-xs"
            style={{ background: '#06b6d4', color: '#000', borderRadius: 0 }}>
            ✓
          </div>
        )}
        {/* Badge mesas unidas */}
        {esUnida && !seleccionada && (
          <div className="absolute top-2 left-2 font-black text-xs px-1 py-0.5 leading-none"
            style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.5)', color: '#06b6d4', borderRadius: 0, fontSize: 9 }}>
            ⊞ UNIDA
          </div>
        )}

        {/* Estado indicator dot */}
        {!seleccionada && (
          <div
            className={ocupada ? 'absolute top-2.5 right-2.5 w-2 h-2 animate-dot-pulse' : 'absolute top-2.5 right-2.5 w-2 h-2'}
            style={{
              background: dotColor,
              borderRadius: '50%',
              boxShadow: `0 0 6px ${dotColor}`,
            }}
          />
        )}

        {/* Número grande */}
        <div className="font-black text-3xl leading-none mb-2"
          style={{ color: seleccionada ? '#06b6d4' : ocupada ? dotColor : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {mesa.numero}
        </div>

        {/* Nombre */}
        <div className="font-bold text-xs uppercase tracking-wider truncate mb-1" style={{ color: 'var(--text)' }}>
          {mesa.nombre || `Mesa ${mesa.numero}`}
        </div>

        {/* Estado */}
        <div className="text-xs font-black uppercase tracking-wider"
          style={{ color: seleccionada ? '#06b6d4' : ocupada ? dotColor : 'var(--green)' }}>
          {seleccionada ? '⊞ Seleccionada' : ocupada ? '● Ocupada' : '○ Libre'}
        </div>

        {/* Tiempo + capacidad + info mejorada */}
        {ocupada && orden ? (
          <div className="mt-2 space-y-1">
            {/* Tiempo más prominente */}
            <div className="font-black text-base tabular-nums" style={{ color: dotColor }}>
              🕐 {tiempoLabel(mins)}
            </div>
            {/* Items y total */}
            {itemCount > 0 && (
              <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
                🧾 {itemCount} item{itemCount !== 1 ? 's' : ''}
              </div>
            )}
            {totalOrden > 0 && (
              <div className="text-xs font-black" style={{ color: dotColor }}>
                ${totalOrden.toFixed(0)} MXN
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {mesa.capacidad} personas
          </div>
        )}
      </button>

      {/* Hover tooltip — order preview */}
      {hovering && ocupada && orden && orden.orden_items.length > 0 && (
        <div
          className="absolute z-50 animate-slide-up"
          style={{
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: 180,
            maxWidth: 220,
            background: 'var(--charcoal)',
            border: `1px solid ${dotColor}`,
            borderTop: `3px solid ${dotColor}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: dotColor }}>
              {mesa.nombre || `Mesa ${mesa.numero}`} · {tiempoLabel(mins)}
            </p>
            {orden.num_personas && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                👥 {orden.num_personas} persona{orden.num_personas !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="px-3 py-2 space-y-1">
            {orden.orden_items.slice(0, 5).map((item, i) => (
              <p key={i} className="text-xs" style={{ color: 'var(--text)' }}>
                <span className="font-black" style={{ color: dotColor }}>{item.cantidad}×</span> {item.emoji} {item.nombre}
              </p>
            ))}
            {orden.orden_items.length > 5 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                +{orden.orden_items.length - 5} más...
              </p>
            )}
            {totalOrden > 0 && (
              <p className="text-xs font-black mt-1" style={{ color: dotColor, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                Total: ${totalOrden.toFixed(0)} MXN
              </p>
            )}
            {orden.notas && (
              <p className="text-xs italic mt-1" style={{ color: 'var(--yellow)' }}>
                ⚠ {orden.notas}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Plano Visual del salón ─────────────────────────────────────────── */
function colorMesaPlano(mesa: Mesa, orden?: OrdenResumen): string {
  if (mesa.estado === 'libre') return '#16a34a'
  if (!orden) return '#ca8a04'
  const mins = minutosOcupada(orden.created_at)
  if (mins < 30) return '#ca8a04'
  if (mins < 60) return '#ea580c'
  return '#dc2626'
}

const PLANO_DEFAULT: Record<string, { cx: number; cy: number }> = {
  'Mesa 1': { cx: 140, cy: 118 },
  'Mesa 2': { cx: 310, cy: 118 },
  'Mesa 3': { cx: 480, cy: 118 },
  'Mesa 4': { cx: 140, cy: 450 },
  'Mesa 5': { cx: 685, cy: 110 },
  'Mesa 6': { cx: 88,  cy: 298 },
  'B1':  { cx: 370, cy: 308 },
  'B2':  { cx: 432, cy: 308 },
  'B3':  { cx: 545, cy: 308 },
  'B4':  { cx: 608, cy: 308 },
  'B5':  { cx: 671, cy: 308 },
  'B6':  { cx: 258, cy: 392 },
  'B7':  { cx: 258, cy: 448 },
  'B8':  { cx: 258, cy: 504 },
  'B9':  { cx: 258, cy: 555 },
  'B10': { cx: 842, cy: 392 },
  'B11': { cx: 842, cy: 448 },
  'B12': { cx: 842, cy: 504 },
}

function PlanoVisual({
  mesas,
  ordenesMap,
  mesasSeleccionadas,
  onClickMesa,
  cajeroEsAdmin,
}: {
  mesas: Mesa[]
  ordenesMap: Record<string, OrdenResumen>
  modoJuntar: boolean
  mesasSeleccionadas: string[]
  onClickMesa: (mesa: Mesa) => void
  cajeroEsAdmin?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const byNombre = Object.fromEntries(mesas.map(m => [m.nombre, m]))
  const [editando, setEditando] = useState<{ mesa: Mesa; nuevoNombre: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [modoEdicion, setModoEdicion] = useState(false)
  const [dragging, setDragging] = useState<{ nombre: string; ox: number; oy: number } | null>(null)
  const [positions, setPositions] = useState<Record<string, { cx: number; cy: number }>>(() => {
    try {
      const s = localStorage.getItem('plano_posiciones')
      if (s) return { ...PLANO_DEFAULT, ...JSON.parse(s) }
    } catch {}
    return { ...PLANO_DEFAULT }
  })

  function svgCoords(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }

  function startDrag(nombre: string, e: React.PointerEvent) {
    if (!modoEdicion) return
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = svgCoords(e)
    const pos = positions[nombre] || PLANO_DEFAULT[nombre] || { cx: 100, cy: 100 }
    setDragging({ nombre, ox: x - pos.cx, oy: y - pos.cy })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  function moveDrag(e: React.PointerEvent) {
    if (!dragging) return
    e.preventDefault()
    const { x, y } = svgCoords(e)
    setPositions(prev => ({ ...prev, [dragging.nombre]: { cx: x - dragging.ox, cy: y - dragging.oy } }))
  }

  function endDrag() {
    if (!dragging) return
    setPositions(prev => {
      try { localStorage.setItem('plano_posiciones', JSON.stringify(prev)) } catch {}
      return prev
    })
    setDragging(null)
  }

  function resetPositions() {
    const reset = { ...PLANO_DEFAULT }
    setPositions(reset)
    try { localStorage.removeItem('plano_posiciones') } catch {}
    toast.success('Posiciones restablecidas')
  }

  async function guardarNombre() {
    if (!editando || !editando.nuevoNombre.trim()) return
    setGuardando(true)
    const { error } = await supabase.from('mesas').update({ nombre: editando.nuevoNombre.trim() }).eq('id', editando.mesa.id)
    setGuardando(false)
    if (error) { toast.error('Error al renombrar: ' + error.message); return }
    toast.success(`Renombrada a "${editando.nuevoNombre.trim()}"`)
    setEditando(null)
  }

  function col(nombre: string) {
    const m = byNombre[nombre]
    if (!m) return '#16a34a'
    return colorMesaPlano(m, m.orden_id ? ordenesMap[m.orden_id] : undefined)
  }
  function minsOcup(nombre: string) {
    const m = byNombre[nombre]
    if (!m || !m.orden_id) return 0
    return minutosOcupada(ordenesMap[m.orden_id]?.created_at ?? new Date().toISOString())
  }
  function sel(nombre: string) {
    const m = byNombre[nombre]
    return m ? mesasSeleccionadas.includes(m.id) : false
  }
  function libre(nombre: string) { return byNombre[nombre]?.estado === 'libre' }
  function click(nombre: string) {
    if (modoEdicion) return
    const m = byNombre[nombre]
    if (m) onClickMesa(m)
  }
  function label(nombre: string) {
    if (libre(nombre)) return 'LIBRE'
    const m = minsOcup(nombre)
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
  }
  function dobleClick(nombre: string) {
    if (modoEdicion) return
    if (!cajeroEsAdmin) return
    const m = byNombre[nombre]
    if (m) setEditando({ mesa: m, nuevoNombre: m.nombre ?? '' })
  }
  function pos(nombre: string) {
    return positions[nombre] || PLANO_DEFAULT[nombre] || { cx: 100, cy: 100 }
  }

  // ── Componentes SVG ─────────────────────────────────────────────────

  function Diamond({ n }: { n: string }) {
    const { cx, cy } = pos(n)
    const s = 28; const gap = 16
    const c = col(n); const isS = sel(n)
    const isDrag = dragging?.nombre === n
    const stroke = isS ? '#06b6d4' : isDrag ? '#F0A800' : c
    const fill = isS ? 'rgba(6,182,212,0.18)' : isDrag ? 'rgba(240,168,0,0.18)' : c + '22'
    const cFill = isS ? 'rgba(6,182,212,0.5)' : c + 'cc'
    const r = s + gap + 16
    return (
      <g
        onClick={() => click(n)}
        onDoubleClick={() => dobleClick(n)}
        onPointerDown={modoEdicion ? e => startDrag(n, e) : undefined}
        style={{ cursor: modoEdicion ? (isDrag ? 'grabbing' : 'grab') : 'pointer' }}
      >
        <title>{n} · {label(n)}</title>
        {/* Tap target */}
        <circle cx={cx} cy={cy} r={r} fill="transparent" />
        {/* Sillas */}
        <circle cx={cx}           cy={cy - s - gap} r={10} fill={cFill} stroke={stroke} strokeWidth="1.5" />
        <circle cx={cx + s + gap} cy={cy}           r={10} fill={cFill} stroke={stroke} strokeWidth="1.5" />
        <circle cx={cx}           cy={cy + s + gap} r={10} fill={cFill} stroke={stroke} strokeWidth="1.5" />
        <circle cx={cx - s - gap} cy={cy}           r={10} fill={cFill} stroke={stroke} strokeWidth="1.5" />
        {/* Mesa (cuadrado rotado) */}
        <polygon
          points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={isS || isDrag ? 3 : 2.5}
          strokeDasharray={isS ? '7,3' : isDrag ? '5,3' : undefined}
        />
        {/* Etiqueta */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill={stroke} fontSize="10" fontWeight="900" fontFamily="'Courier New',monospace">{n}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fill={stroke + 'cc'} fontSize="8" fontFamily="'Courier New',monospace">{label(n)}</text>
      </g>
    )
  }

  function RectV({ n }: { n: string }) {
    const { cx, cy } = pos(n)
    const w = 36; const h = 80; const gap = 13
    const c = col(n); const isS = sel(n)
    const isDrag = dragging?.nombre === n
    const stroke = isS ? '#06b6d4' : isDrag ? '#F0A800' : c
    const fill = isS ? 'rgba(6,182,212,0.18)' : isDrag ? 'rgba(240,168,0,0.18)' : c + '22'
    const cFill = isS ? 'rgba(6,182,212,0.5)' : c + 'cc'
    const chairs = [
      { x: cx - w/2 - gap, y: cy - 26 }, { x: cx - w/2 - gap, y: cy }, { x: cx - w/2 - gap, y: cy + 26 },
      { x: cx + w/2 + gap, y: cy - 26 }, { x: cx + w/2 + gap, y: cy }, { x: cx + w/2 + gap, y: cy + 26 },
      { x: cx, y: cy - h/2 - gap }, { x: cx, y: cy + h/2 + gap },
    ]
    return (
      <g
        onClick={() => click(n)}
        onDoubleClick={() => dobleClick(n)}
        onPointerDown={modoEdicion ? e => startDrag(n, e) : undefined}
        style={{ cursor: modoEdicion ? (isDrag ? 'grabbing' : 'grab') : 'pointer' }}
      >
        <title>{n} · {label(n)}</title>
        <rect x={cx - w/2 - gap - 14} y={cy - h/2 - gap - 14} width={w + 2*gap + 28} height={h + 2*gap + 28} fill="transparent" />
        {chairs.map((ch, i) => <circle key={i} cx={ch.x} cy={ch.y} r={9} fill={cFill} stroke={stroke} strokeWidth="1.5" />)}
        <rect x={cx - w/2} y={cy - h/2} width={w} height={h}
          fill={fill} stroke={stroke}
          strokeWidth={isS || isDrag ? 3 : 2.5}
          strokeDasharray={isS ? '7,3' : isDrag ? '5,3' : undefined} />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={stroke} fontSize="10" fontWeight="900" fontFamily="'Courier New',monospace">{n}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill={stroke + 'cc'} fontSize="8" fontFamily="'Courier New',monospace">{label(n)}</text>
      </g>
    )
  }

  function Seat({ n }: { n: string }) {
    const { cx, cy } = pos(n)
    const c = col(n); const isS = sel(n)
    const isDrag = dragging?.nombre === n
    const stroke = isS ? '#06b6d4' : isDrag ? '#F0A800' : c
    const fill = isS ? 'rgba(6,182,212,0.28)' : isDrag ? 'rgba(240,168,0,0.28)' : c + '28'
    return (
      <g
        onClick={() => click(n)}
        onDoubleClick={() => dobleClick(n)}
        onPointerDown={modoEdicion ? e => startDrag(n, e) : undefined}
        style={{ cursor: modoEdicion ? (isDrag ? 'grabbing' : 'grab') : 'pointer' }}
      >
        <title>{n} · {label(n)}</title>
        <circle cx={cx} cy={cy} r={22} fill="transparent" />
        <circle cx={cx} cy={cy} r={17} fill={fill} stroke={stroke}
          strokeWidth={isS || isDrag ? 3 : 2}
          strokeDasharray={isS ? '5,3' : isDrag ? '4,3' : undefined} />
        <text x={cx} y={cy - 2} textAnchor="middle" fill={stroke} fontSize="8" fontWeight="900" fontFamily="'Courier New',monospace">{n}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fill={stroke + 'cc'} fontSize="7" fontFamily="'Courier New',monospace">{label(n)}</text>
      </g>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111' }}>

      {/* Barra de herramientas del plano */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, padding: '6px 12px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        background: '#181818',
      }}>
        {/* Leyenda de colores */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {[{ c: '#16a34a', l: 'Libre' }, { c: '#ca8a04', l: '<30 min' }, { c: '#ea580c', l: '30–60 min' }, { c: '#dc2626', l: '+1 hora' }].map(x => (
            <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: x.c, boxShadow: `0 0 5px ${x.c}88` }} />
              <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{x.l}</span>
            </div>
          ))}
        </div>
        {/* Controles admin */}
        {cajeroEsAdmin && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {modoEdicion && (
              <button
                onClick={resetPositions}
                style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 900, padding: '3px 10px', background: 'none', border: '1px solid #444', color: '#666', cursor: 'pointer', borderRadius: 0 }}>
                ↺ Reset
              </button>
            )}
            <button
              onClick={() => setModoEdicion(v => !v)}
              style={{
                fontSize: 10, fontFamily: 'monospace', fontWeight: 900,
                padding: '3px 10px', cursor: 'pointer', borderRadius: 0,
                background: modoEdicion ? '#F0A800' : 'none',
                border: `1px solid ${modoEdicion ? '#F0A800' : '#444'}`,
                color: modoEdicion ? '#000' : '#888',
              }}>
              {modoEdicion ? '✓ Guardar layout' : '✏ Mover mesas'}
            </button>
            {!modoEdicion && (
              <span style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>doble clic = renombrar</span>
            )}
          </div>
        )}
      </div>

      {/* Banner modo edición */}
      {modoEdicion && (
        <div style={{ padding: '5px 12px', background: 'rgba(240,168,0,0.08)', borderBottom: '1px solid rgba(240,168,0,0.25)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: '#F0A800', fontFamily: 'monospace', fontWeight: 900 }}>
            ✏ MODO EDICIÓN — Arrastra las mesas para reposicionarlas. Las posiciones se guardan automáticamente.
          </span>
        </div>
      )}

      {/* SVG del plano */}
      <svg
        ref={svgRef}
        viewBox="0 0 920 580"
        width="100%" height="100%"
        style={{ display: 'block', flex: 1, minHeight: 0, touchAction: modoEdicion ? 'none' : 'auto' }}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={modoEdicion ? moveDrag : undefined}
        onPointerUp={modoEdicion ? endDrag : undefined}
        onPointerLeave={modoEdicion ? endDrag : undefined}
      >
        {/* Definiciones: filtros de sombra */}
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.5" />
          </filter>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#222" strokeWidth="0.5" />
          </pattern>
        </defs>

        {/* Fondo del salón */}
        <rect x="0" y="0" width="1000" height="620" fill="#111" />
        {/* Grid de piso */}
        <rect x="0" y="0" width="1000" height="620" fill="url(#grid)" />
        {/* Marco del salón */}
        <rect x="6" y="6" width="988" height="608" fill="none" stroke="#2a2a2a" strokeWidth="3" />

        {/* ── Zona BARRA — fondo diferenciado ── */}
        <rect x="240" y="270" width="660" height="340" fill="#151515" stroke="#222" strokeWidth="1" />
        <text x="560" y="294" textAnchor="middle" fill="#2a2a2a" fontSize="11" fontFamily="monospace" fontWeight="900" letterSpacing="4">ÁREA DE BARRA</text>

        {/* Separador zona comedor / barra */}
        <line x1="240" y1="270" x2="240" y2="610" stroke="#282828" strokeWidth="2" strokeDasharray="8,6" />

        {/* Zona COMEDOR label */}
        <text x="118" y="24" textAnchor="middle" fill="#2a2a2a" fontSize="10" fontFamily="monospace" fontWeight="900" letterSpacing="3">COMEDOR</text>

        {/* ── BARRA EN U ── */}
        {/* Mostrador horizontal (parte superior) */}
        <rect x="302" y="344" width="496" height="26" rx="3" fill="#252525" stroke="#383838" strokeWidth="2" filter="url(#shadow)" />
        <text x="550" y="361" textAnchor="middle" fill="#444" fontSize="10" fontFamily="monospace" letterSpacing="3">— MOSTRADOR —</text>

        {/* Brazo izquierdo */}
        <rect x="302" y="344" width="26" height="228" rx="3" fill="#252525" stroke="#383838" strokeWidth="2" />
        {/* Brazo derecho */}
        <rect x="772" y="344" width="26" height="228" rx="3" fill="#252525" stroke="#383838" strokeWidth="2" />

        {/* Área de trabajo interior */}
        <rect x="328" y="370" width="444" height="202" fill="#0e0e0e" stroke="#1e1e1e" strokeWidth="1" strokeDasharray="8,6" />
        <text x="550" y="463" textAnchor="middle" fill="#1e1e1e" fontSize="28" fontFamily="sans-serif">☕</text>
        <text x="550" y="490" textAnchor="middle" fill="#1e1e1e" fontSize="10" fontFamily="monospace" letterSpacing="2">ÁREA DE TRABAJO</text>

        {/* ── MESAS CUADRADAS (diamante) ── */}
        <Diamond n="Mesa 1" />
        <Diamond n="Mesa 2" />
        <Diamond n="Mesa 3" />
        <Diamond n="Mesa 4" />

        {/* ── MESAS RECTANGULARES ── */}
        <RectV n="Mesa 5" />
        <RectV n="Mesa 6" />

        {/* ── ASIENTOS DE BARRA — frente al mostrador (B1-B5) ── */}
        <Seat n="B1" />
        <Seat n="B2" />
        <Seat n="B3" />
        <Seat n="B4" />
        <Seat n="B5" />

        {/* ── ASIENTOS — lado izquierdo (B6-B9) ── */}
        <Seat n="B6" />
        <Seat n="B7" />
        <Seat n="B8" />
        <Seat n="B9" />

        {/* ── ASIENTOS — lado derecho (B10-B12) ── */}
        <Seat n="B10" />
        <Seat n="B11" />
        <Seat n="B12" />
      </svg>

      {/* Modal renombrar mesa */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setEditando(null)}>
          <div className="w-72 p-5 flex flex-col gap-3" onClick={e => e.stopPropagation()}
            style={{ background: 'var(--charcoal)', border: '2px solid var(--yellow)', borderRadius: 0 }}>
            <p className="font-black text-sm uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>✏️ Renombrar</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Actual: <b style={{ color: 'var(--text)' }}>{editando.mesa.nombre}</b>
            </p>
            <input
              autoFocus
              value={editando.nuevoNombre}
              onChange={e => setEditando(prev => prev ? { ...prev, nuevoNombre: e.target.value } : null)}
              onKeyDown={e => { if (e.key === 'Enter') guardarNombre(); if (e.key === 'Escape') setEditando(null) }}
              className="w-full px-3 py-2 font-black text-sm"
              style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 0 }}
              placeholder="Nuevo nombre..."
            />
            <div className="flex gap-2">
              <button onClick={() => setEditando(null)} className="flex-1 py-2 text-xs font-black uppercase"
                style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 0 }}>
                Cancelar
              </button>
              <button onClick={guardarNombre} disabled={guardando} className="flex-1 py-2 text-xs font-black uppercase"
                style={{ background: 'var(--yellow)', border: '2px solid var(--yellow)', color: '#000', cursor: 'pointer', borderRadius: 0 }}>
                {guardando ? '...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
