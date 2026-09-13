import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

interface Props {
  cajero: { nombre: string; es_admin: boolean }
  onVolver: () => void
}

interface Grupo {
  id: string
  nombre: string
  requerido: boolean
  min_seleccion: number
  max_seleccion: number
  orden: number
}

interface Opcion {
  id: string
  grupo_id: string
  nombre: string
  precio_extra: number
  disponible: boolean
  orden: number
}

const s = { background: 'var(--dark)', minHeight: '100vh', fontFamily: 'inherit' }
const card = { background: 'var(--charcoal)', border: '1px solid var(--border)', borderRadius: 2, padding: '1.25rem', marginBottom: '1rem' }
const inp = { width: '100%', padding: '0.6rem 0.75rem', background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.6rem', boxSizing: 'border-box' as const, outline: 'none' }
const labelStyle = { display: 'block', color: 'var(--muted)', fontSize: '0.62rem', letterSpacing: '0.2em', textTransform: 'uppercase' as const, fontWeight: 900, marginBottom: '0.3rem' }

export default function ModificadoresAdminPage({ cajero, onVolver }: Props) {
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [loading, setLoading] = useState(true)
  const [tablaNoExiste, setTablaNoExiste] = useState(false)

  // Estado para expandir grupos
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  // Formulario nuevo grupo
  const [showNuevoGrupo, setShowNuevoGrupo] = useState(false)
  const [gNombre, setGNombre] = useState('')
  const [gRequerido, setGRequerido] = useState(false)
  const [gMin, setGMin] = useState('0')
  const [gMax, setGMax] = useState('1')
  const [guardandoGrupo, setGuardandoGrupo] = useState(false)

  // Formulario nueva opción por grupo
  const [showNuevaOpcion, setShowNuevaOpcion] = useState<string | null>(null) // grupo_id
  const [oNombre, setONombre] = useState('')
  const [oPrecio, setOPrecio] = useState('0')
  const [oDisponible, setODisponible] = useState(true)
  const [guardandoOpcion, setGuardandoOpcion] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const { data: gData, error: gError } = await supabase
        .from('modificadores_grupo')
        .select('*')
        .order('orden', { ascending: true })

      if (gError) {
        if ((gError as any).code === '42P01') {
          setTablaNoExiste(true)
          return
        }
        toast.error('Error cargando grupos')
        return
      }

      const { data: oData, error: oError } = await supabase
        .from('modificadores_opcion')
        .select('*')
        .order('orden', { ascending: true })

      if (oError && (oError as any).code === '42P01') {
        setTablaNoExiste(true)
        return
      }

      setGrupos((gData as Grupo[]) ?? [])
      setOpciones((oData as Opcion[]) ?? [])
    } catch {
      toast.error('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  function toggleExpandir(id: string) {
    setExpandidos(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  async function crearGrupo(e: React.FormEvent) {
    e.preventDefault()
    if (!cajero.es_admin) { toast.error('Solo admins pueden crear grupos'); return }
    if (!gNombre.trim()) return
    setGuardandoGrupo(true)
    try {
      const { error } = await supabase.from('modificadores_grupo').insert({
        nombre: gNombre.trim(),
        requerido: gRequerido,
        min_seleccion: parseInt(gMin) || 0,
        max_seleccion: parseInt(gMax) || 1,
        orden: grupos.length,
      })
      if (error) { toast.error('Error al crear grupo'); return }
      setGNombre(''); setGRequerido(false); setGMin('0'); setGMax('1')
      setShowNuevoGrupo(false)
      cargar()
    } catch {
      toast.error('Error de conexión')
    } finally {
      setGuardandoGrupo(false)
    }
  }

  async function eliminarGrupo(id: string) {
    if (!cajero.es_admin) { toast.error('Solo admins pueden eliminar grupos'); return }
    if (!confirm('¿Eliminar este grupo y todas sus opciones?')) return
    const { error: errOpciones } = await supabase.from('modificadores_opcion').delete().eq('grupo_id', id)
    if (errOpciones) { toast.error('Error al eliminar opciones del grupo'); return }
    const { error: errGrupo } = await supabase.from('modificadores_grupo').delete().eq('id', id)
    if (errGrupo) { toast.error('Error al eliminar grupo'); return }
    cargar()
  }

  async function crearOpcion(e: React.FormEvent, grupoId: string) {
    e.preventDefault()
    if (!cajero.es_admin) { toast.error('Solo admins pueden agregar opciones'); return }
    if (!oNombre.trim()) return
    setGuardandoOpcion(true)
    try {
      const opcsDelGrupo = opciones.filter(o => o.grupo_id === grupoId)
      const { error } = await supabase.from('modificadores_opcion').insert({
        grupo_id: grupoId,
        nombre: oNombre.trim(),
        precio_extra: parseFloat(oPrecio) || 0,
        disponible: oDisponible,
        orden: opcsDelGrupo.length,
      })
      if (error) { toast.error('Error al crear opción'); return }
      setONombre(''); setOPrecio('0'); setODisponible(true)
      setShowNuevaOpcion(null)
      cargar()
    } catch {
      toast.error('Error de conexión')
    } finally {
      setGuardandoOpcion(false)
    }
  }

  async function toggleDisponible(opcion: Opcion) {
    if (!cajero.es_admin) return
    const { error } = await supabase.from('modificadores_opcion').update({ disponible: !opcion.disponible }).eq('id', opcion.id)
    if (error) { toast.error('Error al cambiar disponibilidad'); return }
    cargar()
  }

  async function eliminarOpcion(id: string) {
    if (!cajero.es_admin) { toast.error('Solo admins pueden eliminar opciones'); return }
    if (!confirm('¿Eliminar esta opción?')) return
    const { error } = await supabase.from('modificadores_opcion').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar opción'); return }
    cargar()
  }

  const fmt = (n: number) => n === 0 ? 'Gratis' : `+$${n.toFixed(2)}`

  if (loading) {
    return (
      <div style={s}>
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem', fontWeight: 900 }}>Cargando...</div>
        </div>
      </div>
    )
  }

  if (tablaNoExiste) {
    return (
      <div style={s}>
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
            <h1 style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>// Modificadores</h1>
          </div>
          <div style={{ ...card, borderLeft: '4px solid #f59e0b' }}>
            <p style={{ color: '#f59e0b', fontWeight: 900, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Tablas no configuradas</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
              Las tablas <code style={{ color: 'var(--yellow)' }}>modificadores_grupo</code> y <code style={{ color: 'var(--yellow)' }}>modificadores_opcion</code> no existen aún en la base de datos. Créalas en Supabase para usar esta sección.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={onVolver} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '0.4rem 0.75rem', color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>← Volver</button>
          <div>
            <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>// Modificadores</p>
            <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>Grupos de modificadores</h1>
          </div>
          {cajero.es_admin && (
            <button
              onClick={() => { setShowNuevoGrupo(v => !v); setShowNuevaOpcion(null) }}
              style={{ marginLeft: 'auto', background: showNuevoGrupo ? 'var(--dark)' : 'var(--yellow)', color: showNuevoGrupo ? 'var(--muted)' : '#000', border: '1px solid var(--border)', borderRadius: 2, padding: '0.5rem 1rem', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              {showNuevoGrupo ? '✕ Cancelar' : '➕ Nuevo grupo'}
            </button>
          )}
        </div>

        {/* Formulario nuevo grupo */}
        {showNuevoGrupo && (
          <div style={{ ...card, borderLeft: '4px solid var(--yellow)', marginBottom: '1.5rem' }}>
            <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Nuevo grupo</div>
            <form onSubmit={crearGrupo}>
              <label style={labelStyle}>Nombre del grupo</label>
              <input value={gNombre} onChange={e => setGNombre(e.target.value)} placeholder="Ej: Temperatura, Tamaño, Extras..." style={inp} required />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
                <div>
                  <label style={labelStyle}>Mín. selecciones</label>
                  <input type="number" min="0" value={gMin} onChange={e => setGMin(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                </div>
                <div>
                  <label style={labelStyle}>Máx. selecciones</label>
                  <input type="number" min="1" value={gMax} onChange={e => setGMax(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <label style={labelStyle}>Requerido</label>
                  <button
                    type="button"
                    onClick={() => setGRequerido(v => !v)}
                    style={{ padding: '0.6rem 0.75rem', background: gRequerido ? '#22c55e22' : 'var(--dark)', border: `1px solid ${gRequerido ? '#22c55e' : 'var(--border)'}`, borderRadius: 2, color: gRequerido ? '#22c55e' : 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center' }}
                  >
                    {gRequerido ? 'Sí' : 'No'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button type="button" onClick={() => setShowNuevoGrupo(false)} style={{ flex: 1, padding: '0.65rem', background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardandoGrupo || !gNombre.trim()} style={{ flex: 1, padding: '0.65rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', cursor: guardandoGrupo ? 'not-allowed' : 'pointer', opacity: guardandoGrupo ? 0.6 : 1 }}>
                  {guardandoGrupo ? 'Guardando...' : 'Crear grupo'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Lista de grupos */}
        {grupos.length === 0 ? (
          <div style={{ ...card, color: 'var(--muted)', textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 900 }}>Sin grupos de modificadores</p>
            <p style={{ fontSize: '0.75rem', marginTop: '0.4rem' }}>Crea un grupo como "Temperatura" o "Tamaño"</p>
          </div>
        ) : grupos.map(grupo => {
          const opcsDelGrupo = opciones.filter(o => o.grupo_id === grupo.id)
          const expandido = expandidos.has(grupo.id)
          const mostrandoFormOpcion = showNuevaOpcion === grupo.id

          return (
            <div key={grupo.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
              {/* Cabecera del grupo */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', cursor: 'pointer', borderBottom: expandido ? '1px solid var(--border)' : 'none' }}
                onClick={() => toggleExpandir(grupo.id)}
              >
                <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1rem', userSelect: 'none' }}>{expandido ? '▾' : '▸'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontWeight: 900, fontSize: '0.95rem' }}>{grupo.nombre}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 900, marginTop: '0.15rem', display: 'flex', gap: '0.75rem' }}>
                    <span style={{ color: grupo.requerido ? '#22c55e' : 'var(--muted)' }}>{grupo.requerido ? 'Requerido' : 'Opcional'}</span>
                    <span>Min: {grupo.min_seleccion}</span>
                    <span>Máx: {grupo.max_seleccion}</span>
                    <span style={{ color: 'var(--muted)' }}>{opcsDelGrupo.length} opcion{opcsDelGrupo.length !== 1 ? 'es' : ''}</span>
                  </div>
                </div>
                {cajero.es_admin && (
                  <button
                    onClick={e => { e.stopPropagation(); eliminarGrupo(grupo.id) }}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 2, color: '#ef4444', padding: '0.3rem 0.6rem', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer' }}
                  >✕</button>
                )}
              </div>

              {/* Opciones del grupo (expandido) */}
              {expandido && (
                <div style={{ padding: '0.75rem 1.25rem 1rem' }}>
                  {opcsDelGrupo.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: '0.78rem', fontWeight: 700, padding: '0.75rem 0', textAlign: 'center' }}>
                      Sin opciones. Agrega la primera.
                    </div>
                  ) : (
                    <div style={{ marginBottom: '0.75rem' }}>
                      {opcsDelGrupo.map(op => (
                        <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.85rem' }}>{op.nombre}</span>
                            <span style={{ color: op.precio_extra > 0 ? '#22c55e' : 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', marginLeft: '0.6rem' }}>{fmt(op.precio_extra)}</span>
                          </div>
                          {cajero.es_admin && (
                            <>
                              <button
                                onClick={() => toggleDisponible(op)}
                                title={op.disponible ? 'Disponible — clic para desactivar' : 'No disponible — clic para activar'}
                                style={{ padding: '0.25rem 0.6rem', background: op.disponible ? '#22c55e22' : 'rgba(239,68,68,0.1)', border: `1px solid ${op.disponible ? '#22c55e55' : 'rgba(239,68,68,0.3)'}`, borderRadius: 2, color: op.disponible ? '#22c55e' : '#ef4444', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                              >
                                {op.disponible ? 'Disponible' : 'No disponible'}
                              </button>
                              <button
                                onClick={() => eliminarOpcion(op.id)}
                                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 2, color: '#ef4444', padding: '0.25rem 0.5rem', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer' }}
                              >✕</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Formulario nueva opción */}
                  {cajero.es_admin && (
                    <>
                      {mostrandoFormOpcion ? (
                        <form onSubmit={e => crearOpcion(e, grupo.id)} style={{ background: 'var(--dark)', border: '1px solid var(--border)', borderRadius: 2, padding: '0.75rem', marginTop: '0.5rem' }}>
                          <div style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Nueva opción</div>
                          <label style={labelStyle}>Nombre</label>
                          <input value={oNombre} onChange={e => setONombre(e.target.value)} placeholder="Ej: Caliente, Grande, Doble shot..." style={{ ...inp, fontSize: '0.85rem' }} required />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                            <div>
                              <label style={labelStyle}>Precio adicional ($)</label>
                              <input type="number" min="0" step="0.01" value={oPrecio} onChange={e => setOPrecio(e.target.value)} placeholder="0.00" style={{ ...inp, marginBottom: 0, fontSize: '0.85rem' }} />
                            </div>
                            <div style={{ marginBottom: '0.6rem' }}>
                              <label style={labelStyle}>Disponible</label>
                              <button
                                type="button"
                                onClick={() => setODisponible(v => !v)}
                                style={{ padding: '0.58rem 0.75rem', background: oDisponible ? '#22c55e22' : 'var(--dark)', border: `1px solid ${oDisponible ? '#22c55e' : 'var(--border)'}`, borderRadius: 2, color: oDisponible ? '#22c55e' : 'var(--muted)', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                {oDisponible ? 'Sí' : 'No'}
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <button type="button" onClick={() => { setShowNuevaOpcion(null); setONombre(''); setOPrecio('0'); setODisponible(true) }} style={{ flex: 1, padding: '0.5rem', background: 'var(--charcoal)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', cursor: 'pointer' }}>Cancelar</button>
                            <button type="submit" disabled={guardandoOpcion || !oNombre.trim()} style={{ flex: 1, padding: '0.5rem', background: 'var(--yellow)', color: '#000', border: 'none', borderRadius: 2, fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', cursor: guardandoOpcion ? 'not-allowed' : 'pointer', opacity: guardandoOpcion ? 0.6 : 1 }}>
                              {guardandoOpcion ? 'Guardando...' : 'Agregar'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          onClick={() => { setShowNuevaOpcion(grupo.id); setShowNuevoGrupo(false); setONombre(''); setOPrecio('0'); setODisponible(true) }}
                          style={{ marginTop: '0.25rem', padding: '0.4rem 0.75rem', background: 'none', border: '1px dashed var(--border)', borderRadius: 2, color: 'var(--muted)', fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', width: '100%' }}
                        >
                          ➕ Agregar opción
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
