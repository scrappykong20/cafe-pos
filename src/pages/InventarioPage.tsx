import { useEffect, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../supabase'
import type { CajeroActivo } from '../App'
import toast from 'react-hot-toast'

// ── Interfaces ────────────────────────────────────────────────────────────────

interface HistorialInvRow {
  id: string
  inventario_id: string | null
  menu_id: string | null
  tipo: 'entrada' | 'salida' | 'ajuste'
  cantidad: number
  nota: string | null
  referencia_id: string | null
  cajero_nombre: string | null
  created_at: string
}

interface InventarioItem {
  id: string
  menu_id: string | null
  nombre: string | null
  emoji: string | null
  categoria: string | null
  stock_actual: number
  stock_minimo: number
  stock_maximo: number | null
  unidad: string
  updated_at: string
  // joined from menu when menu_id is set
  menu_nombre?: string
  menu_emoji?: string
  menu_categoria?: string
}

interface MenuRow {
  id: string
  nombre: string
  emoji: string
  precio: number
  categoria: string
  disponible: boolean
}

interface Props {
  cajero: CajeroActivo
  onVolver: () => void
}

type Unidad = 'pza' | 'kg' | 'g' | 'L' | 'mL' | 'porción' | 'caja' | 'bolsa' | 'lata' | 'botella' | 'sobre' | 'taza'
type TabActiva = 'inventario' | 'historial'
type CategoriaStandalone = 'general' | 'bebidas' | 'alimentos' | 'limpieza' | 'insumos' | 'otro'

// ── Modal states ──────────────────────────────────────────────────────────────

interface ModalConfigurar {
  kind: 'configurar'
  itemId: string | null       // null = creating new inventario record for a menu item
  menuId: string | null
  displayNombre: string
  displayEmoji: string
  stockActual: string
  stockMinimo: string
  stockMaximo: string         // empty string = null / sin máximo
  unidad: Unidad
  saving: boolean
}

interface ModalRecibir {
  kind: 'recibir'
  itemId: string
  displayNombre: string
  displayEmoji: string
  stockActual: number
  unidad: string
  cantidad: string
  motivo: string
  saving: boolean
}

interface ModalNuevoItem {
  kind: 'nuevo'
  nombre: string
  emoji: string
  categoria: CategoriaStandalone
  unidad: Unidad
  stockActual: string
  stockMinimo: string
  stockMaximo: string
  saving: boolean
}

type ModalState = ModalConfigurar | ModalRecibir | ModalNuevoItem | null

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIDADES: { value: Unidad; label: string }[] = [
  { value: 'pza',     label: 'Pieza (pza)' },
  { value: 'kg',      label: 'Kilogramo (kg)' },
  { value: 'g',       label: 'Gramo (g)' },
  { value: 'L',       label: 'Litro (L)' },
  { value: 'mL',      label: 'Mililitro (mL)' },
  { value: 'porción', label: 'Porción' },
  { value: 'caja',    label: 'Caja' },
  { value: 'bolsa',   label: 'Bolsa' },
  { value: 'lata',    label: 'Lata' },
  { value: 'botella', label: 'Botella' },
  { value: 'sobre',   label: 'Sobre / Sachet' },
  { value: 'taza',    label: 'Taza' },
]

const CATEGORIAS_STANDALONE: { value: CategoriaStandalone; label: string }[] = [
  { value: 'general',   label: 'General' },
  { value: 'bebidas',   label: 'Bebidas' },
  { value: 'alimentos', label: 'Alimentos' },
  { value: 'limpieza',  label: 'Limpieza' },
  { value: 'insumos',   label: 'Insumos' },
  { value: 'otro',      label: 'Otro' },
]

const CATEGORIA_LABELS: Record<string, string> = {
  cafe:        'CAFÉS',
  bebida_fria: 'BEBIDAS FRÍAS',
  panaderia:   'PANADERÍA',
  alimento:    'ALIMENTOS',
  general:     'GENERAL',
  bebidas:     'BEBIDAS',
  alimentos:   'ALIMENTOS',
  limpieza:    'LIMPIEZA',
  insumos:     'INSUMOS',
  otro:        'OTRO',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayNombre(item: InventarioItem): string {
  return item.menu_nombre || item.nombre || 'Sin nombre'
}

function displayEmoji(item: InventarioItem): string {
  return item.menu_emoji || item.emoji || '📦'
}

function displayCategoria(item: InventarioItem): string {
  return item.menu_categoria || item.categoria || 'general'
}

function stockStatus(item: InventarioItem): 'ok' | 'bajo' | 'sin' {
  if (item.stock_actual === 0) return 'sin'
  if (item.stock_actual <= item.stock_minimo) return 'bajo'
  return 'ok'
}

function stockColor(status: 'ok' | 'bajo' | 'sin'): string {
  if (status === 'sin')  return '#ef4444'
  if (status === 'bajo') return '#f59e0b'
  return '#22c55e'
}

function barPercent(item: InventarioItem): number {
  const max = item.stock_maximo ?? (item.stock_actual + item.stock_actual * 0.5 + 1)
  if (max <= 0) return 0
  return Math.min(100, Math.round((item.stock_actual / max) * 100))
}

function nombreCompleto(cajero: CajeroActivo): string {
  return `${cajero.nombre} ${cajero.last_name}`.trim()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InventarioPage({ cajero, onVolver }: Props) {
  const [items, setItems]             = useState<InventarioItem[]>([])
  const [menuSinInv, setMenuSinInv]   = useState<MenuRow[]>([])      // menu items without inventario record
  const [loading, setLoading]         = useState(true)
  const [tabActiva, setTabActiva]     = useState<TabActiva>('inventario')
  const [busqueda, setBusqueda]       = useState('')
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [modal, setModal]             = useState<ModalState>(null)
  const [ajustando, setAjustando]     = useState<string | null>(null)  // item.id being adjusted
  const [historial, setHistorial]     = useState<HistorialInvRow[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)
  const [historialLoaded, setHistorialLoaded]   = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────

  const cargarDatos = useCallback(async () => {
    try {
      // Load inventario with join to menu
      const { data: invData, error: invError } = await supabase
        .from('inventario')
        .select('*, menu:menu_id(nombre, emoji, categoria)')
        .order('updated_at', { ascending: false })

      if (invError) {
        toast.error('Error cargando inventario')
        setLoading(false)
        return
      }

      // Map joined data
      const mapped: InventarioItem[] = (invData ?? []).map((row: Record<string, unknown>) => {
        const menu = row.menu as { nombre?: string; emoji?: string; categoria?: string } | null
        return {
          id:           row.id as string,
          menu_id:      row.menu_id as string | null,
          nombre:       row.nombre as string | null,
          emoji:        row.emoji as string | null,
          categoria:    row.categoria as string | null,
          stock_actual: Number(row.stock_actual ?? 0),
          stock_minimo: Number(row.stock_minimo ?? 0),
          stock_maximo: row.stock_maximo != null ? Number(row.stock_maximo) : null,
          unidad:       (row.unidad as string) ?? 'pza',
          updated_at:   (row.updated_at as string) ?? '',
          menu_nombre:  menu?.nombre,
          menu_emoji:   menu?.emoji,
          menu_categoria: menu?.categoria,
        }
      })

      setItems(mapped)

      // If admin: also find menu items with no inventario record
      if (cajero.es_admin) {
        const menuIdsWithInv = new Set(mapped.filter(i => i.menu_id).map(i => i.menu_id as string))

        const { data: menuData } = await supabase
          .from('menu')
          .select('id, nombre, emoji, precio, categoria, disponible')
          .order('categoria')
          .order('nombre')

        const sinInv = (menuData ?? []).filter((m: MenuRow) => !menuIdsWithInv.has(m.id))
        setMenuSinInv(sinInv)
      } else {
        setMenuSinInv([])
      }
    } catch {
      toast.error('Error inesperado cargando inventario')
    } finally {
      setLoading(false)
    }
  }, [cajero.es_admin])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // Realtime subscription on inventario
  useEffect(() => {
    const ch = supabase
      .channel('inventario-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario' }, () => {
        cargarDatos()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [cargarDatos])

  // ── Historial ───────────────────────────────────────────────────────────────

  async function cargarHistorial() {
    if (historialLoaded) return
    setLoadingHistorial(true)
    try {
      const { data, error } = await supabase
        .from('historial_inventario')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) {
        toast.error('No se pudo cargar el historial')
      } else {
        setHistorial((data as HistorialInvRow[]) ?? [])
        setHistorialLoaded(true)
      }
    } catch {
      toast.error('Error cargando historial')
    } finally {
      setLoadingHistorial(false)
    }
  }

  function handleTabChange(tab: TabActiva) {
    setTabActiva(tab)
    if (tab === 'historial' && !historialLoaded) {
      cargarHistorial()
    }
  }

  // ── Quick adjust (+/-) ──────────────────────────────────────────────────────

  async function ajustarStock(item: InventarioItem, delta: number) {
    const prevStock = item.stock_actual
    const newStock  = Math.max(0, prevStock + delta)
    setAjustando(item.id)

    // Optimistic update
    setItems(prev =>
      prev.map(p => p.id === item.id ? { ...p, stock_actual: newStock } : p)
    )

    const { error } = await supabase
      .from('inventario')
      .update({ stock_actual: newStock })
      .eq('id', item.id)

    if (error) {
      // Roll back
      setItems(prev =>
        prev.map(p => p.id === item.id ? { ...p, stock_actual: prevStock } : p)
      )
      toast.error('Error actualizando stock')
    } else {
      // Log to historial silently
      try {
        await supabase.from('historial_inventario').insert({
          inventario_id: item.id,
          menu_id:       item.menu_id ?? null,
          tipo:          delta > 0 ? 'entrada' : 'salida',
          cantidad:      Math.abs(delta),
          nota:          'Ajuste manual',
          cajero_nombre: nombreCompleto(cajero),
        })
        // Invalidate historial cache so it reloads next time
        setHistorialLoaded(false)
      } catch {
        // Silent — historial is best-effort
      }
    }

    setAjustando(null)
  }

  // ── Modal: Recibir Mercancía ─────────────────────────────────────────────────

  function abrirRecibir(item: InventarioItem) {
    const m: ModalRecibir = {
      kind:          'recibir',
      itemId:        item.id,
      displayNombre: displayNombre(item),
      displayEmoji:  displayEmoji(item),
      stockActual:   item.stock_actual,
      unidad:        item.unidad,
      cantidad:      '',
      motivo:        '',
      saving:        false,
    }
    setModal(m)
  }

  async function guardarRecibir() {
    if (!modal || modal.kind !== 'recibir') return
    const cantidad = parseFloat(modal.cantidad)
    if (isNaN(cantidad) || cantidad <= 0) {
      toast.error('La cantidad debe ser mayor a 0')
      return
    }

    setModal(m => m && m.kind === 'recibir' ? { ...m, saving: true } : m)

    // Find current item to get stock_actual
    const item = items.find(i => i.id === modal.itemId)
    if (!item) {
      setModal(null)
      return
    }

    const nuevoStock = item.stock_actual + cantidad

    const { error } = await supabase
      .from('inventario')
      .update({ stock_actual: nuevoStock })
      .eq('id', modal.itemId)

    if (error) {
      toast.error('Error recibiendo mercancía')
      setModal(m => m && m.kind === 'recibir' ? { ...m, saving: false } : m)
      return
    }

    // Log to historial
    try {
      await supabase.from('historial_inventario').insert({
        inventario_id: item.id,
        menu_id:       item.menu_id ?? null,
        tipo:          'entrada',
        cantidad:      cantidad,
        nota:          modal.motivo.trim() || 'Recepción de mercancía',
        cajero_nombre: nombreCompleto(cajero),
      })
      setHistorialLoaded(false)
    } catch {
      // Silent
    }

    toast.success(`✓ +${cantidad} ${item.unidad} recibidos`)
    setModal(null)
    cargarDatos()
  }

  // ── Modal: Configurar Stock ──────────────────────────────────────────────────

  function abrirConfigurar(item: InventarioItem) {
    const m: ModalConfigurar = {
      kind:          'configurar',
      itemId:        item.id,
      menuId:        item.menu_id,
      displayNombre: displayNombre(item),
      displayEmoji:  displayEmoji(item),
      stockActual:   String(item.stock_actual),
      stockMinimo:   String(item.stock_minimo),
      stockMaximo:   item.stock_maximo != null ? String(item.stock_maximo) : '',
      unidad:        item.unidad as Unidad,
      saving:        false,
    }
    setModal(m)
  }

  function abrirConfigurarMenuSinReg(menu: MenuRow) {
    const m: ModalConfigurar = {
      kind:          'configurar',
      itemId:        null,
      menuId:        menu.id,
      displayNombre: menu.nombre,
      displayEmoji:  menu.emoji,
      stockActual:   '0',
      stockMinimo:   '5',
      stockMaximo:   '',
      unidad:        'pza',
      saving:        false,
    }
    setModal(m)
  }

  async function guardarConfigurar() {
    if (!modal || modal.kind !== 'configurar') return
    const stockActual = parseFloat(modal.stockActual)
    const stockMinimo = parseFloat(modal.stockMinimo)
    const stockMaximo = modal.stockMaximo.trim() !== '' ? parseFloat(modal.stockMaximo) : null

    if (isNaN(stockActual) || isNaN(stockMinimo)) {
      toast.error('Stock actual y mínimo son requeridos')
      return
    }

    setModal(m => m && m.kind === 'configurar' ? { ...m, saving: true } : m)

    const payload: Record<string, unknown> = {
      menu_id:      modal.menuId ?? null,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      stock_maximo: stockMaximo,
      unidad:       modal.unidad,
    }
    if (modal.itemId) payload.id = modal.itemId

    const { error } = await supabase
      .from('inventario')
      .upsert(payload)

    if (error) {
      toast.error('Error guardando configuración')
      setModal(m => m && m.kind === 'configurar' ? { ...m, saving: false } : m)
      return
    }

    toast.success('✓ Configuración guardada')
    setModal(null)
    cargarDatos()
  }

  // ── Modal: Nuevo Item ────────────────────────────────────────────────────────

  function abrirNuevoItem() {
    const m: ModalNuevoItem = {
      kind:        'nuevo',
      nombre:      '',
      emoji:       '📦',
      categoria:   'general',
      unidad:      'pza',
      stockActual: '0',
      stockMinimo: '5',
      stockMaximo: '',
      saving:      false,
    }
    setModal(m)
  }

  async function guardarNuevoItem() {
    if (!modal || modal.kind !== 'nuevo') return
    if (!modal.nombre.trim()) {
      toast.error('El nombre es requerido')
      return
    }

    const stockActual = parseFloat(modal.stockActual)
    const stockMinimo = parseFloat(modal.stockMinimo)
    const stockMaximo = modal.stockMaximo.trim() !== '' ? parseFloat(modal.stockMaximo) : null

    if (isNaN(stockActual) || isNaN(stockMinimo)) {
      toast.error('Stock actual y mínimo son requeridos')
      return
    }

    setModal(m => m && m.kind === 'nuevo' ? { ...m, saving: true } : m)

    const { error } = await supabase
      .from('inventario')
      .insert({
        menu_id:      null,
        nombre:       modal.nombre.trim(),
        emoji:        modal.emoji.trim() || '📦',
        categoria:    modal.categoria,
        unidad:       modal.unidad,
        stock_actual: stockActual,
        stock_minimo: stockMinimo,
        stock_maximo: stockMaximo,
      })

    if (error) {
      toast.error('Error creando ítem')
      setModal(m => m && m.kind === 'nuevo' ? { ...m, saving: false } : m)
      return
    }

    toast.success(`✓ Ítem "${modal.nombre}" creado`)
    setModal(null)
    cargarDatos()
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const itemsFiltrados = items.filter(item => {
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      const nombre = displayNombre(item).toLowerCase()
      if (!nombre.includes(q)) return false
    }
    if (soloAlertas) {
      const s = stockStatus(item)
      if (s === 'ok') return false
    }
    return true
  })

  // Unique categories from filtered items
  const categorias = Array.from(new Set(itemsFiltrados.map(i => displayCategoria(i))))

  // Stats (from ALL items, not just filtered)
  const total    = items.length
  const enStock  = items.filter(i => stockStatus(i) === 'ok').length
  const bajStock = items.filter(i => stockStatus(i) === 'bajo').length
  const sinStock = items.filter(i => stockStatus(i) === 'sin').length

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      {/* ── HEADER ── */}
      <header style={s.header}>
        <button onClick={onVolver} style={s.backBtn}>← VOLVER</button>

        <div style={s.headerCenter}>
          <span style={{ fontSize: 20 }}>📦</span>
          <h1 style={s.headerTitle}>INVENTARIO</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {cajero.es_admin && tabActiva === 'inventario' && (
            <button onClick={abrirNuevoItem} style={s.nuevoItemBtn}>
              + NUEVO ÍTEM
            </button>
          )}
          {tabActiva === 'inventario' && (
            <button
              onClick={() => setSoloAlertas(v => !v)}
              style={{ ...s.alertasBtn, ...(soloAlertas ? s.alertasBtnActive : {}) }}
            >
              {soloAlertas ? '⚠ ALERTAS' : '≡ TODOS'}
            </button>
          )}
        </div>
      </header>

      {/* ── TABS ── */}
      <div style={s.tabBar}>
        {(['inventario', 'historial'] as TabActiva[]).map(tab => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            style={{
              ...s.tabBtn,
              ...(tabActiva === tab ? s.tabBtnActive : {}),
            }}
          >
            {tab === 'inventario' ? '📦 Inventario' : '📋 Historial'}
          </button>
        ))}
      </div>

      {/* ── INVENTARIO TAB ── */}
      {tabActiva === 'inventario' && (
        <>
          {/* Stats bar */}
          <div style={s.statsBar}>
            <div style={s.statItem}>
              <span style={s.statNum}>{total}</span>
              <span style={s.statLbl}>TOTAL</span>
            </div>
            <div style={s.statDivider} />
            <div style={s.statItem}>
              <span style={{ ...s.statNum, color: '#22c55e' }}>{enStock}</span>
              <span style={s.statLbl}>EN STOCK</span>
            </div>
            <div style={s.statDivider} />
            <div style={s.statItem}>
              <span style={{ ...s.statNum, color: '#f59e0b' }}>{bajStock}</span>
              <span style={s.statLbl}>STOCK BAJO</span>
            </div>
            <div style={s.statDivider} />
            <div style={s.statItem}>
              <span style={{ ...s.statNum, color: '#ef4444' }}>{sinStock}</span>
              <span style={s.statLbl}>SIN STOCK</span>
            </div>
          </div>

          {/* Search bar */}
          <div style={s.searchWrap}>
            <span style={s.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder="BUSCAR ÍTEM..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              style={s.searchInput}
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} style={s.searchClear}>✕</button>
            )}
          </div>

          {/* List */}
          <main style={s.main}>
            {loading ? (
              <div style={s.center}>
                <div style={{ fontSize: 40 }}>⚙️</div>
                <p style={s.emptyText}>CARGANDO INVENTARIO...</p>
              </div>
            ) : itemsFiltrados.length === 0 && menuSinInv.length === 0 ? (
              <div style={s.center}>
                <div style={{ fontSize: 40 }}>{soloAlertas ? '✅' : '📦'}</div>
                <p style={s.emptyText}>
                  {soloAlertas ? 'SIN ALERTAS DE STOCK' : 'SIN ÍTEMS DE INVENTARIO'}
                </p>
                {cajero.es_admin && !soloAlertas && (
                  <button onClick={abrirNuevoItem} style={{ ...s.configurarBtn, marginTop: 16 }}>
                    + CREAR PRIMER ÍTEM
                  </button>
                )}
              </div>
            ) : (
              <div style={s.listWrap}>
                {/* Registered items grouped by category */}
                {categorias.map(cat => {
                  const catItems = itemsFiltrados.filter(i => displayCategoria(i) === cat)
                  if (catItems.length === 0) return null
                  return (
                    <div key={cat}>
                      <div style={s.catHeader}>
                        {CATEGORIA_LABELS[cat] ?? cat.toUpperCase()}
                        <span style={s.catCount}>{catItems.length}</span>
                      </div>
                      {catItems.map(item => {
                        const status   = stockStatus(item)
                        const color    = stockColor(status)
                        const pct      = barPercent(item)
                        const isAdj    = ajustando === item.id

                        return (
                          <div key={item.id} style={s.card}>
                            {/* LEFT: emoji + info + progress */}
                            <div style={s.cardLeft}>
                              <span style={s.cardEmoji}>{displayEmoji(item)}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={s.cardRow}>
                                  <span style={s.cardName}>{displayNombre(item)}</span>
                                  <span style={{
                                    ...s.statusBadge,
                                    background: `${color}18`,
                                    border:     `1px solid ${color}55`,
                                    color,
                                  }}>
                                    {status === 'ok'   ? 'EN STOCK'   : null}
                                    {status === 'bajo' ? '⚠ STOCK BAJO' : null}
                                    {status === 'sin'  ? '✗ SIN STOCK'  : null}
                                  </span>
                                </div>

                                {/* Progress bar */}
                                <div style={s.progressTrack}>
                                  <div style={{
                                    ...s.progressFill,
                                    width:      `${pct}%`,
                                    background: color,
                                    opacity:    status === 'sin' ? 0.3 : 1,
                                  }} />
                                </div>

                                {/* Stock numbers */}
                                <div style={s.stockNums}>
                                  <span style={{ ...s.stockActual, color }}>
                                    {item.stock_actual}
                                  </span>
                                  <span style={s.stockUnit}>{item.unidad}</span>
                                  <span style={s.stockSep}>·</span>
                                  <span style={s.stockMeta}>mín {item.stock_minimo}</span>
                                  {item.stock_maximo != null && (
                                    <>
                                      <span style={s.stockSep}>·</span>
                                      <span style={s.stockMeta}>máx {item.stock_maximo}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* RIGHT: controls */}
                            <div style={s.cardRight}>
                              {/* Cajero/Admin: Recibir button */}
                              <button
                                style={s.recibirBtn}
                                onClick={() => abrirRecibir(item)}
                                disabled={isAdj}
                                title="Recibir mercancía"
                              >
                                📥
                              </button>

                              {/* Quick +/- */}
                              <div style={s.controls}>
                                <button
                                  style={{
                                    ...s.controlBtn,
                                    opacity: isAdj || item.stock_actual === 0 ? 0.4 : 1,
                                  }}
                                  disabled={isAdj || item.stock_actual === 0}
                                  onClick={() => ajustarStock(item, -1)}
                                  title="Reducir 1"
                                >
                                  −
                                </button>
                                <button
                                  style={{
                                    ...s.controlBtn,
                                    ...s.controlBtnPlus,
                                    opacity: isAdj ? 0.4 : 1,
                                  }}
                                  disabled={isAdj}
                                  onClick={() => ajustarStock(item, 1)}
                                  title="Agregar 1"
                                >
                                  +
                                </button>
                              </div>

                              {/* Admin only: edit config */}
                              {cajero.es_admin && (
                                <button
                                  style={s.editBtn}
                                  onClick={() => abrirConfigurar(item)}
                                  title="Editar configuración"
                                >
                                  ✎
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Admin only: menu items without inventario record */}
                {cajero.es_admin && menuSinInv.length > 0 && !soloAlertas && !busqueda && (
                  <div>
                    <div style={{ ...s.catHeader, color: '#ef4444' }}>
                      SIN REGISTRO EN INVENTARIO
                      <span style={{ ...s.catCount, borderColor: 'rgba(239,68,68,0.4)' }}>
                        {menuSinInv.length}
                      </span>
                    </div>
                    {menuSinInv.map(menu => (
                      <div key={menu.id} style={{ ...s.card, opacity: 0.75 }}>
                        <div style={s.cardLeft}>
                          <span style={s.cardEmoji}>{menu.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={s.cardRow}>
                              <span style={s.cardName}>{menu.nombre}</span>
                              <span style={{
                                ...s.statusBadge,
                                background: 'rgba(239,68,68,0.1)',
                                border:     '1px solid rgba(239,68,68,0.3)',
                                color:      '#ef4444',
                              }}>
                                SIN REGISTRO
                              </span>
                            </div>
                            <div style={s.stockNums}>
                              <span style={{ ...s.stockMeta, fontSize: 10 }}>
                                {CATEGORIA_LABELS[menu.categoria] ?? menu.categoria.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div style={s.cardRight}>
                          <button
                            style={s.configurarBtn}
                            onClick={() => abrirConfigurarMenuSinReg(menu)}
                          >
                            + CONFIGURAR
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </>
      )}

      {/* ── HISTORIAL TAB ── */}
      {tabActiva === 'historial' && (
        <main style={s.main}>
          {loadingHistorial ? (
            <div style={s.center}>
              <div style={{ fontSize: 32 }}>⚙️</div>
              <p style={s.emptyText}>CARGANDO HISTORIAL...</p>
            </div>
          ) : historial.length === 0 ? (
            <div style={s.center}>
              <div style={{ fontSize: 32 }}>📋</div>
              <p style={s.emptyText}>SIN REGISTROS EN HISTORIAL</p>
            </div>
          ) : (
            <div style={s.listWrap}>
              {historial.map(row => {
                const esEntrada = row.tipo === 'entrada'
                const color     = esEntrada ? '#22c55e' : '#ef4444'
                const hora      = new Date(row.created_at).toLocaleString('es-MX', {
                  day:    '2-digit',
                  month:  'short',
                  hour:   '2-digit',
                  minute: '2-digit',
                })
                return (
                  <div key={row.id} style={s.historialRow}>
                    <span style={{ fontSize: 16, color, flexShrink: 0 }}>
                      {esEntrada ? '▲' : '▼'}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.historialNombre}>
                        {row.nota ?? row.tipo}
                      </div>
                    </div>

                    <span style={{ ...s.historialCambio, color }}>
                      {esEntrada ? '+' : '-'}{row.cantidad}
                    </span>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={s.historialUser}>{row.cajero_nombre ?? '—'}</div>
                      <div style={s.historialHora}>{hora}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      )}

      {/* ── MODAL: RECIBIR MERCANCÍA ── */}
      {modal?.kind === 'recibir' && (
        <div style={s.overlay} onClick={() => !modal.saving && setModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ fontSize: 22 }}>{modal.displayEmoji}</span>
              <div style={{ flex: 1 }}>
                <div style={s.modalTitle}>{modal.displayNombre}</div>
                <div style={s.modalSubtitle}>📥 RECIBIR MERCANCÍA</div>
              </div>
              <button style={s.closeBtn} onClick={() => !modal.saving && setModal(null)}>✕</button>
            </div>

            <div style={s.modalBody}>
              <div style={s.modalInfoRow}>
                <span style={s.modalInfoLabel}>STOCK ACTUAL</span>
                <span style={s.modalInfoValue}>{modal.stockActual} {modal.unidad}</span>
              </div>

              <div style={s.fieldGroup}>
                <label style={s.fieldLabel}>CANTIDAD RECIBIDA *</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  placeholder="Ej: 24"
                  value={(modal as ModalRecibir).cantidad}
                  onChange={e => setModal(m => m && m.kind === 'recibir' ? { ...m, cantidad: e.target.value } : m)}
                  style={s.fieldInput}
                  disabled={modal.saving}
                  autoFocus
                />
              </div>

              <div style={s.fieldGroup}>
                <label style={s.fieldLabel}>MOTIVO / PROVEEDOR (OPCIONAL)</label>
                <input
                  type="text"
                  placeholder="Ej: Entrega proveedor X"
                  value={(modal as ModalRecibir).motivo}
                  onChange={e => setModal(m => m && m.kind === 'recibir' ? { ...m, motivo: e.target.value } : m)}
                  style={s.fieldInput}
                  disabled={modal.saving}
                />
              </div>

              {(modal as ModalRecibir).cantidad && !isNaN(parseFloat((modal as ModalRecibir).cantidad)) && parseFloat((modal as ModalRecibir).cantidad) > 0 && (
                <div style={s.modalPreview}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.15em' }}>
                    NUEVO STOCK:
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: '#22c55e', marginLeft: 10 }}>
                    {modal.stockActual + parseFloat((modal as ModalRecibir).cantidad)} {modal.unidad}
                  </span>
                </div>
              )}
            </div>

            <div style={s.modalFooter}>
              <button
                style={s.cancelBtn}
                onClick={() => !modal.saving && setModal(null)}
                disabled={modal.saving}
              >
                CANCELAR
              </button>
              <button
                style={{ ...s.saveBtn, opacity: modal.saving ? 0.6 : 1, background: '#22c55e' }}
                onClick={guardarRecibir}
                disabled={modal.saving}
              >
                {modal.saving ? 'GUARDANDO...' : '📥 RECIBIR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIGURAR STOCK ── */}
      {modal?.kind === 'configurar' && (
        <div style={s.overlay} onClick={() => !modal.saving && setModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ fontSize: 22 }}>{modal.displayEmoji}</span>
              <div style={{ flex: 1 }}>
                <div style={s.modalTitle}>{modal.displayNombre}</div>
                <div style={s.modalSubtitle}>CONFIGURAR STOCK</div>
              </div>
              <button style={s.closeBtn} onClick={() => !modal.saving && setModal(null)}>✕</button>
            </div>

            <div style={s.modalBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>STOCK ACTUAL</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={(modal as ModalConfigurar).stockActual}
                    onChange={e => setModal(m => m && m.kind === 'configurar' ? { ...m, stockActual: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                  />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>STOCK MÍNIMO</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={(modal as ModalConfigurar).stockMinimo}
                    onChange={e => setModal(m => m && m.kind === 'configurar' ? { ...m, stockMinimo: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                  />
                </div>
              </div>

              <div style={s.fieldGroup}>
                <label style={s.fieldLabel}>STOCK MÁXIMO (OPCIONAL)</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Dejar vacío = sin límite"
                  value={(modal as ModalConfigurar).stockMaximo}
                  onChange={e => setModal(m => m && m.kind === 'configurar' ? { ...m, stockMaximo: e.target.value } : m)}
                  style={s.fieldInput}
                  disabled={modal.saving}
                />
              </div>

              <div style={s.fieldGroup}>
                <label style={s.fieldLabel}>UNIDAD</label>
                <select
                  value={(modal as ModalConfigurar).unidad}
                  onChange={e => setModal(m => m && m.kind === 'configurar' ? { ...m, unidad: e.target.value as Unidad } : m)}
                  style={s.fieldSelect}
                  disabled={modal.saving}
                >
                  {UNIDADES.map(u => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>

              <div style={s.modalPreview}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.15em' }}>
                  VISTA PREVIA:
                </span>
                <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--yellow)', marginLeft: 10 }}>
                  {(modal as ModalConfigurar).stockActual || '0'} / mín {(modal as ModalConfigurar).stockMinimo || '0'}
                  {(modal as ModalConfigurar).stockMaximo ? ` / máx ${(modal as ModalConfigurar).stockMaximo}` : ''}{' '}
                  {(modal as ModalConfigurar).unidad}
                </span>
              </div>
            </div>

            <div style={s.modalFooter}>
              <button
                style={s.cancelBtn}
                onClick={() => !modal.saving && setModal(null)}
                disabled={modal.saving}
              >
                CANCELAR
              </button>
              <button
                style={{ ...s.saveBtn, opacity: modal.saving ? 0.6 : 1 }}
                onClick={guardarConfigurar}
                disabled={modal.saving}
              >
                {modal.saving ? 'GUARDANDO...' : '✓ GUARDAR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: NUEVO ÍTEM ── */}
      {modal?.kind === 'nuevo' && (
        <div style={s.overlay} onClick={() => !modal.saving && setModal(null)}>
          <div style={{ ...s.modalBox, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ fontSize: 22 }}>{(modal as ModalNuevoItem).emoji || '📦'}</span>
              <div style={{ flex: 1 }}>
                <div style={s.modalTitle}>NUEVO ÍTEM DE INVENTARIO</div>
                <div style={s.modalSubtitle}>SIN VINCULAR A MENÚ</div>
              </div>
              <button style={s.closeBtn} onClick={() => !modal.saving && setModal(null)}>✕</button>
            </div>

            <div style={s.modalBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>NOMBRE *</label>
                  <input
                    type="text"
                    placeholder="Ej: Azúcar morena"
                    value={(modal as ModalNuevoItem).nombre}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, nombre: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                    autoFocus
                  />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>EMOJI</label>
                  <input
                    type="text"
                    placeholder="📦"
                    value={(modal as ModalNuevoItem).emoji}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, emoji: e.target.value } : m)}
                    style={{ ...s.fieldInput, textAlign: 'center', fontSize: 22 }}
                    disabled={modal.saving}
                    maxLength={4}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>CATEGORÍA</label>
                  <select
                    value={(modal as ModalNuevoItem).categoria}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, categoria: e.target.value as CategoriaStandalone } : m)}
                    style={s.fieldSelect}
                    disabled={modal.saving}
                  >
                    {CATEGORIAS_STANDALONE.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>UNIDAD</label>
                  <select
                    value={(modal as ModalNuevoItem).unidad}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, unidad: e.target.value as Unidad } : m)}
                    style={s.fieldSelect}
                    disabled={modal.saving}
                  >
                    {UNIDADES.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>STOCK ACTUAL</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={(modal as ModalNuevoItem).stockActual}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, stockActual: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                  />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>MÍNIMO</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={(modal as ModalNuevoItem).stockMinimo}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, stockMinimo: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                  />
                </div>
                <div style={s.fieldGroup}>
                  <label style={s.fieldLabel}>MÁXIMO</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="—"
                    value={(modal as ModalNuevoItem).stockMaximo}
                    onChange={e => setModal(m => m && m.kind === 'nuevo' ? { ...m, stockMaximo: e.target.value } : m)}
                    style={s.fieldInput}
                    disabled={modal.saving}
                  />
                </div>
              </div>
            </div>

            <div style={s.modalFooter}>
              <button
                style={s.cancelBtn}
                onClick={() => !modal.saving && setModal(null)}
                disabled={modal.saving}
              >
                CANCELAR
              </button>
              <button
                style={{ ...s.saveBtn, opacity: modal.saving ? 0.6 : 1 }}
                onClick={guardarNuevoItem}
                disabled={modal.saving}
              >
                {modal.saving ? 'CREANDO...' : '➕ CREAR ÍTEM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  // Root
  root: {
    display:        'flex',
    flexDirection:  'column',
    height:         '100vh',
    background:     'var(--dark)',
    color:          'var(--text)',
    overflow:       'hidden',
    fontFamily:     'monospace, monospace',
  },

  // Header
  header: {
    height:           60,
    background:       'var(--black)',
    borderBottom:     '2px solid var(--yellow)',
    display:          'flex',
    alignItems:       'center',
    justifyContent:   'space-between',
    padding:          '0 16px',
    flexShrink:       0,
    gap:              8,
  },
  backBtn: {
    background:     'transparent',
    border:         '1px solid var(--border)',
    color:          'var(--muted)',
    padding:        '6px 12px',
    cursor:         'pointer',
    fontWeight:     900,
    fontSize:       11,
    letterSpacing:  '0.15em',
    textTransform:  'uppercase',
    flexShrink:     0,
    fontFamily:     'monospace',
  },
  headerCenter: {
    display:        'flex',
    alignItems:     'center',
    gap:            10,
    flex:           1,
    justifyContent: 'center',
  },
  headerTitle: {
    margin:         0,
    fontSize:       17,
    fontWeight:     900,
    letterSpacing:  '0.2em',
    color:          'var(--yellow)',
    textTransform:  'uppercase',
  },
  nuevoItemBtn: {
    background:     'transparent',
    border:         '1px solid var(--yellow)',
    color:          'var(--yellow)',
    padding:        '6px 12px',
    cursor:         'pointer',
    fontWeight:     900,
    fontSize:       10,
    letterSpacing:  '0.12em',
    textTransform:  'uppercase',
    flexShrink:     0,
    fontFamily:     'monospace',
    transition:     'all 0.15s',
  },
  alertasBtn: {
    background:     'transparent',
    border:         '1px solid var(--border)',
    color:          'var(--muted)',
    padding:        '6px 12px',
    cursor:         'pointer',
    fontWeight:     900,
    fontSize:       10,
    letterSpacing:  '0.12em',
    textTransform:  'uppercase',
    flexShrink:     0,
    textAlign:      'center',
    transition:     'all 0.15s',
    fontFamily:     'monospace',
  },
  alertasBtnActive: {
    border:     '1px solid #f59e0b',
    color:      '#f59e0b',
    background: 'rgba(245,158,11,0.08)',
  },

  // Tabs
  tabBar: {
    display:        'flex',
    background:     'var(--black)',
    borderBottom:   '1px solid var(--border)',
    padding:        '0 16px',
    gap:            4,
    flexShrink:     0,
  },
  tabBtn: {
    padding:        '8px 16px',
    background:     'transparent',
    border:         'none',
    borderBottom:   '2px solid transparent',
    color:          'var(--muted)',
    fontWeight:     900,
    fontSize:       11,
    letterSpacing:  '0.15em',
    textTransform:  'uppercase',
    cursor:         'pointer',
    marginBottom:   -1,
    fontFamily:     'monospace',
    transition:     'color 0.15s, border-color 0.15s',
  },
  tabBtnActive: {
    borderBottomColor: 'var(--yellow)',
    color:             'var(--yellow)',
  },

  // Stats bar
  statsBar: {
    display:        'flex',
    alignItems:     'center',
    background:     'var(--black)',
    borderBottom:   '1px solid var(--border)',
    padding:        '0 16px',
    height:         44,
    flexShrink:     0,
    overflowX:      'auto',
  },
  statItem: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    padding:        '0 16px',
    gap:            1,
    flexShrink:     0,
  },
  statNum: {
    fontSize:  16,
    fontWeight: 900,
    lineHeight: 1,
    color:     'var(--text)',
  },
  statLbl: {
    fontSize:      9,
    fontWeight:    900,
    letterSpacing: '0.2em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
  },
  statDivider: {
    width:      1,
    height:     24,
    background: 'var(--border)',
    flexShrink: 0,
  },

  // Search bar
  searchWrap: {
    display:        'flex',
    alignItems:     'center',
    gap:            10,
    background:     'var(--black)',
    borderBottom:   '1px solid var(--border)',
    padding:        '8px 16px',
    flexShrink:     0,
  },
  searchIcon: {
    fontSize:   14,
    flexShrink: 0,
    opacity:    0.5,
  },
  searchInput: {
    flex:          1,
    background:    'transparent',
    border:        'none',
    outline:       'none',
    color:         'var(--text)',
    fontSize:      12,
    fontWeight:    900,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontFamily:    'monospace',
  },
  searchClear: {
    background:  'transparent',
    border:      'none',
    color:       'var(--muted)',
    cursor:      'pointer',
    fontSize:    12,
    padding:     '0 4px',
    flexShrink:  0,
  },

  // Main scrollable area
  main: {
    flex:       1,
    overflowY:  'auto',
    overflowX:  'hidden',
  },
  listWrap: {
    paddingBottom: 32,
  },

  // Category header
  catHeader: {
    fontSize:      10,
    fontWeight:    900,
    letterSpacing: '0.25em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
    padding:       '12px 16px 6px',
    display:       'flex',
    alignItems:    'center',
    gap:           8,
    background:    'var(--dark)',
    borderBottom:  '1px solid var(--border)',
    position:      'sticky',
    top:           0,
    zIndex:        1,
  },
  catCount: {
    background:    'var(--charcoal)',
    border:        '1px solid var(--border)',
    color:         'var(--muted)',
    fontSize:      9,
    fontWeight:    900,
    padding:       '1px 6px',
    letterSpacing: '0.1em',
  },

  // Card
  card: {
    background:    'var(--charcoal)',
    borderBottom:  '1px solid var(--border)',
    display:       'flex',
    alignItems:    'center',
    padding:       '10px 14px',
    gap:           10,
  },
  cardLeft: {
    display:    'flex',
    alignItems: 'flex-start',
    gap:        10,
    flex:       1,
    minWidth:   0,
  },
  cardEmoji: {
    fontSize:   22,
    flexShrink: 0,
    width:      28,
    textAlign:  'center',
    lineHeight: 1.3,
  },
  cardRow: {
    display:        'flex',
    alignItems:     'center',
    gap:            8,
    flexWrap:       'wrap',
    marginBottom:   4,
  },
  cardName: {
    fontSize:      12,
    fontWeight:    900,
    letterSpacing: '0.06em',
    color:         'var(--text)',
    textTransform: 'uppercase',
  },
  statusBadge: {
    fontSize:      9,
    fontWeight:    900,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding:       '2px 7px',
    flexShrink:    0,
  },

  // Progress bar
  progressTrack: {
    height:       4,
    background:   'var(--border)',
    marginBottom: 5,
    overflow:     'hidden',
  },
  progressFill: {
    height:     '100%',
    transition: 'width 0.3s ease',
  },

  // Stock numbers
  stockNums: {
    display:    'flex',
    alignItems: 'baseline',
    gap:        5,
    flexWrap:   'wrap',
  },
  stockActual: {
    fontSize:   18,
    fontWeight: 900,
    lineHeight: 1,
  },
  stockUnit: {
    fontSize:      10,
    fontWeight:    900,
    letterSpacing: '0.1em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
  },
  stockSep: {
    fontSize: 11,
    color:    'var(--border)',
  },
  stockMeta: {
    fontSize:  10,
    fontWeight: 700,
    color:     'var(--muted)',
  },

  // Card right controls
  cardRight: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    flexShrink: 0,
  },
  recibirBtn: {
    width:      32,
    height:     32,
    background: 'transparent',
    border:     '1px solid var(--border)',
    color:      'var(--text)',
    cursor:     'pointer',
    fontSize:   16,
    display:    'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.1s',
    flexShrink: 0,
  },
  controls: {
    display:    'flex',
    alignItems: 'center',
    gap:        3,
  },
  controlBtn: {
    width:          30,
    height:         30,
    background:     'var(--dark)',
    border:         '1px solid var(--border)',
    color:          'var(--text)',
    cursor:         'pointer',
    fontWeight:     900,
    fontSize:       18,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    lineHeight:     1,
    transition:     'all 0.1s',
    flexShrink:     0,
  },
  controlBtnPlus: {
    border: '1px solid rgba(34,197,94,0.4)',
    color:  '#22c55e',
  },
  editBtn: {
    width:          30,
    height:         30,
    background:     'transparent',
    border:         '1px solid var(--border)',
    color:          'var(--muted)',
    cursor:         'pointer',
    fontSize:       14,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    transition:     'all 0.1s',
    flexShrink:     0,
  },
  configurarBtn: {
    background:    'transparent',
    border:        '1px solid var(--yellow)',
    color:         'var(--yellow)',
    padding:       '5px 12px',
    cursor:        'pointer',
    fontWeight:    900,
    fontSize:      10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    transition:    'all 0.15s',
    fontFamily:    'monospace',
  },

  // Historial row
  historialRow: {
    background:    'var(--charcoal)',
    borderBottom:  '1px solid var(--border)',
    display:       'flex',
    alignItems:    'center',
    padding:       '10px 14px',
    gap:           12,
  },
  historialNombre: {
    fontSize:      12,
    fontWeight:    900,
    color:         'var(--text)',
    textTransform: 'uppercase',
    overflow:      'hidden',
    textOverflow:  'ellipsis',
    whiteSpace:    'nowrap',
    letterSpacing: '0.06em',
  },
  historialMotivo: {
    fontSize:  10,
    color:     'var(--muted)',
    marginTop: 2,
  },
  historialCambio: {
    fontSize:   18,
    fontWeight: 900,
    flexShrink: 0,
  },
  historialUser: {
    fontSize:  10,
    color:     'var(--muted)',
    fontWeight: 900,
    textAlign: 'right',
  },
  historialHora: {
    fontSize:  10,
    color:     'var(--muted)',
    textAlign: 'right',
  },

  // Empty / loading
  center: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    height:         '55vh',
    gap:            14,
    textAlign:      'center',
    padding:        '0 24px',
  },
  emptyText: {
    fontSize:      11,
    fontWeight:    900,
    letterSpacing: '0.2em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
    margin:        0,
  },

  // Modal overlay
  overlay: {
    position:       'fixed',
    inset:          0,
    background:     'rgba(0,0,0,0.88)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:         999,
    backdropFilter: 'blur(4px)',
    padding:        '0 12px',
  },
  modalBox: {
    width:         '100%',
    maxWidth:      400,
    background:    'var(--charcoal)',
    border:        '1px solid var(--border)',
    borderTop:     '3px solid var(--yellow)',
    display:       'flex',
    flexDirection: 'column',
    maxHeight:     '90vh',
    overflowY:     'auto',
  },
  modalHeader: {
    display:       'flex',
    alignItems:    'center',
    gap:           12,
    padding:       '14px 18px',
    borderBottom:  '1px solid var(--border)',
    flexShrink:    0,
  },
  modalTitle: {
    fontSize:      13,
    fontWeight:    900,
    letterSpacing: '0.08em',
    color:         'var(--text)',
    textTransform: 'uppercase',
  },
  modalSubtitle: {
    fontSize:      9,
    fontWeight:    900,
    letterSpacing: '0.2em',
    color:         'var(--yellow)',
    textTransform: 'uppercase',
    marginTop:     2,
  },
  closeBtn: {
    background:     'transparent',
    border:         '1px solid var(--border)',
    color:          'var(--muted)',
    width:          28,
    height:         28,
    cursor:         'pointer',
    fontSize:       12,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  modalBody: {
    padding:       '16px 18px 12px',
    display:       'flex',
    flexDirection: 'column',
    gap:           12,
  },
  modalInfoRow: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '8px 12px',
    background:     'var(--dark)',
    border:         '1px solid var(--border)',
  },
  modalInfoLabel: {
    fontSize:      10,
    fontWeight:    900,
    letterSpacing: '0.15em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
  },
  modalInfoValue: {
    fontSize:  14,
    fontWeight: 900,
    color:     'var(--yellow)',
  },
  fieldGroup: {
    display:       'flex',
    flexDirection: 'column',
    gap:           5,
  },
  fieldLabel: {
    fontSize:      10,
    fontWeight:    900,
    letterSpacing: '0.2em',
    color:         'var(--muted)',
    textTransform: 'uppercase',
  },
  fieldInput: {
    width:       '100%',
    padding:     '9px 12px',
    background:  'var(--dark)',
    border:      '1px solid var(--border)',
    color:       'var(--text)',
    fontSize:    15,
    fontWeight:  900,
    outline:     'none',
    boxSizing:   'border-box',
    fontFamily:  'monospace',
  },
  fieldSelect: {
    width:         '100%',
    padding:       '9px 12px',
    background:    'var(--dark)',
    border:        '1px solid var(--border)',
    color:         'var(--text)',
    fontSize:      13,
    fontWeight:    900,
    letterSpacing: '0.1em',
    outline:       'none',
    cursor:        'pointer',
    appearance:    'none',
    boxSizing:     'border-box',
    fontFamily:    'monospace',
  },
  modalPreview: {
    display:    'flex',
    alignItems: 'center',
    padding:    '10px 12px',
    background: 'var(--dark)',
    border:     '1px solid var(--border)',
  },
  modalFooter: {
    display:     'flex',
    gap:         0,
    borderTop:   '1px solid var(--border)',
    flexShrink:  0,
  },
  cancelBtn: {
    flex:          1,
    padding:       '13px',
    background:    'var(--dark)',
    border:        'none',
    borderRight:   '1px solid var(--border)',
    color:         'var(--muted)',
    cursor:        'pointer',
    fontWeight:    900,
    fontSize:      11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    fontFamily:    'monospace',
  },
  saveBtn: {
    flex:          1,
    padding:       '13px',
    background:    'var(--yellow)',
    border:        'none',
    color:         '#000',
    cursor:        'pointer',
    fontWeight:    900,
    fontSize:      11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    transition:    'opacity 0.15s',
    fontFamily:    'monospace',
  },
}
