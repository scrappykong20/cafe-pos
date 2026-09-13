import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import type { CajeroActivo } from '../App'

interface Props { cajero: CajeroActivo; onVolver: () => void }
interface MenuItem {
  id: string
  nombre: string
  descripcion: string | null
  emoji: string | null
  categoria: string
  precio: number
  disponible: boolean
  destaque: boolean
  orden: number
  imagen_url: string | null
  alergenos: string[] | null
  tiempo_prep: number | null
  calorias: number | null
}
interface GrupoModificador {
  id: string
  nombre: string
  requerido: boolean
  max_seleccion: number
}

const CATEGORIAS_DEFECTO = ['Cafés', 'Tés', 'Frías', 'Comida', 'Postres', 'Extras']
const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const EMOJIS_RAPIDOS = ['☕', '🍵', '🧋', '🥐', '🍰', '🧁', '🍫', '🥤', '🧃', '🍹', '🥗', '🥪', '🍩', '🍪', '🧇', '🥞', '🍳', '🫖', '🧊', '🍦']

export default function MenuEditorPage({ cajero: _cajero, onVolver }: Props) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_DEFECTO)
  const [filtroCat, setFiltroCat] = useState<string>('all')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<MenuItem | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [eliminarId, setEliminarId] = useState<string | null>(null)

  // Grupos de modificadores
  const [grupos, setGrupos] = useState<GrupoModificador[]>([])
  const [gruposSeleccionados, setGruposSeleccionados] = useState<Set<string>>(new Set())

  // Form state
  const [fNombre, setFNombre] = useState('')
  const [fDescripcion, setFDescripcion] = useState('')
  const [fEmoji, setFEmoji] = useState('☕')
  const [fCategoria, setFCategoria] = useState('')
  const [fNuevaCategoria, setFNuevaCategoria] = useState('')
  const [fPrecio, setFPrecio] = useState('')
  const [fDisponible, setFDisponible] = useState(true)
  const [fDestaque, setFDestaque] = useState(false)
  const [fTiempoPrep, setFTiempoPrep] = useState('')
  const [fCalorias, setFCalorias] = useState('')
  const [fAlergenos, setFAlergenos] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [nuevaCatMode, setNuevaCatMode] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { cargar(); cargarGrupos() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('menu').select('*').order('categoria').order('orden')
      if (error) { toast.error('Error al cargar menú'); return }
      const menu = (data as MenuItem[]) ?? []
      setItems(menu)
      const cats = [...new Set(menu.map(m => m.categoria))].filter(Boolean)
      if (cats.length > 0) setCategorias([...new Set([...CATEGORIAS_DEFECTO, ...cats])])
    } catch {
      // error de red
    } finally {
      setLoading(false)
    }
  }

  async function cargarGrupos() {
    const { data, error } = await supabase
      .from('modificadores_grupo')
      .select('id, nombre, requerido, max_seleccion')
      .order('orden')
    if (error) { toast.error('Error al cargar grupos'); return }
    setGrupos((data as GrupoModificador[]) ?? [])
  }

  async function cargarGruposDeProducto(menuId: string) {
    const { data, error } = await supabase
      .from('menu_modificadores')
      .select('grupo_id')
      .eq('menu_id', menuId)
    if (error) { return }
    const ids = new Set((data ?? []).map((r: any) => r.grupo_id as string))
    setGruposSeleccionados(ids)
  }

  function toggleGrupo(grupoId: string) {
    setGruposSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(grupoId)) next.delete(grupoId)
      else next.add(grupoId)
      return next
    })
  }

  function abrirNuevo() {
    setEditItem(null)
    setFNombre(''); setFDescripcion(''); setFEmoji('☕')
    setFCategoria(categorias[0] ?? ''); setFNuevaCategoria('')
    setFPrecio(''); setFDisponible(true); setFDestaque(false)
    setFTiempoPrep(''); setFCalorias(''); setFAlergenos('')
    setNuevaCatMode(false)
    setGruposSeleccionados(new Set())
    setShowForm(true)
  }

  async function abrirEditar(item: MenuItem) {
    setEditItem(item)
    setFNombre(item.nombre)
    setFDescripcion(item.descripcion ?? '')
    setFEmoji(item.emoji ?? '☕')
    setFCategoria(item.categoria)
    setFNuevaCategoria('')
    setFPrecio(String(item.precio))
    setFDisponible(item.disponible)
    setFDestaque(item.destaque)
    setFAlergenos(item.alergenos ? item.alergenos.join(', ') : '')
    setFTiempoPrep(item.tiempo_prep != null ? String(item.tiempo_prep) : '')
    setFCalorias(item.calorias != null ? String(item.calorias) : '')
    setNuevaCatMode(false)
    await cargarGruposDeProducto(item.id)
    setShowForm(true)
  }

  async function guardar(e: React.FormEvent) {
    if (guardando) return
    e.preventDefault()
    const precio = parseFloat(fPrecio)
    if (!fNombre.trim() || isNaN(precio) || precio <= 0) return
    const catFinal = nuevaCatMode ? fNuevaCategoria.trim() : fCategoria
    if (!catFinal) return
    setGuardando(true)

    const payload: Partial<MenuItem> = {
      nombre: fNombre.trim(),
      descripcion: fDescripcion.trim() || null,
      emoji: fEmoji || '☕',
      categoria: catFinal,
      precio,
      disponible: fDisponible,
      destaque: fDestaque,
      alergenos: fAlergenos.trim() ? fAlergenos.split(',').map(a => a.trim()).filter(Boolean) : null,
      orden: editItem ? editItem.orden : (items.filter(i => i.categoria === catFinal).length + 1) * 10,
      tiempo_prep: fTiempoPrep ? parseInt(fTiempoPrep) : null,
      calorias: fCalorias ? parseInt(fCalorias) : null,
    }

    let menuId = editItem?.id ?? ''

    if (editItem) {
      const { error } = await supabase.from('menu').update(payload).eq('id', editItem.id)
      if (error) { toast.error('Error al actualizar producto'); setGuardando(false); return }
    } else {
      const { data, error } = await supabase.from('menu').insert(payload).select('id').single()
      if (error || !data) { toast.error('Error al crear producto'); setGuardando(false); return }
      menuId = data.id
    }

    // Guardar grupos de modificadores asignados
    const { error: delModErr } = await supabase.from('menu_modificadores').delete().eq('menu_id', menuId)
    if (delModErr) { toast.error('Error al actualizar modificadores'); setGuardando(false); return }
    if (gruposSeleccionados.size > 0) {
      const rows = Array.from(gruposSeleccionados).map(grupo_id => ({ menu_id: menuId, grupo_id }))
      const { error: insModErr } = await supabase.from('menu_modificadores').insert(rows)
      if (insModErr) { toast.error('Error al guardar modificadores'); setGuardando(false); return }
    }

    toast.success(editItem ? 'Producto actualizado' : 'Producto creado')
    setGuardando(false)
    setShowForm(false)
    cargar()
  }

  async function toggleDisponible(item: MenuItem) {
    const { error } = await supabase.from('menu').update({ disponible: !item.disponible }).eq('id', item.id)
    if (error) { toast.error('Error al cambiar disponibilidad'); return }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, disponible: !i.disponible } : i))
  }

  async function toggleDestaque(item: MenuItem) {
    const { error } = await supabase.from('menu').update({ destaque: !item.destaque }).eq('id', item.id)
    if (error) { toast.error('Error al cambiar destaque'); return }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, destaque: !i.destaque } : i))
  }

  const [eliminando, setEliminando] = useState(false)
  async function confirmarEliminar() {
    if (!eliminarId || eliminando) return
    setEliminando(true)
    try {
      const { error } = await supabase.from('menu').delete().eq('id', eliminarId)
      setEliminarId(null)
      if (error) { toast.error('Error al eliminar producto'); return }
      cargar()
    } finally {
      setEliminando(false)
    }
  }

  const itemsFiltrados = items.filter(i => {
    const matchCat = filtroCat === 'all' || i.categoria === filtroCat
    const matchBusq = !busqueda || i.nombre.toLowerCase().includes(busqueda.toLowerCase())
    return matchCat && matchBusq
  })

  const catCounts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.categoria] = (acc[i.categoria] ?? 0) + 1
    return acc
  }, {})

  const s = { background: 'var(--dark)', minHeight: '100vh' }
  const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.9rem', marginBottom: '0.5rem' }
  const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>🍽 Editor de Menú</h1>
          <button onClick={abrirNuevo} style={{ marginLeft: 'auto', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, padding: '0.5rem 1rem', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>+ Nuevo ítem</button>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {[
            { label: 'Total ítems', value: items.length, color: 'var(--text)' },
            { label: 'Disponibles', value: items.filter(i => i.disponible).length, color: '#22c55e' },
            { label: 'Pausados', value: items.filter(i => !i.disponible).length, color: '#ef4444' },
            { label: 'Destacados', value: items.filter(i => i.destaque).length, color: 'var(--yellow)' },
          ].map(stat => (
            <div key={stat.label} style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.5rem 0.75rem', flex: '1 1 auto', minWidth: 80 }}>
              <div style={{ color: stat.color, fontWeight: 900, fontSize: '1.2rem' }}>{stat.value}</div>
              <div style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <input
          ref={searchRef}
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar ítem..."
          style={{ ...inp, marginBottom: '0.75rem' }}
        />

        {/* Category filter tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
          <button onClick={() => setFiltroCat('all')} style={{ padding: '0.4rem 0.75rem', background: filtroCat === 'all' ? 'var(--yellow)' : 'var(--charcoal)', color: filtroCat === 'all' ? '#000' : 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Todos ({items.length})
          </button>
          {[...new Set(items.map(i => i.categoria))].map(cat => (
            <button key={cat} onClick={() => setFiltroCat(cat)} style={{ padding: '0.4rem 0.75rem', background: filtroCat === cat ? 'var(--yellow)' : 'var(--charcoal)', color: filtroCat === cat ? '#000' : 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {cat} ({catCounts[cat] ?? 0})
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem', fontWeight: 900 }}>Cargando menú...</div>
        ) : itemsFiltrados.length === 0 ? (
          <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>Sin ítems{busqueda ? ` para "${busqueda}"` : ''}</div>
        ) : (
          itemsFiltrados.map(item => (
            <div key={item.id} style={{ ...card, borderLeft: `4px solid ${item.disponible ? (item.destaque ? 'var(--yellow)' : '#22c55e') : '#4b5563'}`, opacity: item.disponible ? 1 : 0.65 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.75rem', flexShrink: 0 }}>{item.emoji ?? '☕'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.9rem' }}>{item.nombre}</span>
                    {item.destaque && <span style={{ background: 'rgba(240,168,0,0.15)', color: 'var(--yellow)', fontWeight: 900, fontSize: '0.5rem', padding: '0.1rem 0.4rem', borderRadius: 2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>★ Destaque</span>}
                    {!item.disponible && <span style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 900, fontSize: '0.5rem', padding: '0.1rem 0.4rem', borderRadius: 2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pausado</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem' }}>{fmt(item.precio)}</span>
                    <span style={{ color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', alignSelf: 'center' }}>{item.categoria}</span>
                  </div>
                  {item.descripcion && <div style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.descripcion}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                  <button onClick={() => abrirEditar(item)} style={{ padding: '0.3rem 0.55rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', cursor: 'pointer' }}>✏️</button>
                  <button onClick={() => toggleDisponible(item)} style={{ padding: '0.3rem 0.55rem', background: item.disponible ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', border: `1px solid ${item.disponible ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 2, color: item.disponible ? '#ef4444' : '#22c55e', fontWeight: 900, fontSize: '0.55rem', cursor: 'pointer' }}>
                    {item.disponible ? 'Pausar' : 'Activar'}
                  </button>
                  <button onClick={() => toggleDestaque(item)} style={{ padding: '0.3rem 0.55rem', background: item.destaque ? 'rgba(240,168,0,0.15)' : 'var(--dark)', border: `1px solid ${item.destaque ? 'var(--yellow)' : 'var(--border)'}`, borderRadius: 2, color: item.destaque ? 'var(--yellow)' : 'var(--muted)', fontWeight: 900, fontSize: '0.6rem', cursor: 'pointer' }}>★</button>
                  <button onClick={() => setEliminarId(item.id)} style={{ padding: '0.3rem 0.55rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 2, color: 'rgba(239,68,68,0.6)', fontWeight: 900, fontSize: '0.6rem', cursor: 'pointer' }}>🗑</button>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Modal form */}
        {showForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }} onClick={() => setShowForm(false)}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', borderRadius: 2, padding: '1.5rem', width: '100%', maxWidth: 480, margin: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>{editItem ? '✏️ Editar' : '+ Nuevo'} Ítem</div>
              <form onSubmit={guardar}>
                {/* Emoji selector */}
                <div style={{ marginBottom: '0.6rem' }}>
                  <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Emoji</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button type="button" onClick={() => setShowEmojiPicker(p => !p)} style={{ fontSize: '1.75rem', padding: '0.3rem 0.6rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer' }}>{fEmoji}</button>
                    {showEmojiPicker && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.5rem', maxWidth: 220 }}>
                        {EMOJIS_RAPIDOS.map(em => (
                          <button key={em} type="button" onClick={() => { setFEmoji(em); setShowEmojiPicker(false) }} style={{ fontSize: '1.2rem', padding: '0.2rem', background: 'none', border: 'none', cursor: 'pointer' }}>{em}</button>
                        ))}
                      </div>
                    )}
                    <input value={fEmoji} onChange={e => setFEmoji(e.target.value)} style={{ ...inp, marginBottom: 0, width: 60, textAlign: 'center', fontSize: '1.1rem' }} maxLength={2} />
                  </div>
                </div>

                <input value={fNombre} onChange={e => setFNombre(e.target.value)} placeholder="Nombre del ítem *" required style={inp} />

                <input value={fDescripcion} onChange={e => setFDescripcion(e.target.value)} placeholder="Descripción (opcional)" style={inp} />

                {/* Categoría */}
                <div style={{ marginBottom: '0.6rem' }}>
                  <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Categoría</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!nuevaCatMode ? (
                      <select value={fCategoria} onChange={e => setFCategoria(e.target.value)} style={{ ...inp, marginBottom: 0, flex: 1 }}>
                        {[...new Set([...categorias, ...items.map(i => i.categoria)])].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input value={fNuevaCategoria} onChange={e => setFNuevaCategoria(e.target.value)} placeholder="Nueva categoría..." style={{ ...inp, marginBottom: 0, flex: 1 }} />
                    )}
                    <button type="button" onClick={() => setNuevaCatMode(p => !p)} style={{ padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>{nuevaCatMode ? '← Lista' : '+ Nueva'}</button>
                  </div>
                </div>

                <input type="number" min="0.01" step="0.01" value={fPrecio} onChange={e => setFPrecio(e.target.value)} placeholder="Precio *" required style={inp} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Tiempo prep (min)</label>
                    <input type="number" min="1" value={fTiempoPrep} onChange={e => setFTiempoPrep(e.target.value)} placeholder="5" style={{ ...inp, marginBottom: 0 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.3rem' }}>Calorías (kcal)</label>
                    <input type="number" min="0" value={fCalorias} onChange={e => setFCalorias(e.target.value)} placeholder="150" style={{ ...inp, marginBottom: 0 }} />
                  </div>
                </div>

                <input value={fAlergenos} onChange={e => setFAlergenos(e.target.value)} placeholder="Alérgenos: gluten, lactosa... (separados por coma)" style={inp} />

                {/* Grupos de modificadores */}
                {grupos.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 900, marginBottom: '0.5rem' }}>
                      Grupos de modificadores
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.6rem' }}>
                      {grupos.map(g => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleGrupo(g.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.4rem 0.6rem',
                            background: gruposSeleccionados.has(g.id) ? 'rgba(240,168,0,0.12)' : 'transparent',
                            border: `1px solid ${gruposSeleccionados.has(g.id) ? 'var(--yellow)' : 'var(--border)'}`,
                            borderRadius: 2, cursor: 'pointer', textAlign: 'left', width: '100%'
                          }}
                        >
                          <span style={{ fontSize: '0.85rem' }}>{gruposSeleccionados.has(g.id) ? '☑' : '☐'}</span>
                          <span style={{ color: gruposSeleccionados.has(g.id) ? 'var(--yellow)' : 'var(--muted)', fontWeight: 900, fontSize: '0.75rem' }}>{g.nombre}</span>
                          {g.requerido && <span style={{ marginLeft: 'auto', color: '#ef4444', fontSize: '0.55rem', fontWeight: 900, textTransform: 'uppercase' }}>Requerido</span>}
                        </button>
                      ))}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.58rem', marginTop: '0.3rem' }}>
                      Selecciona qué modificadores se preguntarán al ordenar este producto
                    </div>
                  </div>
                )}

                {/* Toggles */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <button type="button" onClick={() => setFDisponible(p => !p)} style={{ flex: 1, padding: '0.55rem', background: fDisponible ? 'rgba(34,197,94,0.15)' : 'var(--dark)', color: fDisponible ? '#22c55e' : 'var(--muted)', border: `1px solid ${fDisponible ? '#22c55e' : 'var(--border)'}`, borderRadius: 2, fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {fDisponible ? '✓ Disponible' : 'Pausado'}
                  </button>
                  <button type="button" onClick={() => setFDestaque(p => !p)} style={{ flex: 1, padding: '0.55rem', background: fDestaque ? 'rgba(240,168,0,0.15)' : 'var(--dark)', color: fDestaque ? 'var(--yellow)' : 'var(--muted)', border: `1px solid ${fDestaque ? 'var(--yellow)' : 'var(--border)'}`, borderRadius: 2, fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {fDestaque ? '★ Destacado' : '☆ Sin destaque'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                  <button type="submit" disabled={guardando} style={{ flex: 1, padding: '0.65rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {guardando ? 'Guardando...' : editItem ? 'Actualizar' : 'Crear'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmar eliminar */}
      {eliminarId && (() => {
        const item = items.find(i => i.id === eliminarId)
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #ef4444', padding: '1.5rem', maxWidth: 360, width: '90%' }}>
              <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.5rem' }}>
                🗑 Eliminar producto
              </p>
              <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: '0 0 1.25rem' }}>
                ¿Eliminar <strong style={{ color: 'var(--text)' }}>{item?.nombre}</strong>? Esta acción no se puede deshacer.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setEliminarId(null)} style={{ flex: 1, padding: '0.6rem', background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2 }}>Cancelar</button>
                <button onClick={confirmarEliminar} disabled={eliminando} style={{ flex: 1, padding: '0.6rem', background: '#ef4444', border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: eliminando ? 'not-allowed' : 'pointer', borderRadius: 2, opacity: eliminando ? 0.6 : 1 }}>{eliminando ? 'Eliminando...' : 'Eliminar'}</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
