import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

interface Opcion {
  id: string
  nombre: string
  precio_extra: number
  disponible: boolean
}

interface Grupo {
  id: string
  nombre: string
  descripcion: string | null
  requerido: boolean
  multiple: boolean
  min_seleccion: number
  max_seleccion: number
  opciones: Opcion[]
}

interface Producto {
  id: string
  nombre: string
  emoji: string
  precio: number
  descripcion: string
}

interface Props {
  producto: Producto
  accentColor: string
  onConfirmar: (precio: number, notas: string, selecciones: Record<string, string[]>) => void
  onCerrar: () => void
}

export default function ModificadoresModal({ producto, accentColor, onConfirmar, onCerrar }: Props) {
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loading, setLoading] = useState(true)
  // selecciones: grupoId → lista de opcionId seleccionados
  const [selecciones, setSelecciones] = useState<Record<string, string[]>>({})
  const [cantidad, setCantidad] = useState(1)
  const [instrucciones, setInstrucciones] = useState('')

  useEffect(() => {
    cargarModificadores()
  }, [])

  async function cargarModificadores() {
    // 1. Obtener grupos vinculados a este producto
    const { data: links, error: linksError } = await supabase
      .from('menu_modificadores')
      .select('grupo_id')
      .eq('menu_id', producto.id)

    if (linksError) { console.error('Error cargando modificadores:', linksError); setLoading(false); return }

    if (!links || links.length === 0) {
      setGrupos([])
      setLoading(false)
      return
    }

    const grupoIds = links.map((l: any) => l.grupo_id)

    // 2. Obtener los grupos con sus opciones
    const { data: gruposData, error: gruposError } = await supabase
      .from('modificadores_grupo')
      .select('id, nombre, descripcion, requerido, multiple, min_seleccion, max_seleccion')
      .in('id', grupoIds)
      .eq('activo', true)
      .order('orden')

    if (gruposError) { console.error('Error cargando grupos de modificadores:', gruposError); setLoading(false); return }
    if (!gruposData) { setLoading(false); return }

    const { data: opcionesData, error: opcionesError } = await supabase
      .from('modificadores_opcion')
      .select('id, grupo_id, nombre, precio_extra, disponible, orden')
      .in('grupo_id', grupoIds)
      .eq('disponible', true)
      .order('orden')

    if (opcionesError) { console.error('Error cargando opciones de modificadores:', opcionesError); setLoading(false); return }

    const gruposCompletos: Grupo[] = gruposData.map((g: any) => ({
      ...g,
      opciones: (opcionesData ?? []).filter((o: any) => o.grupo_id === g.id),
    }))

    setGrupos(gruposCompletos)

    // Pre-seleccionar defaults
    const defaults: Record<string, string[]> = {}
    for (const g of gruposCompletos) {
      if (g.opciones.length === 0) continue
      // Tamaño: por defecto la opción más pequeña (primera en orden)
      if (g.nombre.toLowerCase().includes('tama')) {
        defaults[g.id] = [g.opciones[0].id]
      } else if (g.requerido && !g.multiple && g.min_seleccion > 0) {
        // Cualquier grupo requerido sin múltiple: seleccionar la primera opción gratis o primera disponible
        const gratis = g.opciones.find(o => o.precio_extra === 0)
        defaults[g.id] = [(gratis ?? g.opciones[0]).id]
      }
    }
    setSelecciones(defaults)
    setLoading(false)
  }

  function toggleOpcion(grupo: Grupo, opcionId: string) {
    setSelecciones(prev => {
      const actual = prev[grupo.id] ?? []
      if (grupo.multiple) {
        // Multi-select
        if (actual.includes(opcionId)) {
          return { ...prev, [grupo.id]: actual.filter(id => id !== opcionId) }
        }
        if (grupo.max_seleccion > 0 && actual.length >= grupo.max_seleccion) return prev
        return { ...prev, [grupo.id]: [...actual, opcionId] }
      } else {
        // Single select — deselect if same
        if (actual[0] === opcionId && !grupo.requerido) return { ...prev, [grupo.id]: [] }
        return { ...prev, [grupo.id]: [opcionId] }
      }
    })
  }

  // Calcular precio extra total
  const extraTotal = grupos.reduce((sum, g) => {
    const sel = selecciones[g.id] ?? []
    return sum + g.opciones.filter(o => sel.includes(o.id)).reduce((s, o) => s + Number(o.precio_extra), 0)
  }, 0)

  const precioUnitario = producto.precio + extraTotal
  const precioTotal = precioUnitario * cantidad

  // Verificar que grupos requeridos estén seleccionados
  const puedeConfirmar = grupos
    .filter(g => g.requerido)
    .every(g => (selecciones[g.id] ?? []).length >= (g.min_seleccion || 1))

  function confirmar() {
    // Construir texto de notas con las selecciones
    const partes: string[] = []
    for (const g of grupos) {
      const sel = selecciones[g.id] ?? []
      if (sel.length === 0) continue
      const nombres = g.opciones.filter(o => sel.includes(o.id)).map(o => o.nombre)
      partes.push(nombres.join(', '))
    }
    const notas = partes.join(' · ')

    // Append instrucciones especiales if provided
    const notasFinal = [notas, instrucciones.trim()].filter(Boolean).join(' · ')

    // Construir mapa nombre→[opciones] para pasar hacia arriba
    const selNombres: Record<string, string[]> = {}
    for (const g of grupos) {
      const sel = selecciones[g.id] ?? []
      if (sel.length === 0) continue
      selNombres[g.nombre] = g.opciones.filter(o => sel.includes(o.id)).map(o => o.nombre)
    }

    onConfirmar(precioUnitario, notasFinal, selNombres)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(3px)' }}
      onClick={onCerrar}
    >
      <div
        className="w-full sm:max-w-sm animate-slide-up flex flex-col"
        style={{
          background: 'var(--charcoal)',
          borderTop: `3px solid ${accentColor}`,
          maxHeight: '88dvh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3.5 shrink-0"
          style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{producto.emoji}</span>
              <div>
                <p className="font-black text-base leading-tight" style={{ color: 'var(--text)' }}>{producto.nombre}</p>
                {producto.descripcion && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{producto.descripcion}</p>
                )}
              </div>
            </div>
          </div>
          <button onClick={onCerrar} className="text-lg shrink-0 transition-colors"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <span className="text-2xl animate-gear inline-block">⚙️</span>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Cargando...</span>
            </div>
          ) : grupos.length === 0 ? null : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {grupos.map(grupo => {
                const sel = selecciones[grupo.id] ?? []
                return (
                  <div key={grupo.id} className="px-4 py-4">
                    {/* Grupo header */}
                    <div className="flex items-center gap-2 mb-3">
                      <p className="font-black text-xs uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                        {grupo.nombre}
                      </p>
                      {grupo.requerido && (
                        <span className="text-xs font-black px-1.5 py-0.5"
                          style={{ background: `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}50` }}>
                          Requerido
                        </span>
                      )}
                      {grupo.multiple && grupo.max_seleccion > 1 && (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          (máx {grupo.max_seleccion})
                        </span>
                      )}
                    </div>

                    {/* Opciones */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {grupo.opciones.map(opcion => {
                        const active = sel.includes(opcion.id)
                        const extraSign = opcion.precio_extra > 0 ? '+' : ''
                        return (
                          <button
                            key={opcion.id}
                            onClick={() => toggleOpcion(grupo, opcion.id)}
                            className="flex items-center justify-between px-3 py-2.5 text-left transition-all active:scale-95"
                            style={{
                              background: active ? `${accentColor}15` : 'var(--dark)',
                              border: `1.5px solid ${active ? accentColor : 'var(--border)'}`,
                              borderRadius: 0,
                            }}
                          >
                            <span className="text-xs font-bold leading-tight" style={{ color: active ? 'var(--text)' : 'var(--muted)' }}>
                              {active && <span style={{ color: accentColor }}>✓ </span>}
                              {opcion.nombre}
                            </span>
                            {opcion.precio_extra !== 0 && (
                              <span className="text-xs font-black ml-1 shrink-0"
                                style={{ color: opcion.precio_extra > 0 ? accentColor : '#22c55e' }}>
                                {extraSign}${Math.abs(opcion.precio_extra)}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Instrucciones especiales */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
              Instrucciones especiales
            </p>
            <input
              type="text"
              value={instrucciones}
              onChange={e => setInstrucciones(e.target.value)}
              placeholder="Ej: sin azúcar, extra caliente..."
              className="w-full px-3 py-2 text-sm"
              style={{
                background: 'var(--dark)', border: '1px solid var(--border)',
                color: 'var(--text)', outline: 'none',
              }}
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
        </div>

        {/* Footer: cantidad + precio + confirmar */}
        <div className="px-4 py-4 shrink-0 space-y-3"
          style={{ borderTop: '2px solid var(--border)', background: 'var(--dark)' }}>

          {/* Cantidad */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Cantidad</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setCantidad(c => Math.max(1, c - 1))}
                className="w-8 h-8 flex items-center justify-center font-black text-lg transition-all"
                style={{ background: 'var(--charcoal)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                −
              </button>
              <span className="font-black text-lg w-6 text-center" style={{ color: accentColor }}>{cantidad}</span>
              <button onClick={() => setCantidad(c => c + 1)}
                className="w-8 h-8 flex items-center justify-center font-black text-lg transition-all"
                style={{ background: 'var(--charcoal)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                +
              </button>
            </div>
          </div>

          {/* Precio desglosado */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                ${producto.precio.toFixed(2)}
                {extraTotal !== 0 && (
                  <span style={{ color: extraTotal > 0 ? accentColor : '#22c55e' }}>
                    {' '}{extraTotal > 0 ? '+' : ''}${extraTotal.toFixed(2)}
                  </span>
                )}
                {cantidad > 1 && (
                  <span style={{ color: 'var(--muted)' }}> × {cantidad}</span>
                )}
              </span>
            </div>
            <span className="font-black text-xl" style={{ color: 'var(--yellow)' }}>
              ${precioTotal.toFixed(2)}
            </span>
          </div>

          {/* Botón agregar */}
          <button
            onClick={confirmar}
            disabled={!puedeConfirmar}
            className="w-full font-black text-sm uppercase tracking-widest py-3.5 transition-all active:scale-95"
            style={{
              background: puedeConfirmar ? accentColor : 'var(--dark)',
              color: puedeConfirmar ? '#000' : 'var(--muted)',
              border: `2px solid ${puedeConfirmar ? accentColor : 'var(--border)'}`,
              opacity: puedeConfirmar ? 1 : 0.5,
              cursor: puedeConfirmar ? 'pointer' : 'not-allowed',
            }}
          >
            + Agregar {cantidad > 1 ? `${cantidad} ` : ''}al pedido
          </button>
        </div>
      </div>
    </div>
  )
}
