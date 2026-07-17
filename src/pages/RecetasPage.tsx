import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

interface MenuItem {
  id: string
  nombre: string
  emoji: string
  categoria: string
  precio: number
  disponible: boolean
}

interface IngredienteInventario {
  id: string
  nombre: string
  unidad: string
  stock_actual: number
}

interface InventarioRef {
  id: string
  nombre: string
  unidad: string
}

interface RecetaRow {
  id: string
  menu_id: string
  inventario_id: string
  cantidad_por_unidad: number
  // Supabase devuelve el join como array cuando es many-to-one via select()
  inventario: InventarioRef | InventarioRef[] | null
}

interface FormIngrediente {
  inventario_id: string
  cantidad: string
}

const CATEGORIA_LABELS: Record<string, string> = {
  cafe: 'CAFÉS',
  bebida_fria: 'BEBIDAS FRÍAS',
  panaderia: 'PANADERÍA',
  alimento: 'ALIMENTOS',
}

export default function RecetasPage({ cajero: _cajero, onVolver }: Props) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [ingredientes, setIngredientes] = useState<IngredienteInventario[]>([])
  const [recetas, setRecetas] = useState<Record<string, RecetaRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [tablaError, setTablaError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formAbierto, setFormAbierto] = useState<string | null>(null) // menu_id con form abierto
  const [form, setForm] = useState<FormIngrediente>({ inventario_id: '', cantidad: '' })
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState<string | null>(null) // receta id

  const cargarDatos = useCallback(async () => {
    setLoading(true)

    // Cargar menu
    const { data: menuData, error: menuError } = await supabase
      .from('menu')
      .select('id, nombre, emoji, categoria, precio, disponible')
      .order('categoria')
      .order('nombre')

    if (menuError) {
      setLoading(false)
      return
    }

    setMenuItems(menuData ?? [])

    // Cargar inventario (insumos)
    const { data: invData, error: invError } = await supabase
      .from('inventario')
      .select('id, nombre, unidad, stock_actual')
      .order('nombre')

    if (!invError) {
      setIngredientes(invData ?? [])
    }

    // Cargar recetas con JOIN a inventario
    const { data: recetaData, error: recetaError } = await supabase
      .from('recetas')
      .select('id, menu_id, inventario_id, cantidad_por_unidad, inventario(id, nombre, unidad)')

    if (recetaError) {
      const code = (recetaError as { code?: string }).code
      if (code === '42P01') {
        setTablaError(true)
      }
      setLoading(false)
      return
    }

    setTablaError(false)

    // Agrupar recetas por menu_id
    const agrupadas: Record<string, RecetaRow[]> = {}
    ;(recetaData as unknown as RecetaRow[] ?? []).forEach((r: RecetaRow) => {
      if (!agrupadas[r.menu_id]) agrupadas[r.menu_id] = []
      agrupadas[r.menu_id].push(r)
    })
    setRecetas(agrupadas)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  async function recargarRecetasDeProducto(menuItemId: string) {
    const { data, error } = await supabase
      .from('recetas')
      .select('id, menu_id, inventario_id, cantidad_por_unidad, inventario(id, nombre, unidad)')
      .eq('menu_id', menuItemId)

    if (error) return

    setRecetas(prev => ({
      ...prev,
      [menuItemId]: (data as unknown as RecetaRow[]) ?? [],
    }))
  }

  async function guardarIngrediente(menuItemId: string) {
    if (!form.inventario_id || !form.cantidad) return
    const cantidad = parseFloat(form.cantidad)
    if (isNaN(cantidad) || cantidad <= 0) return

    setGuardando(true)
    const { error } = await supabase.from('recetas').insert({
      menu_id: menuItemId,
      inventario_id: form.inventario_id,
      cantidad_por_unidad: cantidad,
    })

    if (!error) {
      await recargarRecetasDeProducto(menuItemId)
      setFormAbierto(null)
      setForm({ inventario_id: '', cantidad: '' })
    }
    setGuardando(false)
  }

  async function eliminarIngrediente(recetaId: string, menuItemId: string) {
    setEliminando(recetaId)
    const { error } = await supabase.from('recetas').delete().eq('id', recetaId)
    if (!error) {
      await recargarRecetasDeProducto(menuItemId)
    }
    setEliminando(null)
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setFormAbierto(null)
      setForm({ inventario_id: '', cantidad: '' })
    } else {
      setExpandedId(id)
      setFormAbierto(null)
      setForm({ inventario_id: '', cantidad: '' })
    }
  }

  function abrirForm(menuItemId: string) {
    setFormAbierto(menuItemId)
    setForm({ inventario_id: ingredientes[0]?.id ?? '', cantidad: '' })
  }

  function cerrarForm() {
    setFormAbierto(null)
    setForm({ inventario_id: '', cantidad: '' })
  }

  const categorias = Array.from(new Set(menuItems.map(m => m.categoria)))

  return (
    <div style={s.root}>
      {/* ── HEADER ── */}
      <header style={s.header}>
        <button onClick={onVolver} style={s.backBtn}>
          ← VOLVER
        </button>
        <div style={s.headerCenter}>
          <div>
            <p style={s.headerSlug}>// Recetas</p>
            <h1 style={s.headerTitle}>Recetas de producción</h1>
          </div>
        </div>
        <div style={{ width: 110 }} />
      </header>

      {/* ── MAIN ── */}
      <main style={s.main}>
        {loading ? (
          <div style={s.center}>
            <div style={{ fontSize: 40, display: 'inline-block', animation: 'gear-spin 1.5s linear infinite' }}>⚙️</div>
            <p style={s.emptyText}>CARGANDO RECETAS...</p>
          </div>
        ) : tablaError ? (
          <div style={s.center}>
            <div style={{ fontSize: 40 }}>📭</div>
            <p style={s.emptyText}>TABLA RECETAS NO CONFIGURADA</p>
            <p style={{ ...s.emptyText, fontSize: 10, marginTop: 6, textTransform: 'none', letterSpacing: 0 }}>
              Crea la tabla <code style={{ color: 'var(--yellow)' }}>recetas</code> en Supabase para continuar.
            </p>
          </div>
        ) : menuItems.length === 0 ? (
          <div style={s.center}>
            <div style={{ fontSize: 40 }}>🍽️</div>
            <p style={s.emptyText}>SIN PRODUCTOS EN EL MENÚ</p>
          </div>
        ) : (
          <div style={s.listWrap}>
            {categorias.map(cat => {
              const items = menuItems.filter(m => m.categoria === cat)
              if (items.length === 0) return null
              return (
                <div key={cat}>
                  {/* Encabezado de categoría */}
                  <div style={s.catHeader}>
                    {CATEGORIA_LABELS[cat] ?? cat.toUpperCase()}
                    <span style={s.catCount}>{items.length}</span>
                  </div>

                  {items.map(item => {
                    const isExpanded = expandedId === item.id
                    const recetasItem = recetas[item.id] ?? []
                    const tieneReceta = recetasItem.length > 0

                    return (
                      <div key={item.id} style={s.itemWrap}>
                        {/* Fila del producto */}
                        <button
                          style={{
                            ...s.itemRow,
                            ...(isExpanded ? s.itemRowActive : {}),
                          }}
                          onClick={() => toggleExpand(item.id)}
                        >
                          <div style={s.itemLeft}>
                            <span style={s.itemEmoji}>{item.emoji}</span>
                            <div style={s.itemInfo}>
                              <span style={s.itemNombre}>{item.nombre}</span>
                              <span style={s.itemPrecio}>${item.precio.toFixed(2)}</span>
                            </div>
                          </div>
                          <div style={s.itemRight}>
                            {tieneReceta ? (
                              <span style={s.badgeOk}>
                                {recetasItem.length} ingrediente{recetasItem.length !== 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span style={s.badgeVacio}>SIN RECETA</span>
                            )}
                            <span style={{ ...s.chevron, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              ›
                            </span>
                          </div>
                        </button>

                        {/* Panel expandido */}
                        {isExpanded && (
                          <div style={s.panel}>
                            {/* Lista de ingredientes actuales */}
                            {recetasItem.length === 0 ? (
                              <p style={s.sinIngredientes}>
                                Este producto no tiene ingredientes asignados aún.
                              </p>
                            ) : (
                              <div style={s.ingredientesList}>
                                {recetasItem.map(r => {
                                  const ing = Array.isArray(r.inventario) ? r.inventario[0] ?? null : r.inventario
                                  const isElim = eliminando === r.id
                                  return (
                                    <div key={r.id} style={s.ingredienteRow}>
                                      <div style={s.ingredienteInfo}>
                                        <span style={s.ingredienteNombre}>
                                          {ing?.nombre ?? '(ingrediente eliminado)'}
                                        </span>
                                        <span style={s.ingredienteCantidad}>
                                          {r.cantidad_por_unidad} {ing?.unidad ?? ''}
                                          <span style={s.ingredientePorUnidad}> por unidad</span>
                                        </span>
                                      </div>
                                      <button
                                        style={{
                                          ...s.eliminarBtn,
                                          opacity: isElim ? 0.4 : 1,
                                          cursor: isElim ? 'not-allowed' : 'pointer',
                                        }}
                                        disabled={isElim}
                                        onClick={() => eliminarIngrediente(r.id, item.id)}
                                        title="Eliminar ingrediente"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {/* Formulario inline */}
                            {formAbierto === item.id ? (
                              <div style={s.formWrap}>
                                <div style={s.formTitle}>AGREGAR INGREDIENTE</div>

                                <div style={s.fieldGroup}>
                                  <label style={s.fieldLabel}>INSUMO / INGREDIENTE</label>
                                  <select
                                    style={s.fieldSelect}
                                    value={form.inventario_id}
                                    onChange={e => setForm(f => ({ ...f, inventario_id: e.target.value }))}
                                    disabled={guardando}
                                  >
                                    {ingredientes.length === 0 ? (
                                      <option value="">— Sin insumos en inventario —</option>
                                    ) : (
                                      <>
                                        <option value="">— Seleccionar insumo —</option>
                                        {ingredientes.map(ing => (
                                          <option key={ing.id} value={ing.id}>
                                            {ing.nombre} ({ing.unidad})
                                          </option>
                                        ))}
                                      </>
                                    )}
                                  </select>
                                </div>

                                <div style={s.fieldGroup}>
                                  <label style={s.fieldLabel}>CANTIDAD POR UNIDAD VENDIDA</label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    placeholder="ej. 0.25"
                                    value={form.cantidad}
                                    onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                                    style={s.fieldInput}
                                    disabled={guardando}
                                  />
                                </div>

                                <div style={s.formActions}>
                                  <button
                                    style={s.cancelBtn}
                                    onClick={cerrarForm}
                                    disabled={guardando}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    style={{
                                      ...s.saveBtn,
                                      opacity: guardando || !form.inventario_id || !form.cantidad ? 0.5 : 1,
                                      cursor: guardando || !form.inventario_id || !form.cantidad ? 'not-allowed' : 'pointer',
                                    }}
                                    onClick={() => guardarIngrediente(item.id)}
                                    disabled={guardando || !form.inventario_id || !form.cantidad}
                                  >
                                    {guardando ? 'Guardando...' : 'Guardar'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {ingredientes.length === 0 && (
                                  <p style={{ margin: 0, fontSize: 10, fontWeight: 900, letterSpacing: '0.15em', color: '#ef4444', textTransform: 'uppercase' }}>
                                    ⚠ Sin insumos en inventario — agrega insumos primero desde la sección Inventario
                                  </p>
                                )}
                                <button
                                  style={{
                                    ...s.agregarBtn,
                                    opacity: ingredientes.length === 0 ? 0.4 : 1,
                                  }}
                                  onClick={() => abrirForm(item.id)}
                                >
                                  ➕ Agregar ingrediente
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  // ── Root
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--dark)',
    color: 'var(--text)',
    overflow: 'hidden',
  },

  // ── Header
  header: {
    height: 60,
    background: 'var(--black)',
    borderBottom: '2px solid var(--yellow)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
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
    width: 110,
    borderRadius: 0,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'center',
  },
  headerSlug: {
    margin: 0,
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--yellow)',
    textTransform: 'uppercase',
  },
  headerTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 900,
    letterSpacing: '0.15em',
    color: 'var(--text)',
    textTransform: 'uppercase',
  },

  // ── Main
  main: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  listWrap: {
    paddingBottom: 24,
  },

  // ── Category header
  catHeader: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    padding: '14px 16px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--dark)',
    borderBottom: '1px solid var(--border)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  catCount: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    fontSize: 9,
    fontWeight: 900,
    padding: '1px 6px',
    letterSpacing: '0.1em',
  },

  // ── Item wrap
  itemWrap: {
    borderBottom: '1px solid var(--border)',
  },

  // ── Fila de producto (botón expandible)
  itemRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'var(--charcoal)',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    textAlign: 'left',
    gap: 12,
    transition: 'background 0.1s',
  },
  itemRowActive: {
    background: 'rgba(240,168,0,0.06)',
    borderLeft: '3px solid var(--yellow)',
  },
  itemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  itemEmoji: {
    fontSize: 22,
    flexShrink: 0,
    width: 30,
    textAlign: 'center',
  },
  itemInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  itemNombre: {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.08em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemPrecio: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
  },
  itemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  badgeOk: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    padding: '3px 8px',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)',
    color: '#22c55e',
  },
  badgeVacio: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    padding: '3px 8px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444',
  },
  chevron: {
    fontSize: 20,
    fontWeight: 900,
    color: 'var(--muted)',
    lineHeight: 1,
    transition: 'transform 0.2s',
    display: 'inline-block',
  },

  // ── Panel expandido
  panel: {
    background: 'var(--dark)',
    borderTop: '1px solid var(--border)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },

  sinIngredientes: {
    margin: 0,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },

  // ── Lista de ingredientes
  ingredientesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  ingredienteRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    padding: '8px 12px',
    gap: 8,
  },
  ingredienteInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  ingredienteNombre: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--text)',
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ingredienteCantidad: {
    fontSize: 11,
    fontWeight: 900,
    color: 'var(--yellow)',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  ingredientePorUnidad: {
    fontSize: 9,
    fontWeight: 900,
    color: 'var(--muted)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  eliminarBtn: {
    background: 'transparent',
    border: '1px solid rgba(239,68,68,0.4)',
    color: '#ef4444',
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 900,
    flexShrink: 0,
    borderRadius: 0,
  },

  // ── Botón agregar
  agregarBtn: {
    alignSelf: 'flex-start',
    background: 'transparent',
    border: '1px solid var(--yellow)',
    color: 'var(--yellow)',
    padding: '7px 14px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    borderRadius: 0,
  },

  // ── Formulario inline
  formWrap: {
    background: 'var(--charcoal)',
    border: '1px solid var(--border)',
    borderTop: '2px solid var(--yellow)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  formTitle: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.25em',
    color: 'var(--yellow)',
    textTransform: 'uppercase',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
  },
  fieldSelect: {
    width: '100%',
    padding: '9px 12px',
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.08em',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    boxSizing: 'border-box',
    borderRadius: 0,
  },
  fieldInput: {
    width: '100%',
    padding: '9px 12px',
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 900,
    outline: 'none',
    boxSizing: 'border-box',
    borderRadius: 0,
  },
  formActions: {
    display: 'flex',
    gap: 8,
    paddingTop: 4,
  },
  cancelBtn: {
    flex: 1,
    padding: '10px',
    background: 'var(--dark)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 11,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    borderRadius: 0,
  },
  saveBtn: {
    flex: 1,
    padding: '10px',
    background: 'var(--yellow)',
    border: 'none',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 11,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    borderRadius: 0,
  },

  // ── Estado vacío / loading
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    gap: 14,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.2em',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    margin: 0,
  },
}
