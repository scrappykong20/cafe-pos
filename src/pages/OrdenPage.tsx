import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import type { CartItem, OrdenItem, UsuarioPerfil } from '../types'
import toast from 'react-hot-toast'
import CheckoutModal from '../components/CheckoutModal'
import ModificadoresModal from '../components/ModificadoresModal'
import { registrarAccion } from '../services/auditLog'
import { imprimirPorTipo, hayImpresora, buildComandaHTML, buildPreTicketHTML } from '../services/printer'

interface Props {
  mesaId: string | null
  mesaNombre: string
  cajero: UsuarioPerfil
  tipo: 'llevar' | 'comedor' | 'empleado'
  onVolver: () => void
}

interface MenuItem {
  id: string
  nombre: string
  descripcion: string
  emoji: string
  categoria: string
  precio: number
  disponible: boolean
  destaque: boolean
  orden: number
  // Mejora 1: Fotos
  imagen_url?: string
  // Mejora 2: Horario
  hora_inicio?: string
  hora_fin?: string
  // Mejora 3: Alérgenos
  alergenos?: string[]
  // Mejora 4: Combos
  es_combo?: boolean
  combo_ids?: string[]
}

interface CatTab {
  id: string
  nombre: string
  emoji: string
}

const CAT_TODAS: CatTab = { id: 'todas', nombre: 'Todo', emoji: '🍽️' }

// Supergrupos de categorías para navegación de 2 niveles
const SUPERGRUPOS: { id: string; nombre: string; emoji: string; cats: string[] }[] = [
  { id: 'bebidas', nombre: 'Bebidas', emoji: '☕', cats: ['cafe_caliente','cafe_frio','frappe','sin_cafe','cafe','bebida_fria'] },
  { id: 'comida',  nombre: 'Comida',  emoji: '🍽️', cats: ['croissant','baguette','cuernito','sandwich','pan_dulce','waffle','crepa','panaderia','alimento'] },
]

// Mejora 3 — Mapa de emojis para alérgenos
const ALERGENO_ICONS: Record<string, string> = {
  gluten: '🌾',
  lacteos: '🥛',
  lácteos: '🥛',
  nueces: '🥜',
  huevo: '🥚',
  mariscos: '🦐',
  soya: '🫘',
}
function getAlergenoEmoji(a: string): string {
  const key = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const [k, v] of Object.entries(ALERGENO_ICONS)) {
    if (key.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return v
  }
  return '⚠️'
}

const LEGACY: Record<string, { nombre: string; emoji: string }> = {
  // Legacy
  cafe:           { nombre: 'Cafés',       emoji: '☕' },
  bebida_fria:    { nombre: 'Frías',       emoji: '🧊' },
  panaderia:      { nombre: 'Panadería',   emoji: '🥐' },
  alimento:       { nombre: 'Alimentos',   emoji: '🍳' },
  // New categories
  cafe_caliente:  { nombre: 'Calientes',   emoji: '☕' },
  cafe_frio:      { nombre: 'Frías',       emoji: '🧊' },
  frappe:         { nombre: 'Frappes',     emoji: '🧋' },
  sin_cafe:       { nombre: 'Sin Café',    emoji: '🥤' },
  croissant:      { nombre: 'Croissant',   emoji: '🥐' },
  baguette:       { nombre: 'Baguette',    emoji: '🥖' },
  cuernito:       { nombre: 'Cuernito',    emoji: '🥐' },
  sandwich:       { nombre: 'Sandwich',    emoji: '🥪' },
  pan_dulce:      { nombre: 'Pan Dulce',   emoji: '🍞' },
  waffle:         { nombre: 'Waffles',     emoji: '🧇' },
  crepa:          { nombre: 'Crepas',      emoji: '🥞' },
}

export default function OrdenPage({ mesaId, mesaNombre, cajero, tipo, onVolver }: Props) {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [categorias, setCategorias] = useState<CatTab[]>([CAT_TODAS])
  const [catActiva, setCatActiva] = useState<string>('todas')
  const [supergrupo, setSupergrupo] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  // snapshotCocina: cantidad de cada item YA enviada a cocina (menu_id → cantidad)
  // Se actualiza al cargar la orden y cada vez que se manda a cocina
  const [snapshotCocina, setSnapshotCocina] = useState<Map<string, number>>(new Map())
  const [ordenId, setOrdenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [productoSeleccionado, setProductoSeleccionado] = useState<MenuItem | null>(null)
  const [descuento, setDescuento] = useState<{ tipo: 'porcentaje' | 'fijo'; valor: number } | null>(null)
  const [checkoutItems, setCheckoutItems] = useState<CartItem[] | null>(null)
  const [showCancelOrdenConfirm, setShowCancelOrdenConfirm] = useState(false)
  const [tiempoOrden, setTiempoOrden] = useState<number>(0)
  const ordenIniciadaEn = useRef<number>(Date.now())
  const broadcastRef = useRef<BroadcastChannel | null>(null)
  const creandoOrdenRef = useRef(false)
  const agregandoRef = useRef(false)
  const addedTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; producto: MenuItem } | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [notaOrden, setNotaOrden] = useState('')
  const [numPersonas, setNumPersonas] = useState(1)
  const [showHistorial, setShowHistorial] = useState(false)
  const [historialOrdenes, setHistorialOrdenes] = useState<{id:string; created_at:string; estado:string; orden_items:{nombre:string;cantidad:number}[]}[]>([])
  // 'resumen' cuando la mesa ya tiene items, 'menu' para agregar productos
  // Si localStorage ya tiene items para esta mesa → empezar en resumen directamente
  const [vistaOrden, setVistaOrden] = useState<'resumen' | 'menu'>(() => {
    if (!mesaId) return 'menu'
    try {
      const saved = localStorage.getItem(`pos_cart_${mesaId}`)
      if (saved) {
        const parsed = JSON.parse(saved) as CartItem[]
        if (parsed.length > 0) return 'resumen'
      }
    } catch {}
    return 'menu'
  })
  // A1 — Persistencia en localStorage
  const localStorageCartKey = mesaId ? `pos_cart_${mesaId}` : null
  // C3 — Animación pulse al agregar
  const [addedItems, setAddedItems] = useState<Set<string>>(new Set())
  // B5 — Cambiar mesa
  const [showCambiarMesa, setShowCambiarMesa] = useState(false)
  const [mesasLibres, setMesasLibres] = useState<{id:string;numero:number;nombre:string}[]>([])
  const [currentMesaId, setCurrentMesaId] = useState<string | null>(mesaId)
  const [currentMesaNombre, setCurrentMesaNombre] = useState<string>(mesaNombre)
  // Mejora 5 — Toggle vista grid/lista
  const [vistaMenu, setVistaMenu] = useState<'grid' | 'lista'>(() => {
    try { return (localStorage.getItem('pos_vista_menu') as 'grid' | 'lista') || 'grid' } catch { return 'grid' }
  })
  // Acceso rápido — top 6 productos más vendidos
  const [favoritos, setFavoritos] = useState<MenuItem[]>([])
  // ── Delivery modal ────────────────────────────────────────────────────────
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [deliveryForm, setDeliveryForm] = useState({ nombre: '', telefono: '', direccion: '' })
  const [enviandoDelivery, setEnviandoDelivery] = useState(false)
  // BUG 17 — guard para evitar doble envío a cocina
  const [mandando, setMandando] = useState(false)
  // Cuando termina la carga inicial y hay artículos → cambiar a resumen automáticamente
  useEffect(() => {
    if (!loading && cart.length > 0) {
      setVistaOrden('resumen')
    }
  // Solo reaccionar cuando loading cambia (carga inicial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // BroadcastChannel para pantalla del cliente
  useEffect(() => {
    try { broadcastRef.current = new BroadcastChannel('pos-customer-display') } catch {}
    return () => { broadcastRef.current?.close() }
  }, [])

  // BUG 20 — Limpiar timers de addedItems al desmontar
  useEffect(() => {
    return () => { addedTimersRef.current.forEach(clearTimeout) }
  }, [])

  // Broadcast cuando cambia el carrito
  useEffect(() => {
    broadcastRef.current?.postMessage({
      type: cart.length > 0 ? 'cart_update' : 'idle',
      items: cart.map(i => ({ nombre: i.nombre, emoji: i.emoji, precio: i.precio, cantidad: i.cantidad })),
      total: cart.reduce((s, i) => s + i.precio * i.cantidad, 0),
      mesa: currentMesaNombre,
    })
  }, [cart, currentMesaNombre])

  // A1 — Guardar carrito en localStorage cuando cambia (BUG 2: maneja QuotaExceededError)
  useEffect(() => {
    if (!localStorageCartKey || loading) return
    if (cart.length > 0) {
      try {
        localStorage.setItem(localStorageCartKey, JSON.stringify(cart))
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          console.warn('[POS] localStorage lleno - carrito no persistido')
        }
      }
    } else {
      try { localStorage.removeItem(localStorageCartKey) } catch {}
    }
  }, [cart, localStorageCartKey, loading])

  const subtotal = cart.reduce((s, i) => s + (i.precio ?? 0) * i.cantidad, 0)
  const descuentoMonto = descuento
    ? descuento.tipo === 'porcentaje'
      ? parseFloat((subtotal * descuento.valor / 100).toFixed(2))
      : Math.min(descuento.valor, subtotal)
    : 0
  const total = subtotal - descuentoMonto
  const totalItems = cart.reduce((s, i) => s + i.cantidad, 0)

  // Categorías visibles según el supergrupo activo
  const categoriasVisibles = supergrupo
    ? categorias.filter(c => c.id === 'todas' || (SUPERGRUPOS.find(sg => sg.id === supergrupo)?.cats ?? []).includes(c.id))
    : categorias

  const menuFiltrado = (() => {
    let base = menu
    if (supergrupo) {
      const sgCats = SUPERGRUPOS.find(sg => sg.id === supergrupo)?.cats ?? []
      base = menu.filter(p => sgCats.includes(p.categoria))
    }
    const termino = busqueda.trim().toLowerCase()
    if (termino) return base.filter(p =>
      p.nombre.toLowerCase().includes(termino) || p.descripcion?.toLowerCase().includes(termino)
    )
    if (catActiva === 'todas') return base
    return base.filter(p => p.categoria === catActiva)
  })()

  // Mejora 2 — Disponibilidad por horario (BUG 1: ahora convierte a minutos y maneja medianoche)
  function productoDisponibleAhora(producto: MenuItem): boolean {
    if (!producto.hora_inicio || !producto.hora_fin) return true
    const ahora = new Date()
    const horaAhora = ahora.getHours() * 60 + ahora.getMinutes()
    const [h1, m1] = producto.hora_inicio.split(':').map(Number)
    const [h2, m2] = producto.hora_fin.split(':').map(Number)
    const inicio = h1 * 60 + m1
    const fin = h2 * 60 + m2
    if (inicio > fin) return horaAhora >= inicio || horaAhora <= fin
    return horaAhora >= inicio && horaAhora <= fin
  }

  function formatHorario(producto: MenuItem): string {
    if (!producto.hora_inicio || !producto.hora_fin) return ''
    function fmt(t: string) {
      const [hh, mm] = t.split(':').map(Number)
      const suffix = hh >= 12 ? 'pm' : 'am'
      const h = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh
      return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2,'0')}${suffix}`
    }
    return `${fmt(producto.hora_inicio)}-${fmt(producto.hora_fin)}`
  }

  const MENU_CACHE_KEY = 'pos_menu_cache'

  const cargarDatos = useCallback(async () => {
    // Si estamos offline, cargar desde caché local
    if (!navigator.onLine) {
      try {
        const cached = localStorage.getItem(MENU_CACHE_KEY)
        if (cached) {
          const todosMenu = JSON.parse(cached) as MenuItem[]
          setMenu(todosMenu)
          const disponibles = todosMenu.filter(p => p.disponible !== false)
          const unicos = [...new Set(disponibles.map(p => p.categoria).filter(Boolean))]
          setCategorias([CAT_TODAS, ...unicos.map(id => ({
            id,
            nombre: LEGACY[id]?.nombre ?? id,
            emoji: LEGACY[id]?.emoji ?? '🍽️',
          }))])
          return
        }
      } catch {}
      setError('Sin conexión y sin caché de menú disponible')
      return
    }

    try {
      let { data: menuData, error: menuErr } = await supabase
        .from('menu')
        .select('id,nombre,descripcion,emoji,categoria,precio,disponible,destaque,orden,imagen_url,hora_inicio,hora_fin,alergenos,es_combo,combo_ids')
        .order('orden')
      // Si fallan las columnas nuevas (aún no migradas), usar columnas base
      if (menuErr) {
        const fallback = await supabase
          .from('menu')
          .select('id,nombre,descripcion,emoji,categoria,precio,disponible,destaque,orden')
          .order('orden')
        if (fallback.error) { setError(`Error al cargar el menú: ${fallback.error.message}`); return }
        menuData = fallback.data as typeof menuData
        menuErr = null
      }

      // B1 — cargar TODOS los productos (incluyendo agotados) para mostrar overlay
      const todosMenu = (menuData || []) as MenuItem[]
      // Guardar en caché para uso offline
      try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(todosMenu)) } catch {}
      setMenu(todosMenu)

      const disponibles = todosMenu.filter(p => p.disponible !== false)
      const unicos = [...new Set(disponibles.map(p => p.categoria).filter(Boolean))]
      setCategorias([CAT_TODAS, ...unicos.map(id => ({
        id,
        nombre: LEGACY[id]?.nombre ?? id,
        emoji: LEGACY[id]?.emoji ?? '🍽️',
      }))])

      if (mesaId) {
        // Buscar orden: primero por orden_id directo de la mesa (funciona con mesas juntadas),
        // luego fallback por mesa_id (para órdenes normales)
        const { data: mesaRow } = await supabase.from('mesas').select('orden_id').eq('id', mesaId).maybeSingle()
        let ordenData: any = null
        if (mesaRow?.orden_id) {
          const { data } = await supabase
            .from('ordenes').select('*, orden_items(*)')
            .eq('id', mesaRow.orden_id).in('estado', ['en_caja', 'abierta']).maybeSingle()
          ordenData = data
        }
        if (!ordenData) {
          const { data } = await supabase
            .from('ordenes').select('*, orden_items(*)')
            .eq('mesa_id', mesaId).in('estado', ['en_caja', 'abierta']).maybeSingle()
          ordenData = data
        }
        if (ordenData) {
          setOrdenId(ordenData.id)
          setNotaOrden(ordenData.notas ?? '')
          setNumPersonas(ordenData.num_personas ?? 1)
          const items = (ordenData.orden_items as OrdenItem[]).map(i => ({
            menu_id: i.menu_id ?? i.id,
            nombre: i.nombre, emoji: i.emoji,
            precio: i.precio ?? 0, cantidad: i.cantidad,
            notas: i.notas ?? undefined,
          }))
          setCart(items)
          // Solo marcar items como "ya en cocina" si la orden fue realmente enviada (estado 'abierta')
          // Si estado es 'en_caja', la orden existe pero nunca se mandó → snapshot vacío
          if (ordenData.estado === 'abierta') {
            setSnapshotCocina(new Map(items.map(i => [i.menu_id, i.cantidad])))
          }
          // Ir directo a resumen si ya hay artículos en la orden
          if (items.length > 0) setVistaOrden('resumen')
          // A1 — limpiar localStorage si ya tenemos datos de BD
          try { if (localStorageCartKey) localStorage.removeItem(localStorageCartKey) } catch {}
        } else {
          // A1 — restaurar carrito desde localStorage si existe
          try {
            const saved = localStorageCartKey ? localStorage.getItem(localStorageCartKey) : null
            if (saved) {
              const parsed = JSON.parse(saved) as CartItem[]
              if (parsed.length > 0) {
                setCart(parsed)
                // Si había artículos guardados localmente, también ir a resumen
                setVistaOrden('resumen')
              }
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [mesaId])

  useEffect(() => {
    const t = setTimeout(() => setLoading(prev => { if (prev) setError('Tiempo agotado.'); return false }), 10000)
    cargarDatos().finally(() => clearTimeout(t))
  }, [cargarDatos])

  useEffect(() => {
    if (!ordenId) return
    const canal = supabase.channel(`orden-${ordenId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orden_items', filter: `orden_id=eq.${ordenId}` }, cargarDatos)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [ordenId, cargarDatos])

  // Order timer
  useEffect(() => {
    if (!ordenId) { ordenIniciadaEn.current = Date.now(); setTiempoOrden(0); return }
    const iv = setInterval(() => {
      setTiempoOrden(Math.floor((Date.now() - ordenIniciadaEn.current) / 60000))
    }, 10000)
    return () => clearInterval(iv)
  }, [ordenId])

  // Acceso rápido — cargar top 6 favoritos desde venta_items (BUG 8: filtra por último mes)
  useEffect(() => {
    if (menu.length === 0) return
    let cancelled = false
    async function cargarFavoritos() {
      const hace30dias = new Date()
      hace30dias.setDate(hace30dias.getDate() - 30)
      const { data, error: favErr } = await supabase
        .from('venta_items')
        .select('menu_id, cantidad')
        .gte('created_at', hace30dias.toISOString())
        .limit(1000)
      if (favErr || !data || cancelled) return

      // Agregar totales por menu_id
      const totales: Record<string, number> = {}
      for (const row of data) {
        if (!row.menu_id) continue
        totales[row.menu_id] = (totales[row.menu_id] ?? 0) + (row.cantidad ?? 1)
      }

      // Ordenar por cantidad vendida y tomar los top 6 que estén disponibles en menu
      const disponibles = menu.filter(p => p.disponible)
      const sorted = disponibles
        .filter(p => totales[p.id] !== undefined)
        .sort((a, b) => (totales[b.id] ?? 0) - (totales[a.id] ?? 0))
        .slice(0, 6)

      if (!cancelled) setFavoritos(sorted)
    }
    cargarFavoritos()
    return () => { cancelled = true }
  }, [menu])

  // Marcar producto agotado/disponible desde el POS
  async function toggleDisponible(producto: MenuItem) {
    setCtxMenu(null)
    const nuevo = !producto.disponible
    const { error } = await supabase.from('menu').update({ disponible: nuevo }).eq('id', producto.id)
    if (error) { toast.error('Error al actualizar producto'); return }
    setMenu(prev => prev.map(p => p.id === producto.id ? { ...p, disponible: nuevo } : p))
    toast.success(nuevo ? `✓ ${producto.nombre} disponible` : `⊘ ${producto.nombre} marcado como agotado`)
  }

  // Long press handler para contexto en mobile
  function onLongPressStart(e: React.TouchEvent, producto: MenuItem) {
    const touch = e.touches[0]
    longPressRef.current = setTimeout(() => {
      setCtxMenu({ x: touch.clientX, y: touch.clientY, producto })
    }, 600)
  }

  function onLongPressEnd() {
    if (longPressRef.current) clearTimeout(longPressRef.current)
  }

  // Sound + haptic on add — reutiliza un único AudioContext para evitar límite del navegador
  function playAddSound() {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.12)
    } catch {}
    try { navigator.vibrate?.(40) } catch {}
  }

  // Floating emoji fly-up effect on add
  function flyEffect(emoji: string, x: number, y: number) {
    const el = document.createElement('div')
    el.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;font-size:1.6rem;
      pointer-events:none;z-index:9999;
      animation:fly-up 0.55s ease-out forwards;
    `
    el.textContent = emoji
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 600)
  }

  // Abre el modal de modificadores (o agrega directo si no tiene)
  async function seleccionarProducto(producto: MenuItem) {
    // B1 — bloquear productos agotados o fuera de horario
    if (!producto.disponible) return
    if (!productoDisponibleAhora(producto)) return

    // Verificar si tiene modificadores
    const { data: links, error: linksErr } = await supabase
      .from('menu_modificadores')
      .select('grupo_id')
      .eq('menu_id', producto.id)
      .limit(1)
    if (linksErr) { console.error('Error al cargar modificadores:', linksErr.message) }

    if (links && links.length > 0) {
      setProductoSeleccionado(producto)
    } else {
      await agregarProducto(producto, producto.precio ?? 0, null, 1)
    }
  }

  async function agregarProducto(producto: MenuItem, precio: number, notas: string | null, cantidad: number) {
    // BUG 16 — evitar doble envío concurrente
    if (agregandoRef.current) return
    agregandoRef.current = true
    try {
    playAddSound()
    // C3 — animación pulse al agregar
    setAddedItems(prev => new Set([...prev, producto.id]))
    const t = setTimeout(() => {
      setAddedItems(prev => { const n = new Set(prev); n.delete(producto.id); return n })
    }, 400)
    addedTimersRef.current.push(t)
    // Volver a resumen después de agregar para que el usuario vea el carrito actualizado
    setVistaOrden('resumen')

    // Usamos nombre+notas como key única para permitir el mismo producto con distintos modificadores
    const cartKey = notas ? `${producto.id}__${notas}` : producto.id

    setCart(prev => {
      const ex = prev.find(i => i.menu_id === cartKey)
      if (ex) return prev.map(i => i.menu_id === cartKey ? { ...i, cantidad: i.cantidad + cantidad } : i)
      return [...prev, {
        menu_id: cartKey,
        producto_id: producto.id, // ID real del producto (sin notas concatenadas)
        nombre: producto.nombre + (notas ? ` (${notas})` : ''),
        emoji: producto.emoji,
        precio: precio ?? 0,
        cantidad,
        notas: notas ?? undefined,
      }]
    })

    let curOrdenId = ordenId
    if (!curOrdenId) {
      // Evitar crear orden duplicada si se toca dos veces seguido antes de que termine la primera llamada
      if (creandoOrdenRef.current) return
      creandoOrdenRef.current = true
      // Calcular número diario
      const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0)
      const { count: ordenCount } = await supabase.from('ordenes').select('*', { count: 'exact', head: true }).gte('created_at', hoyInicio.toISOString())
      const numeroDiario = (ordenCount ?? 0) + 1

      const { data: nueva, error: err } = await supabase.from('ordenes').insert({
        mesa_id: currentMesaId ?? null,
        mesa_nombre: currentMesaNombre,
        cajero_id: cajero.id,
        cajero_nombre: `${cajero.nombre} ${cajero.last_name}`,
        usuario_id: null,
        estado: tipo === 'llevar' ? 'abierta' : 'en_caja',
        notas: notaOrden.trim() || null,
        tipo: tipo === 'empleado' ? 'comedor' : tipo,
        num_personas: tipo === 'comedor' ? numPersonas : 1,
        numero_diario: numeroDiario,
      }).select().maybeSingle()

      if (err || !nueva) {
        // Sin conexión: mantener el item en carrito en modo offline
        if (!navigator.onLine || err?.message?.includes('fetch')) {
          toast('Sin conexión — ítem agregado localmente', { icon: '📶', duration: 3000 })
          creandoOrdenRef.current = false
          return  // El item ya está en cart; checkout lo sincronizará
        }
        toast.error(`Error al crear la orden: ${err?.message || 'sin datos'}`)
        setCart(prev => prev.filter(i => i.menu_id !== cartKey))
        creandoOrdenRef.current = false
        return
      }
      curOrdenId = nueva.id
      setOrdenId(nueva.id)
      creandoOrdenRef.current = false
      if (currentMesaId) await supabase.from('mesas').update({ estado: 'ocupada', orden_id: nueva.id }).eq('id', currentMesaId)
    }

    // Acumular cantidad si el ítem ya existe sin modificadores
    if (!curOrdenId) return  // offline: sin orden en BD, el carrito ya tiene el item
    let itemExQuery = supabase.from('orden_items').select('id, cantidad')
      .eq('orden_id', curOrdenId).eq('menu_id', producto.id)
    // notas NULL debe buscarse con .is('notas', null), no .eq('notas', '')
    if (notas) {
      itemExQuery = itemExQuery.eq('notas', notas)
    } else {
      itemExQuery = itemExQuery.is('notas', null)
    }
    const { data: itemEx } = await itemExQuery.maybeSingle()

    if (itemEx) {
      // Si ya existe (con o sin notas), acumular cantidad
      await supabase.from('orden_items').update({ cantidad: itemEx.cantidad + cantidad }).eq('id', itemEx.id)
    } else {
      await supabase.from('orden_items').insert({
        orden_id: curOrdenId, menu_id: producto.id,
        nombre: producto.nombre, emoji: producto.emoji,
        precio: precio ?? 0, cantidad, notas: notas ?? null,
      })
    }
    } finally {
      // BUG 16 — liberar guard de doble envío
      agregandoRef.current = false
    }
  }

  async function cargarHistorial() {
    if (!mesaId) return
    const { data } = await supabase
      .from('ordenes')
      .select('id, created_at, estado, orden_items(nombre, cantidad)')
      .eq('mesa_id', mesaId)
      .in('estado', ['pagada', 'cancelada', 'entregada'])
      .order('created_at', { ascending: false })
      .limit(5)
    setHistorialOrdenes((data ?? []) as typeof historialOrdenes)
    setShowHistorial(true)
  }

  async function printTicket() {
    if (cart.length === 0) return
    if (!hayImpresora('caja')) { toast('No hay impresora de caja configurada', { icon: '⚠️' }); return }

    const { data: ajustes } = await supabase
      .from('configuracion').select('clave, valor').in('clave', ['rest_nombre', 'rest_direccion', 'rest_telefono'])
    const aj: Record<string, string> = {}
    for (const r of ajustes ?? []) aj[r.clave] = r.valor

    const escpos = buildPreTicketHTML({
      mesaNombre,
      cajeroNombre: `${cajero.nombre} ${cajero.last_name}`,
      items: cart.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, notas: i.notas ?? null })),
      descuento: descuentoMonto,
      notaOrden: notaOrden || undefined,
      nombreLocal: aj['rest_nombre'],
      direccionLocal: aj['rest_direccion'],
      telefonoLocal: aj['rest_telefono'],
    })

    const ok = await imprimirPorTipo('caja', escpos)
    if (!ok) toast.error('Error al imprimir — verifica la configuracion de impresora')
  }

  async function cambiarCantidad(menuId: string, delta: number) {
    const item = cart.find(i => i.menu_id === menuId)
    if (!item) return
    const nueva = item.cantidad + delta
    if (nueva <= 0) { eliminarItem(menuId); return }
    setCart(prev => prev.map(i => i.menu_id === menuId ? { ...i, cantidad: nueva } : i))
    if (ordenId) {
      // menu_id en cart puede ser "uuid__notas" — usar el ID real para la query
      const realMenuId = item.producto_id ?? menuId.split('__')[0]
      let q = supabase.from('orden_items').select('id').eq('orden_id', ordenId).eq('menu_id', realMenuId)
      if (item.notas) q = q.eq('notas', item.notas)
      else q = q.is('notas', null)
      const { data: bd } = await q.maybeSingle()
      if (bd) await supabase.from('orden_items').update({ cantidad: nueva }).eq('id', bd.id)
    }
  }

  async function eliminarItem(menuId: string) {
    const item = cart.find(i => i.menu_id === menuId)
    setCart(prev => prev.filter(i => i.menu_id !== menuId))
    if (ordenId && item) {
      // menu_id en cart puede ser "uuid__notas" — usar el ID real para la query
      const realMenuId = item.producto_id ?? menuId.split('__')[0]
      let q = supabase.from('orden_items').delete().eq('orden_id', ordenId).eq('menu_id', realMenuId)
      if (item.notas) q = q.eq('notas', item.notas)
      else q = q.is('notas', null)
      await q
    }
  }

  // Si el carrito está vacío y hay una orden abierta sin productos, la cancela y libera la mesa
  async function handleVolver() {
    if (cart.length === 0) {
      if (ordenId) {
        await supabase.from('ordenes').update({ estado: 'cancelada', cerrada_at: new Date().toISOString() }).eq('id', ordenId)
        // Liberar todas las mesas que apunten a esta orden (incluye mesas juntadas)
        await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('orden_id', ordenId)
      } else if (currentMesaId) {
        await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('id', currentMesaId)
      }
    }
    onVolver()
  }

  async function cancelarOrden() {
    if (cart.length === 0) { await handleVolver(); return }
    setShowCancelOrdenConfirm(true)
  }

  async function confirmarCancelOrden() {
    setShowCancelOrdenConfirm(false)
    if (ordenId) {
      const { error: e1 } = await supabase.from('ordenes').update({ estado: 'cancelada', cerrada_at: new Date().toISOString() }).eq('id', ordenId)
      if (e1) { toast.error('Error al cancelar orden'); return }
      // Liberar todas las mesas que apunten a esta orden (incluye mesas juntadas)
      await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('orden_id', ordenId)
    }
    // A1 — limpiar localStorage al cancelar
    if (localStorageCartKey) { try { localStorage.removeItem(localStorageCartKey) } catch {} }
    setCart([]); setOrdenId(null); onVolver()
  }

  async function mandarACocina() {
    // BUG 17 — evitar doble envío concurrente
    if (mandando) return
    setMandando(true)
    try {
    if (cart.length === 0) { toast.error('Agrega productos primero'); return }
    if (!ordenId) { toast.error('No hay orden activa'); return }

    // Calcular solo los items NUEVOS o con cantidad aumentada desde el último envío
    const itemsNuevos = cart
      .map(item => {
        const cantidadYaEnviada = snapshotCocina.get(item.menu_id) ?? 0
        const cantidadNueva = item.cantidad - cantidadYaEnviada
        return cantidadNueva > 0 ? { ...item, cantidad: cantidadNueva } : null
      })
      .filter(Boolean) as CartItem[]

    if (itemsNuevos.length === 0) {
      toast.error('No hay productos nuevos para mandar a cocina')
      return
    }

    const { error } = await supabase.from('ordenes').update({ estado: 'abierta' }).eq('id', ordenId)
    if (error) { toast.error('Error al mandar a cocina'); return }

    // Imprimir comanda solo con los items NUEVOS
    if (hayImpresora('cocina')) {
      const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      const html = buildComandaHTML({
        ordenStr: '',
        mesaNombre: currentMesaNombre,
        cajeroNombre: cajero.nombre,
        tipo: tipo === 'llevar' ? 'llevar' : 'comedor',
        hora,
        items: itemsNuevos.map(i => ({ emoji: i.emoji, nombre: i.nombre, cantidad: i.cantidad, notas: i.notas })),
        notaOrden: notaOrden || undefined,
        esConsumoEmpleado: tipo === 'empleado',
      })
      void imprimirPorTipo('cocina', html)
    }

    // Actualizar snapshot: ahora todo el carrito actual está en cocina
    setSnapshotCocina(new Map(cart.map(i => [i.menu_id, i.cantidad])))

    toast.success('🍳 ¡Orden mandada a cocina!')
    onVolver()
    } finally {
      // BUG 17 — liberar guard de doble envío
      setMandando(false)
    }
  }

  async function confirmarDelivery() {
    // BUG 18 — evitar doble envío concurrente
    if (enviandoDelivery) return
    if (!deliveryForm.nombre.trim()) { toast.error('Ingresa el nombre del cliente'); return }
    if (!deliveryForm.direccion.trim()) { toast.error('Ingresa la dirección de entrega'); return }
    if (!ordenId) { toast.error('Primero agrega productos a la orden'); return }
    setEnviandoDelivery(true)
    try {
      const { error } = await supabase.from('ordenes').update({
        canal: 'delivery',
        tipo_entrega: 'domicilio',
        cliente_nombre: deliveryForm.nombre.trim(),
        cliente_telefono: deliveryForm.telefono.trim() || null,
        direccion_entrega: deliveryForm.direccion.trim(),
        estado_entrega: 'listo',
      }).eq('id', ordenId)
      if (error) throw error
      toast.success('🛵 Pedido enviado al repartidor')
      setShowDeliveryModal(false)
      setDeliveryForm({ nombre: '', telefono: '', direccion: '' })
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar')
    } finally {
      setEnviandoDelivery(false)
    }
  }

  function onVentaCompletada() {
    setShowCheckout(false); setCart([]); setOrdenId(null)
    // A1 — limpiar localStorage al completar
    if (localStorageCartKey) { try { localStorage.removeItem(localStorageCartKey) } catch {} }
    broadcastRef.current?.postMessage({ type: 'idle' })
    toast.success('¡Venta registrada!'); onVolver()
  }

  const accentColor = tipo === 'llevar' ? 'var(--yellow)' : tipo === 'empleado' ? '#f97316' : '#22c55e'

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center gap-3" style={{ background: 'var(--black)' }}>
      <span className="text-4xl animate-gear inline-block">⚙️</span>
      <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Cargando menú...</p>
    </div>
  )

  if (error) return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 p-6" style={{ background: 'var(--black)' }}>
      <span className="text-4xl">⚠️</span>
      <p className="font-black text-sm uppercase tracking-wider text-center" style={{ color: '#ef4444' }}>{error}</p>
      <button onClick={() => { setError(null); setLoading(true); cargarDatos() }} className="btn-yellow text-xs px-6 py-2.5">Reintentar</button>
      <button onClick={handleVolver} className="btn-outline text-xs px-6 py-2.5">← Volver</button>
    </div>
  )

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: 'var(--black)' }}>
      <div className="hazard-stripe-sm h-1 shrink-0" />

      {/* ── Header ── */}
      <header className="flex items-center gap-2 px-3 py-2.5 shrink-0"
        style={{ background: 'var(--charcoal)', borderBottom: `2px solid ${accentColor}` }}>

        <button onClick={handleVolver}
          className="shrink-0 text-xs font-black uppercase tracking-wider px-2.5 py-2 transition-all"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--yellow)'; e.currentTarget.style.borderColor = 'var(--yellow)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
          ←
        </button>

        {/* Búsqueda (solo en vista menú) o nombre de mesa */}
        {vistaOrden === 'menu' ? (
          <div className="flex items-center flex-1 min-w-0 max-w-xs gap-1.5">
            <div className="flex items-center flex-1 min-w-0">
              <input
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar producto..."
                className="w-full px-3 py-1.5 text-xs font-bold"
                style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = accentColor)}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
              {busqueda && (
                <button onClick={() => setBusqueda('')} className="px-2 text-xs font-black"
                  style={{ color: 'var(--muted)', background: 'var(--dark)', border: '1px solid var(--border)', borderLeft: 'none' }}>✕</button>
              )}
            </div>
            {/* Mejora 5 — Toggle grid/lista */}
            <button
              onClick={() => {
                const next = vistaMenu === 'grid' ? 'lista' : 'grid'
                setVistaMenu(next)
                try { localStorage.setItem('pos_vista_menu', next) } catch {}
              }}
              className="shrink-0 px-2 py-1.5 text-sm font-black transition-all"
              style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--muted)' }}
              title={vistaMenu === 'grid' ? 'Vista lista' : 'Vista grid'}
            >
              {vistaMenu === 'grid' ? '☰' : '⊞'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs font-black px-2 py-1 shrink-0"
              style={{ background: `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}50` }}>
              {tipo === 'llevar' ? '🛍 Llevar' : tipo === 'empleado' ? '👷 Empleado' : '🪑 Mesa'}
            </span>
            <span className="font-black text-sm truncate" style={{ color: 'var(--text)' }}>{currentMesaNombre}</span>
            {tiempoOrden > 0 && (
              <span className="text-xs font-black shrink-0" style={{ color: '#f59e0b' }}>🕐 {tiempoOrden}m</span>
            )}
          </div>
        )}

        {/* Tabs Resumen / Agregar */}
        {/* B5 — Botón cambiar mesa (solo si hay ordenId) */}
        {ordenId && (
          <button
            onClick={async () => {
              const { data } = await supabase.from('mesas').select('id, numero, nombre').eq('estado', 'libre').order('numero')
              setMesasLibres((data ?? []).map((m: any) => ({ id: m.id, numero: m.numero, nombre: m.nombre ?? `Mesa ${m.numero}` })))
              setShowCambiarMesa(true)
            }}
            className="shrink-0 text-xs font-black px-2.5 py-2 transition-all"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = '#3b82f6' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            title="Cambiar de mesa"
          >
            ⇄ Mesa
          </button>
        )}

        {cart.length > 0 && (
          <div className="flex shrink-0" style={{ border: '1px solid var(--border)' }}>
            <button
              onClick={() => setVistaOrden('resumen')}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-all"
              style={{
                background: vistaOrden === 'resumen' ? accentColor : 'transparent',
                color: vistaOrden === 'resumen' ? '#000' : 'var(--muted)',
                borderRight: '1px solid var(--border)',
              }}>
              📋 Orden
            </button>
            <button
              onClick={() => setVistaOrden('menu')}
              className="px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-all"
              style={{
                background: vistaOrden === 'menu' ? accentColor : 'transparent',
                color: vistaOrden === 'menu' ? '#000' : 'var(--muted)',
              }}>
              ➕ Agregar
            </button>
          </div>
        )}

        {cart.length > 0 && (
          <button onClick={cancelarOrden} className="shrink-0 text-xs font-black px-2.5 py-2 transition-all"
            style={{ border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)', background: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(239,68,68,0.7)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)' }}>
            ✕
          </button>
        )}
      </header>

      {/* ── VISTA RESUMEN: cuenta completa a pantalla ── */}
      {vistaOrden === 'resumen' && (
        <ResumenOrden
          cart={cart}
          subtotal={subtotal}
          total={total}
          descuentoMonto={descuentoMonto}
          descuento={descuento}
          mesaNombre={mesaNombre}
          tipo={tipo}
          tiempoOrden={tiempoOrden}
          numPersonas={numPersonas}
          notaOrden={notaOrden}
          accentColor={accentColor}
          onCambiarCantidad={cambiarCantidad}
          onEliminar={eliminarItem}
          onCobrar={() => setShowCheckout(true)}
          onMandarCocina={mandarACocina}
          onCobrarSeleccion={(items) => { setCheckoutItems(items); setShowCheckout(true) }}
          onDescuento={setDescuento}
          onCancelar={cancelarOrden}
          onPrint={printTicket}
          onHistorial={mesaId ? cargarHistorial : undefined}
          onNumPersonas={setNumPersonas}
          onNotaOrden={setNotaOrden}
          onDelivery={tipo === 'llevar' ? () => setShowDeliveryModal(true) : undefined}
        />
      )}

      {/* ── VISTA MENÚ: selección de productos ── */}
      {vistaOrden === 'menu' && <>

      {/* ── Category pills (mobile/tablet) — 2 niveles ── */}
      <div className="md:hidden shrink-0" style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        {/* Nivel 1: Supergrupos */}
        <div className="flex gap-2 px-3 pt-2 pb-1 overflow-x-auto scrollbar-hide">
          <button onClick={() => { setSupergrupo(null); setCatActiva('todas') }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wide whitespace-nowrap shrink-0 transition-all"
            style={{
              background: supergrupo === null ? accentColor : 'var(--charcoal)',
              color: supergrupo === null ? '#000' : 'var(--muted)',
              border: `1px solid ${supergrupo === null ? accentColor : 'var(--border)'}`,
            }}>
            🍽️ Todo
          </button>
          {SUPERGRUPOS.filter(sg => sg.cats.some(c => categorias.some(cat => cat.id === c))).map(sg => (
            <button key={sg.id}
              onClick={() => { setSupergrupo(sg.id); setCatActiva('todas') }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wide whitespace-nowrap shrink-0 transition-all"
              style={{
                background: supergrupo === sg.id ? accentColor : 'var(--charcoal)',
                color: supergrupo === sg.id ? '#000' : 'var(--muted)',
                border: `1px solid ${supergrupo === sg.id ? accentColor : 'var(--border)'}`,
              }}>
              {sg.emoji} {sg.nombre}
            </button>
          ))}
        </div>
        {/* Nivel 2: Subcategorías del supergrupo activo */}
        {supergrupo && (
          <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-hide">
            {categoriasVisibles.filter(c => c.id !== 'todas').map(cat => {
              const active = catActiva === cat.id
              return (
                <button key={cat.id} onClick={() => setCatActiva(cat.id)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-black uppercase tracking-wide whitespace-nowrap shrink-0 transition-all"
                  style={{
                    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--muted)',
                    border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                    borderBottom: active ? `2px solid ${accentColor}` : '2px solid transparent',
                  }}>
                  <span>{cat.emoji}</span>
                  <span>{cat.nombre}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Acceso rápido: top 6 favoritos ── */}
      {favoritos.length >= 3 && (
        <div className="shrink-0" style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>
              // Acceso rápido
            </span>
          </div>
          <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-hide">
            {favoritos.map(producto => (
              <button
                key={producto.id}
                onClick={() => seleccionarProducto(producto)}
                className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 transition-all active:scale-95"
                style={{
                  background: 'var(--charcoal)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  borderRadius: 0,
                  minWidth: 0,
                  maxWidth: '140px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--yellow)'
                  e.currentTarget.style.background = 'rgba(255,200,0,0.08)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.background = 'var(--charcoal)'
                }}
              >
                <span className="text-base shrink-0 leading-none">{producto.emoji}</span>
                <span className="text-xs font-bold truncate" style={{ color: 'var(--text)', maxWidth: '72px' }}>
                  {producto.nombre}
                </span>
                <span className="text-xs font-black shrink-0" style={{ color: 'var(--yellow)' }}>
                  ${(producto.precio ?? 0).toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Category sidebar — tablet/desktop (md+) — 2 niveles */}
        <aside className="hidden md:flex flex-col w-24 lg:w-28 shrink-0 overflow-y-auto"
          style={{ background: 'var(--charcoal)', borderRight: '1px solid var(--border)' }}>

          {/* Supergrupos */}
          {SUPERGRUPOS.filter(sg => sg.cats.some(c => categorias.some(cat => cat.id === c))).map(sg => {
            const sgActive = supergrupo === sg.id
            const sgCount = menu.filter(p => sg.cats.includes(p.categoria)).length
            return (
              <div key={sg.id}>
                <button onClick={() => { setSupergrupo(sgActive ? null : sg.id); setCatActiva('todas') }}
                  className="w-full flex flex-col items-center gap-1 py-3 px-1 transition-all shrink-0"
                  style={{
                    background: sgActive ? `${accentColor}20` : 'transparent',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: `3px solid ${sgActive ? accentColor : 'transparent'}`,
                  }}>
                  <span className="text-xl leading-none">{sg.emoji}</span>
                  <span className="font-black uppercase text-center leading-tight"
                    style={{ color: sgActive ? accentColor : 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.05em' }}>
                    {sg.nombre}
                  </span>
                  <span style={{ color: 'var(--border)', fontSize: '0.6rem' }}>{sgCount}</span>
                </button>

                {/* Subcategorías del supergrupo expandido */}
                {sgActive && categoriasVisibles.filter(c => c.id !== 'todas').map(cat => {
                  const active = catActiva === cat.id
                  const count = menu.filter(p => p.categoria === cat.id).length
                  return (
                    <button key={cat.id} onClick={() => setCatActiva(cat.id)}
                      className="w-full flex flex-col items-center gap-1 py-2.5 px-1 transition-all shrink-0"
                      style={{
                        background: active ? accentColor : 'rgba(255,255,255,0.03)',
                        borderBottom: '1px solid rgba(58,58,58,0.5)',
                        borderLeft: `3px solid ${active ? 'rgba(0,0,0,0.3)' : accentColor + '40'}`,
                      }}>
                      <span className="text-base leading-none">{cat.emoji}</span>
                      <span className="font-black uppercase text-center leading-tight"
                        style={{ color: active ? '#000' : 'var(--muted)', fontSize: '0.55rem', letterSpacing: '0.04em' }}>
                        {cat.nombre}
                      </span>
                      <span style={{ color: active ? 'rgba(0,0,0,0.4)' : 'var(--border)', fontSize: '0.55rem' }}>{count}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Todo */}
          <button onClick={() => { setSupergrupo(null); setCatActiva('todas') }}
            className="flex flex-col items-center gap-1 py-3 px-1 transition-all shrink-0 mt-auto"
            style={{
              background: supergrupo === null ? accentColor : 'transparent',
              borderTop: '1px solid var(--border)',
              borderLeft: `3px solid ${supergrupo === null ? 'rgba(0,0,0,0.2)' : 'transparent'}`,
            }}>
            <span className="text-xl leading-none">🍽️</span>
            <span className="font-black uppercase text-center"
              style={{ color: supergrupo === null ? '#000' : 'var(--muted)', fontSize: '0.6rem' }}>
              Todo
            </span>
          </button>
        </aside>

        {/* Products area */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Category label — md+ only */}
          <div className="hidden md:flex items-center gap-2 px-3 py-2 shrink-0"
            style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
            {supergrupo && (
              <>
                <span className="text-xs font-black uppercase tracking-wider" style={{ color: accentColor }}>
                  {SUPERGRUPOS.find(sg => sg.id === supergrupo)?.emoji} {SUPERGRUPOS.find(sg => sg.id === supergrupo)?.nombre}
                </span>
                <span style={{ color: 'var(--border)' }}>›</span>
              </>
            )}
            <span className="text-sm">{categoriasVisibles.find(c => c.id === catActiva)?.emoji ?? '🍽️'}</span>
            <span className="font-black text-xs uppercase tracking-wider" style={{ color: 'var(--text)' }}>
              {categoriasVisibles.find(c => c.id === catActiva)?.nombre ?? 'Todo'}
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              · {menuFiltrado.length} productos
            </span>
          </div>

          {/* Product grid / list */}
          <div className="flex-1 overflow-y-auto p-2">
            {menuFiltrado.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
                <span className="text-4xl opacity-20">☕</span>
                <p className="font-black text-xs uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                  Sin productos
                </p>
              </div>
            ) : (() => {
              // Mejora 4 — Separar combos al inicio
              const combos = menuFiltrado.filter(p => p.es_combo)
              const normales = menuFiltrado.filter(p => !p.es_combo)
              const secciones: { label: string; items: MenuItem[] }[] = []
              if (combos.length > 0) secciones.push({ label: '🎁 Combos y Paquetes', items: combos })
              if (normales.length > 0) secciones.push({ label: '', items: normales })

              return (
                <div>
                  {secciones.map((sec, si) => (
                    <div key={si}>
                      {sec.label && (
                        <div className="px-1 py-1.5 mb-1 mt-1">
                          <span className="text-xs font-black uppercase tracking-wider px-2 py-0.5"
                            style={{ background: 'var(--yellow)', color: '#000' }}>
                            {sec.label}
                          </span>
                        </div>
                      )}
                      {/* Mejora 5 — Grid vs Lista */}
                      {vistaMenu === 'lista' ? (
                        <div className="flex flex-col gap-1">
                          {sec.items.map(producto => {
                            const enCart = cart.find(i => i.menu_id === producto.id)?.cantidad || 0
                            const precio = producto.precio ?? 0
                            const active = enCart > 0
                            const agotado = !producto.disponible
                            const fueraHorario = producto.disponible && !productoDisponibleAhora(producto)
                            const bloqueado = agotado || fueraHorario
                            const pulsing = addedItems.has(producto.id)
                            return (
                              <div key={producto.id} className="relative group">
                                <button
                                  onClick={e => {
                                    if (bloqueado) return
                                    flyEffect(producto.emoji, e.clientX, e.clientY)
                                    seleccionarProducto(producto)
                                  }}
                                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, producto }) }}
                                  onTouchStart={e => onLongPressStart(e, producto)}
                                  onTouchEnd={onLongPressEnd}
                                  onTouchMove={onLongPressEnd}
                                  className="w-full text-left transition-all active:scale-95 flex items-center gap-2"
                                  style={{
                                    background: bloqueado ? 'rgba(30,30,30,0.7)' : active ? `${accentColor}10` : 'var(--charcoal)',
                                    border: `1px solid ${pulsing ? '#22c55e' : active ? `${accentColor}60` : 'var(--border)'}`,
                                    borderLeft: `3px solid ${pulsing ? '#22c55e' : active ? accentColor : 'transparent'}`,
                                    padding: '0.5rem 0.625rem',
                                    borderRadius: 0,
                                    boxShadow: pulsing ? '0 0 0 2px #22c55e' : 'none',
                                    cursor: bloqueado ? 'not-allowed' : 'pointer',
                                    opacity: bloqueado ? 0.6 : 1,
                                    transition: 'all 0.15s',
                                  }}>
                                  <span className="text-base shrink-0">{producto.emoji}</span>
                                  <span className="font-bold text-xs flex-1 truncate" style={{ color: bloqueado ? 'var(--muted)' : 'var(--text)' }}>
                                    {producto.nombre}
                                    {producto.destaque && !bloqueado && <span style={{ color: 'var(--yellow)' }}> ★</span>}
                                    {producto.es_combo && (
                                      <span className="ml-1.5 text-xs font-black px-1 py-0.5" style={{ background: 'var(--yellow)', color: '#000' }}>COMBO</span>
                                    )}
                                  </span>
                                  {(producto.hora_inicio && producto.hora_fin) && (
                                    <span className="text-xs shrink-0" style={{ color: fueraHorario ? '#f59e0b' : 'var(--muted)' }}>
                                      ⏰ {formatHorario(producto)}
                                    </span>
                                  )}
                                  {agotado && (
                                    <span className="text-xs font-black px-1.5 py-0.5 shrink-0"
                                      style={{ background: '#ef4444', color: '#fff', borderRadius: 0 }}>
                                      AGOTADO
                                    </span>
                                  )}
                                  {fueraHorario && (
                                    <span className="text-xs font-black px-1.5 py-0.5 shrink-0"
                                      style={{ background: '#6b7280', color: '#fff', borderRadius: 0 }}>
                                      🕐 {formatHorario(producto)}
                                    </span>
                                  )}
                                  <span className="font-black text-sm shrink-0" style={{ color: bloqueado ? 'var(--muted)' : 'var(--yellow)' }}>
                                    ${precio.toFixed(2)}
                                  </span>
                                  {enCart > 0 && !bloqueado && (
                                    <span className="text-xs font-black w-5 h-5 flex items-center justify-center shrink-0"
                                      style={{ background: accentColor, color: '#000' }}>
                                      {enCart}
                                    </span>
                                  )}
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, producto }) }}
                                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 font-black"
                                  style={{ background: 'rgba(239,68,68,0.15)', color: 'rgba(239,68,68,0.7)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0 }}
                                  title={agotado ? 'Marcar disponible' : 'Marcar agotado'}
                                >⊘</button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
                          {sec.items.map(producto => {
                            const enCart = cart.find(i => i.menu_id === producto.id)?.cantidad || 0
                            const precio = producto.precio ?? 0
                            const active = enCart > 0
                            const agotado = !producto.disponible
                            const fueraHorario = producto.disponible && !productoDisponibleAhora(producto)
                            const bloqueado = agotado || fueraHorario
                            const pulsing = addedItems.has(producto.id)
                            const tieneImagen = !!producto.imagen_url
                            return (
                              <div key={producto.id} className="relative group">
                                <button
                                  onClick={e => {
                                    if (bloqueado) return
                                    flyEffect(producto.emoji, e.clientX, e.clientY)
                                    seleccionarProducto(producto)
                                  }}
                                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, producto }) }}
                                  onTouchStart={e => onLongPressStart(e, producto)}
                                  onTouchEnd={onLongPressEnd}
                                  onTouchMove={onLongPressEnd}
                                  className="w-full text-left transition-all active:scale-95 flex flex-col overflow-hidden"
                                  style={{
                                    background: bloqueado ? 'rgba(30,30,30,0.7)' : active ? `${accentColor}10` : 'var(--charcoal)',
                                    border: `1px solid ${pulsing ? '#22c55e' : active ? `${accentColor}60` : 'var(--border)'}`,
                                    borderLeft: `3px solid ${pulsing ? '#22c55e' : active ? accentColor : 'transparent'}`,
                                    minHeight: tieneImagen ? '110px' : '72px',
                                    borderRadius: 0,
                                    boxShadow: pulsing ? '0 0 0 2px #22c55e' : 'none',
                                    transform: pulsing ? 'scale(1.03)' : 'none',
                                    cursor: bloqueado ? 'not-allowed' : 'pointer',
                                    opacity: bloqueado ? 0.6 : 1,
                                    transition: 'all 0.15s',
                                    padding: 0,
                                  }}>

                                  {/* Mejora 1 — Imagen de fondo */}
                                  {tieneImagen && (
                                    <div className="relative w-full shrink-0" style={{ height: '62px', overflow: 'hidden' }}>
                                      <img
                                        src={producto.imagen_url}
                                        alt={producto.nombre}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                      />
                                      {/* Overlay oscuro */}
                                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.38)' }} />
                                      {/* Emoji encima */}
                                      <span style={{ position: 'absolute', bottom: 4, left: 6, fontSize: '1.3rem', lineHeight: 1 }}>
                                        {producto.emoji}
                                      </span>
                                      {/* Badge COMBO encima de imagen */}
                                      {producto.es_combo && (
                                        <span style={{ position: 'absolute', top: 4, left: 4, fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.05em', padding: '1px 5px', background: 'var(--yellow)', color: '#000' }}>
                                          COMBO
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Contenido inferior */}
                                  <div style={{ padding: '0.5rem 0.625rem 0.45rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    {/* Badge cantidad */}
                                    {enCart > 0 && !bloqueado && (
                                      <span className="absolute top-1.5 right-1.5 z-10 text-xs font-black w-5 h-5 flex items-center justify-center"
                                        style={{ background: accentColor, color: '#000' }}>
                                        {enCart}
                                      </span>
                                    )}

                                    {/* Badge AGOTADO */}
                                    {agotado && (
                                      <span className="absolute top-1.5 right-1.5 z-10 text-xs font-black px-1.5 py-0.5"
                                        style={{ background: '#ef4444', color: '#fff', borderRadius: 0, letterSpacing: '0.05em' }}>
                                        AGOTADO
                                      </span>
                                    )}

                                    {/* Badge fuera de horario */}
                                    {fueraHorario && (
                                      <span className="absolute top-1.5 right-1.5 z-10 font-black px-1 py-0.5 leading-tight text-center"
                                        style={{ background: '#6b7280', color: '#fff', borderRadius: 0, fontSize: '0.55rem', maxWidth: '72px' }}>
                                        🕐 {formatHorario(producto)}
                                      </span>
                                    )}

                                    {/* Nombre + emoji (sin imagen) */}
                                    {!tieneImagen && (
                                      <div className="flex items-start gap-1.5 mb-auto pr-6">
                                        <span className="text-base shrink-0 leading-none mt-0.5">{producto.emoji}</span>
                                        <span className="font-bold text-xs leading-snug" style={{ color: bloqueado ? 'var(--muted)' : 'var(--text)' }}>
                                          {producto.nombre}
                                          {producto.destaque && !bloqueado && <span style={{ color: 'var(--yellow)' }}> ★</span>}
                                        </span>
                                      </div>
                                    )}

                                    {/* Nombre (con imagen) */}
                                    {tieneImagen && (
                                      <span className="font-bold text-xs leading-snug pr-6 mb-auto" style={{ color: bloqueado ? 'var(--muted)' : 'var(--text)' }}>
                                        {producto.nombre}
                                        {producto.destaque && !bloqueado && <span style={{ color: 'var(--yellow)' }}> ★</span>}
                                      </span>
                                    )}

                                    {/* Badge COMBO sin imagen */}
                                    {producto.es_combo && !tieneImagen && (
                                      <span className="inline-block text-xs font-black px-1 py-0.5 mb-1 mt-0.5"
                                        style={{ background: 'var(--yellow)', color: '#000', letterSpacing: '0.05em', fontSize: '0.6rem' }}>
                                        COMBO
                                      </span>
                                    )}

                                    {/* Mejora 2 — Badge horario */}
                                    {(producto.hora_inicio && producto.hora_fin) && !fueraHorario && (
                                      <span className="text-xs font-black" style={{ color: 'var(--muted)', fontSize: '0.6rem' }}>
                                        ⏰ {formatHorario(producto)}
                                      </span>
                                    )}

                                    {/* Precio + Alérgenos */}
                                    <div className="flex items-center justify-between mt-1.5">
                                      <div className="flex items-center gap-1">
                                        <span className="font-black text-sm" style={{ color: bloqueado ? 'var(--muted)' : 'var(--yellow)' }}>
                                          ${precio.toFixed(2)}
                                        </span>
                                        {/* Mejora 3 — Alérgenos */}
                                        {producto.alergenos && producto.alergenos.length > 0 && (
                                          <span className="flex gap-0.5">
                                            {producto.alergenos.map((a, ai) => (
                                              <span key={ai} title={a} style={{ fontSize: '0.75rem', lineHeight: 1 }}>
                                                {getAlergenoEmoji(a)}
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </div>
                                      {!bloqueado && (
                                        <span className="text-xs font-black" style={{ color: active ? accentColor : 'var(--border)' }}>
                                          {active ? '+1' : '+'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>

                                {/* Botón "Marcar agotado/disponible" — hover desktop */}
                                <button
                                  onClick={e => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, producto }) }}
                                  className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 font-black"
                                  style={{ background: 'rgba(239,68,68,0.15)', color: 'rgba(239,68,68,0.7)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0 }}
                                  title={agotado ? 'Marcar disponible' : 'Marcar agotado'}
                                >
                                  ⊘
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>

        {/* Cart panel — desktop lg+ */}
        <div className="hidden lg:flex w-64 xl:w-72 flex-col shrink-0"
          style={{ background: 'var(--charcoal)', borderLeft: '1px solid var(--border)' }}>
          <CartPanel cart={cart} subtotal={subtotal} total={total} descuentoMonto={descuentoMonto}
            descuento={descuento} mesaNombre={mesaNombre} tipo={tipo}
            onCambiarCantidad={cambiarCantidad} onEliminar={eliminarItem}
            onCobrar={() => setShowCheckout(true)} onMandarCocina={mandarACocina}
            onDescuento={setDescuento} onCancelar={cancelarOrden}
            onCobrarSeleccion={(items) => { setCheckoutItems(items); setShowCheckout(true) }}
            numPersonas={numPersonas}
            onNumPersonas={setNumPersonas}
            notaOrden={notaOrden}
            onNotaOrden={setNotaOrden}
            onHistorial={cargarHistorial}
            onPrint={printTicket}
            hasMesa={!!mesaId} />
        </div>
      </div>

      {/* ── Bottom cart bar — mobile/tablet ── */}
      <div className="lg:hidden shrink-0">
        {cart.length > 0 && !showCart && (
          <button onClick={() => setShowCart(true)}
            className="w-full flex items-center justify-between px-4 py-3.5 font-black transition-all"
            style={{ background: accentColor, color: '#000' }}>
            <span className="text-xs font-black w-6 h-6 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.25)' }}>
              {totalItems}
            </span>
            <span className="uppercase tracking-wider text-sm">
              {tipo === 'comedor' ? 'Ver orden' : 'Ver orden'}
            </span>
            <span className="font-black">${total.toFixed(2)}</span>
          </button>
        )}
      </div>

      {/* ← cierre del bloque vistaOrden === 'menu' */}
      </>}

      {/* ── Cart sheet (mobile/tablet) ── */}
      {showCart && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setShowCart(false)}>
          <div className="flex flex-col animate-slide-up"
            style={{
              background: 'var(--charcoal)',
              borderTop: `3px solid ${accentColor}`,
              maxHeight: '80dvh',
            }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="font-black text-sm uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                {mesaNombre}
              </span>
              <button onClick={() => setShowCart(false)}
                className="w-8 h-8 flex items-center justify-center text-lg"
                style={{ color: 'var(--muted)' }}>✕</button>
            </div>
            <CartPanel cart={cart} subtotal={subtotal} total={total} descuentoMonto={descuentoMonto}
              descuento={descuento} mesaNombre={mesaNombre} tipo={tipo}
              onCambiarCantidad={cambiarCantidad} onEliminar={eliminarItem}
              onCobrar={() => { setShowCart(false); setShowCheckout(true) }}
              onMandarCocina={() => { setShowCart(false); mandarACocina() }}
              onDescuento={setDescuento} onCancelar={() => { setShowCart(false); cancelarOrden() }}
              onCobrarSeleccion={(items) => { setShowCart(false); setCheckoutItems(items); setShowCheckout(true) }}
              numPersonas={numPersonas}
              onNumPersonas={setNumPersonas}
              notaOrden={notaOrden}
              onNotaOrden={setNotaOrden}
              onHistorial={cargarHistorial}
              onPrint={printTicket}
              hasMesa={!!mesaId} />
          </div>
        </div>
      )}

      {showCheckout && (
        <CheckoutModal
          cart={checkoutItems ?? cart}
          total={checkoutItems
            ? checkoutItems.reduce((s, i) => s + (i.precio ?? 0) * i.cantidad, 0)
            : total}
          descuentoMonto={checkoutItems ? 0 : descuentoMonto}
          mesaId={currentMesaId ?? ''} mesaNombre={currentMesaNombre}
          ordenId={ordenId} cajero={cajero}
          onClose={() => { setShowCheckout(false); setCheckoutItems(null) }}
          onCompletado={() => {
            if (checkoutItems) {
              const paidKeys = new Set(checkoutItems.map(i => i.menu_id))
              setCart(prev => prev.filter(i => !paidKeys.has(i.menu_id)))
              setCheckoutItems(null)
              setShowCheckout(false)
              toast.success('Cuenta parcial cobrada')
            } else {
              onVentaCompletada()
            }
          }}
          // C4 — split: cobrar subset de ítems
          onCobrarParcial={(items) => {
            setCheckoutItems(items)
            // El modal se cierra, se abre de nuevo con esos ítems
          }}
        />
      )}

      {/* ── Modal: Enviar a Repartidor ──────────────────────────────────── */}
      {showDeliveryModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 950,
          background: 'rgba(0,0,0,0.92)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--charcoal)', border: '1px solid var(--border)',
            borderTop: '4px solid #ef4444', width: '100%', maxWidth: 420,
          }}>
            <div style={{ padding: '14px 18px', background: 'var(--dark)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ color: '#ef4444', fontWeight: 900, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                🛵 Datos de entrega
              </p>
              <button onClick={() => setShowDeliveryModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Nombre del cliente *', key: 'nombre', placeholder: 'Ej: Juan García', type: 'text' },
                { label: 'Teléfono', key: 'telefono', placeholder: '961 123 4567', type: 'tel' },
                { label: 'Dirección de entrega *', key: 'direccion', placeholder: 'Calle, número, colonia...', type: 'text' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>{f.label}</label>
                  <input
                    type={f.type}
                    value={(deliveryForm as any)[f.key]}
                    onChange={e => setDeliveryForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{ width: '100%', background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 12px', fontSize: 14, fontFamily: "'Courier New', monospace", outline: 'none', boxSizing: 'border-box' }}
                    onFocus={e => (e.target.style.borderColor = '#ef4444')}
                    onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                  />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                <button onClick={() => setShowDeliveryModal(false)}
                  style={{ padding: '13px', background: 'none', color: 'var(--muted)', border: '1px solid var(--border)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', cursor: 'pointer', letterSpacing: 1, fontFamily: 'monospace' }}>
                  Cancelar
                </button>
                <button
                  onClick={confirmarDelivery}
                  disabled={enviandoDelivery}
                  style={{ padding: '13px', background: enviandoDelivery ? '#555' : '#ef4444', color: '#fff', border: 'none', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', cursor: enviandoDelivery ? 'not-allowed' : 'pointer', letterSpacing: 1, fontFamily: 'monospace' }}>
                  {enviandoDelivery ? '...' : '🛵 Enviar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {productoSeleccionado && (
        <ModificadoresModal
          producto={productoSeleccionado}
          accentColor={accentColor}
          onCerrar={() => setProductoSeleccionado(null)}
          onConfirmar={(precio, notas, _sel) => {
            agregarProducto(productoSeleccionado, precio, notas || null, 1)
            setProductoSeleccionado(null)
          }}
        />
      )}

      {showCancelOrdenConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowCancelOrdenConfirm(false)}>
          <div className="w-full max-w-xs p-6 flex flex-col gap-5 animate-slide-up"
            style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #ef4444' }}
            onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <p className="text-2xl mb-2">🗑️</p>
              <p className="font-black text-base uppercase tracking-wide" style={{ color: 'var(--text)' }}>
                ¿Cancelar la orden?
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Se eliminarán todos los productos de {mesaNombre}.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelOrdenConfirm(false)}
                className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
                style={{ background: 'var(--dark)', color: 'var(--muted)', border: '2px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>
                Volver
              </button>
              <button onClick={confirmarCancelOrden}
                className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
                style={{ background: '#ef4444', color: '#fff', border: '2px solid #ef4444', borderRadius: 0, cursor: 'pointer' }}>
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Menú contextual: marcar agotado ── */}
      {ctxMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)}>
          <div
            className="absolute animate-slide-up"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 220),
              top: Math.min(ctxMenu.y, window.innerHeight - 120),
              background: 'var(--charcoal)',
              border: '1px solid var(--border)',
              borderTop: '2px solid #ef4444',
              minWidth: 200,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                {ctxMenu.producto.emoji} {ctxMenu.producto.nombre}
              </p>
            </div>
            <div className="p-1.5 space-y-0.5">
              <button
                onClick={() => toggleDisponible(ctxMenu.producto)}
                className="w-full text-left px-3 py-2.5 text-xs font-black uppercase tracking-wider transition-all"
                style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                ⊘ Marcar como agotado
              </button>
              <button
                onClick={() => setCtxMenu(null)}
                className="w-full text-left px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all"
                style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* B5 — Modal cambiar de mesa */}
      {showCambiarMesa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowCambiarMesa(false)}>
          <div className="w-full max-w-xs animate-slide-up"
            style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid #3b82f6', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="font-black text-sm uppercase tracking-wider" style={{ color: '#3b82f6' }}>⇄ Cambiar mesa</p>
              <button onClick={() => setShowCambiarMesa(false)} style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {mesasLibres.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>No hay mesas libres</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {mesasLibres.map(m => (
                    <button
                      key={m.id}
                      onClick={async () => {
                        if (!ordenId) return
                        const mesaAnteriorId = currentMesaId
                        const mesaAnteriorNombre = currentMesaNombre
                        try {
                          // 1. Actualizar orden con nueva mesa
                          await supabase.from('ordenes').update({ mesa_id: m.id, mesa_nombre: m.nombre }).eq('id', ordenId)
                          // 2. Liberar mesa anterior
                          if (mesaAnteriorId) {
                            await supabase.from('mesas').update({ estado: 'libre', orden_id: null }).eq('id', mesaAnteriorId)
                          }
                          // 3. Ocupar nueva mesa
                          await supabase.from('mesas').update({ estado: 'ocupada', orden_id: ordenId }).eq('id', m.id)
                          // 4. Actualizar estado local
                          setCurrentMesaId(m.id)
                          setCurrentMesaNombre(m.nombre)
                          setShowCambiarMesa(false)
                          toast.success(`Mesa cambiada a ${m.nombre}`)
                          // D3 — Audit log
                          registrarAccion(
                            'cambio_mesa',
                            { de: mesaAnteriorNombre, a: m.nombre },
                            cajero.nombre,
                          )
                        } catch {
                          toast.error('Error al cambiar mesa')
                        }
                      }}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <span className="font-black text-2xl" style={{ color: '#3b82f6' }}>{m.numero}</span>
                      <span className="font-bold text-sm">{m.nombre}</span>
                      <span className="ml-auto text-xs font-black uppercase" style={{ color: '#22c55e' }}>● Libre</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showHistorial && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setShowHistorial(false)}>
          <div className="w-full max-w-sm animate-slide-up"
            style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="font-black text-sm uppercase tracking-wider" style={{ color: 'var(--yellow)' }}>📋 Historial — {mesaNombre}</p>
              <button onClick={() => setShowHistorial(false)} style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            {historialOrdenes.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Sin historial para esta mesa</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {historialOrdenes.map(o => (
                  <div key={o.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black uppercase tracking-wider"
                        style={{ color: o.estado === 'pagada' ? '#22c55e' : o.estado === 'cancelada' ? '#ef4444' : 'var(--muted)' }}>
                        {o.estado === 'pagada' ? '✓ Pagada' : o.estado === 'cancelada' ? '✕ Cancelada' : o.estado}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {new Date(o.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {o.orden_items.map((item, idx) => (
                        <p key={idx} className="text-xs" style={{ color: 'var(--text)' }}>
                          {item.cantidad}× {item.nombre}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Vista resumen de cuenta ── */
function ResumenOrden({
  cart, subtotal, total, descuentoMonto, descuento, mesaNombre, tipo, tiempoOrden,
  numPersonas, notaOrden, accentColor,
  onCambiarCantidad, onEliminar, onCobrar, onMandarCocina, onCobrarSeleccion,
  onDescuento, onCancelar, onPrint, onHistorial, onNumPersonas, onNotaOrden, onDelivery,
}: {
  cart: CartItem[]
  subtotal: number
  total: number
  descuentoMonto: number
  descuento: { tipo: 'porcentaje' | 'fijo'; valor: number } | null
  mesaNombre: string
  tipo: 'llevar' | 'comedor' | 'empleado'
  tiempoOrden: number
  numPersonas: number
  notaOrden: string
  accentColor: string
  onCambiarCantidad: (id: string, delta: number) => void
  onEliminar: (id: string) => void
  onCobrar: () => void
  onMandarCocina: () => void
  onCobrarSeleccion: (items: CartItem[]) => void
  onDescuento: (d: { tipo: 'porcentaje' | 'fijo'; valor: number } | null) => void
  onCancelar: () => void
  onPrint: () => void
  onHistorial?: () => void
  onNumPersonas: (n: number) => void
  onNotaOrden: (s: string) => void
  onDelivery?: () => void
}) {
  const totalItems = cart.reduce((s, i) => s + i.cantidad, 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-screen-enter">

      {/* Resumen header */}
      <div className="px-4 py-3 shrink-0 flex items-center justify-between"
        style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs font-black uppercase tracking-widest" style={{ color: accentColor }}>
            // Cuenta activa
          </p>
          <p className="text-sm font-black" style={{ color: 'var(--text)' }}>
            {totalItems} producto{totalItems !== 1 ? 's' : ''}
            {tiempoOrden > 0 && <span style={{ color: '#f59e0b' }}> · 🕐 {tiempoOrden}m</span>}
            {tipo === 'comedor' && numPersonas > 1 && <span style={{ color: 'var(--muted)' }}> · 👥 {numPersonas} personas</span>}
          </p>
        </div>
        <span className="font-black text-2xl" style={{ color: accentColor }}>${total.toFixed(2)}</span>
      </div>

      {/* Lista de items — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {cart.map(item => (
          <div key={item.menu_id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: '1px solid rgba(58,58,58,0.4)' }}>
            <span className="text-xl shrink-0">{item.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{item.nombre}</p>
              {item.notas && (
                <p className="text-xs italic" style={{ color: 'var(--yellow)' }}>⚠ {item.notas}</p>
              )}
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                ${item.precio.toFixed(2)} c/u · ~{getPrepTime(item.nombre, item.emoji)} min
              </p>
            </div>
            {/* Cantidad +/- */}
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => onCambiarCantidad(item.menu_id, -1)}
                className="w-7 h-7 flex items-center justify-center text-base font-black"
                style={{ background: 'var(--dark)', color: 'var(--text)', border: '1px solid var(--border)' }}>−</button>
              <span className="w-6 text-center text-sm font-black" style={{ color: accentColor }}>{item.cantidad}</span>
              <button onClick={() => onCambiarCantidad(item.menu_id, 1)}
                className="w-7 h-7 flex items-center justify-center text-base font-black"
                style={{ background: 'var(--dark)', color: 'var(--text)', border: '1px solid var(--border)' }}>+</button>
            </div>
            <span className="font-black text-sm shrink-0 w-14 text-right" style={{ color: accentColor }}>
              ${(item.precio * item.cantidad).toFixed(2)}
            </span>
            <button onClick={() => onEliminar(item.menu_id)}
              className="shrink-0 text-base transition-colors"
              style={{ color: 'rgba(239,68,68,0.35)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.35)')}>✕</button>
          </div>
        ))}

        {/* Nota general */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            inputMode="text"
            enterKeyHint="done"
            value={notaOrden}
            onChange={e => onNotaOrden(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="Nota general de la orden..."
            className="w-full text-xs font-bold px-3 py-2"
            style={{ background: 'var(--dark)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
            onFocus={e => (e.target.style.borderColor = accentColor)}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
        </div>
      </div>

      {/* Totales y acciones — fijos abajo */}
      <div className="shrink-0" style={{ borderTop: '2px solid var(--border)', background: 'var(--charcoal)' }}>

        {/* Descuento activo */}
        {descuento && descuentoMonto > 0 && (
          <div className="flex items-center justify-between px-4 py-2"
            style={{ background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.15)' }}>
            <span className="text-xs font-black" style={{ color: '#22c55e' }}>
              Descuento {descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `$${descuento.valor}`}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-black text-sm" style={{ color: '#22c55e' }}>-${descuentoMonto.toFixed(2)}</span>
              <button onClick={() => onDescuento(null)}
                className="text-xs font-black px-2 py-0.5"
                style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', background: 'none', cursor: 'pointer' }}>
                Quitar
              </button>
            </div>
          </div>
        )}

        {/* Subtotal / Total */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          {descuentoMonto > 0 && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Subtotal ${subtotal.toFixed(2)}</span>
          )}
          <span className="text-xs font-black uppercase tracking-widest ml-auto mr-3" style={{ color: 'var(--muted)' }}>TOTAL</span>
          <span className="font-black text-2xl" style={{ color: accentColor }}>${total.toFixed(2)}</span>
        </div>

        {/* Botones principales */}
        <div className="px-4 py-3 grid grid-cols-2 gap-2">
          {tipo === 'comedor' && (
            <button onClick={onMandarCocina}
              className="col-span-2 py-4 font-black text-base uppercase tracking-widest transition-all active:scale-95"
              style={{ background: '#22c55e', color: '#000', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#16a34a')}
              onMouseLeave={e => (e.currentTarget.style.background = '#22c55e')}>
              🍽️ Mandar a cocina
            </button>
          )}
          {onDelivery && (
            <button onClick={onDelivery}
              className="col-span-2 py-3 font-black text-sm uppercase tracking-widest transition-all"
              style={{ background: 'none', color: '#ef4444', border: '2px solid #ef4444', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
              🛵 Enviar a Repartidor
            </button>
          )}
          <button onClick={onCobrar}
            className="col-span-2 py-4 font-black text-base uppercase tracking-widest transition-all active:scale-95"
            style={{ background: accentColor, color: '#000', border: 'none', cursor: 'pointer' }}>
            💰 Cobrar ${total.toFixed(2)}
          </button>
          <button onClick={onPrint}
            className="py-3 font-black text-sm uppercase tracking-wider transition-all"
            style={{ background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
            🖨 Pre-ticket
          </button>
          {onHistorial && (
            <button onClick={onHistorial}
              className="py-3 font-black text-sm uppercase tracking-wider transition-all"
              style={{ background: 'var(--dark)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
              📋 Historial
            </button>
          )}
          <button onClick={onCancelar}
            className={`${onHistorial ? 'col-span-2' : ''} py-3 font-black text-sm uppercase tracking-wider transition-all`}
            style={{ background: 'transparent', color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(239,68,68,0.6)'; e.currentTarget.style.background = 'transparent' }}>
            🗑 Cancelar orden
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Estimated prep time per item ── */
function getPrepTime(nombre: string, emoji: string): number {
  const n = nombre.toLowerCase()
  if (emoji === '🧇' || n.includes('waffle')) return 8
  if (emoji === '🥞' || n.includes('crepa')) return 7
  if (n.includes('sandwich') || emoji === '🥪') return 5
  if (emoji === '☕' || emoji === '🧋' || n.includes('frappe') || n.includes('café')) return 5
  if (n.includes('baguette') || emoji === '🥖') return 3
  if (n.includes('croissant') || emoji === '🥐') return 2
  return 3
}

/* ── Cart Panel ── */
type CartMode = 'normal' | 'descuento' | 'separar'

function CartPanel({
  cart, subtotal, total, descuentoMonto, descuento, mesaNombre, tipo,
  onCambiarCantidad, onEliminar, onCobrar, onMandarCocina,
  onDescuento, onCancelar, onCobrarSeleccion,
  numPersonas, onNumPersonas, notaOrden, onNotaOrden, onHistorial, onPrint, hasMesa,
}: {
  cart: CartItem[]
  subtotal: number
  total: number
  descuentoMonto: number
  descuento: { tipo: 'porcentaje' | 'fijo'; valor: number } | null
  mesaNombre: string
  tipo: 'llevar' | 'comedor' | 'empleado'
  onCambiarCantidad: (id: string, delta: number) => void
  onEliminar: (id: string) => void
  onCobrar: () => void
  onMandarCocina: () => void
  onDescuento: (d: { tipo: 'porcentaje' | 'fijo'; valor: number } | null) => void
  onCancelar: () => void
  onCobrarSeleccion: (items: CartItem[]) => void
  numPersonas: number
  onNumPersonas: (n: number) => void
  notaOrden: string
  onNotaOrden: (s: string) => void
  onHistorial: () => void
  onPrint: () => void
  hasMesa: boolean
}) {
  const accentColor = tipo === 'llevar' ? 'var(--yellow)' : tipo === 'empleado' ? '#f97316' : '#22c55e'
  const [mode, setMode] = useState<CartMode>('normal')
  const [descTipo, setDescTipo] = useState<'porcentaje' | 'fijo'>('porcentaje')
  const [descValor, setDescValor] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  function toggleSeleccion(menuId: string) {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(menuId)) next.delete(menuId); else next.add(menuId)
      return next
    })
  }

  function aplicarDescuento() {
    const val = parseFloat(descValor)
    if (!val || val <= 0) return
    if (descTipo === 'porcentaje' && val > 100) return
    onDescuento({ tipo: descTipo, valor: val })
    setMode('normal')
  }

  function quitarDescuento() {
    onDescuento(null)
    setDescValor('')
    setMode('normal')
  }

  const itemsSeleccionados = cart.filter(i => seleccion.has(i.menu_id))
  const totalSeleccion = itemsSeleccionados.reduce((s, i) => s + (i.precio ?? 0) * i.cantidad, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-3 py-2.5 shrink-0" style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: accentColor }}>
          // {mesaNombre}
        </p>
        {cart.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {cart.reduce((s, i) => s + i.cantidad, 0)} producto{cart.reduce((s, i) => s + i.cantidad, 0) !== 1 ? 's' : ''}
            {descuento && <span style={{ color: '#22c55e' }}> · descuento activo</span>}
          </p>
        )}
      </div>

      {/* Empty state */}
      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-2">
          <div className="text-3xl opacity-20">🛒</div>
          <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Sin productos</p>
        </div>
      ) : (
        <>
          {/* Items list */}
          <div className="flex-1 overflow-y-auto">
            {cart.map(item => {
              const isSelected = seleccion.has(item.menu_id)
              return (
                <div
                  key={item.menu_id}
                  className="flex items-center gap-2 px-3 py-2.5 transition-all"
                  style={{
                    borderBottom: '1px solid rgba(58,58,58,0.4)',
                    background: mode === 'separar' && isSelected ? `${accentColor}12` : 'transparent',
                    cursor: mode === 'separar' ? 'pointer' : 'default',
                  }}
                  onClick={mode === 'separar' ? () => toggleSeleccion(item.menu_id) : undefined}
                >
                  {/* Checkbox para separar */}
                  {mode === 'separar' && (
                    <div
                      className="w-4 h-4 shrink-0 flex items-center justify-center border transition-all"
                      style={{
                        borderColor: isSelected ? accentColor : 'var(--border)',
                        background: isSelected ? accentColor : 'transparent',
                      }}
                    >
                      {isSelected && <span className="text-xs font-black" style={{ color: '#000', fontSize: '0.55rem' }}>✓</span>}
                    </div>
                  )}

                  <span className="text-base shrink-0">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>{item.nombre}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      ${(item.precio ?? 0).toFixed(2)} c/u
                      <span className="ml-1.5" style={{ color: 'var(--muted)', opacity: 0.7 }}>
                        · ~{getPrepTime(item.nombre, item.emoji)}m
                      </span>
                    </p>
                  </div>

                  {mode !== 'separar' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onCambiarCantidad(item.menu_id, -1)}
                        className="w-6 h-6 flex items-center justify-center text-sm font-black"
                        style={{ background: 'var(--dark)', color: 'var(--text)', border: '1px solid var(--border)' }}>−</button>
                      <span className="w-5 text-center text-xs font-black" style={{ color: accentColor }}>{item.cantidad}</span>
                      <button onClick={() => onCambiarCantidad(item.menu_id, 1)}
                        className="w-6 h-6 flex items-center justify-center text-sm font-black"
                        style={{ background: 'var(--dark)', color: 'var(--text)', border: '1px solid var(--border)' }}>+</button>
                    </div>
                  )}

                  <span className="text-xs font-black shrink-0 w-12 text-right" style={{ color: isSelected ? accentColor : accentColor }}>
                    ${((item.precio ?? 0) * item.cantidad).toFixed(2)}
                  </span>

                  {mode !== 'separar' && (
                    <button onClick={() => onEliminar(item.menu_id)}
                      className="shrink-0 text-xs transition-colors ml-1"
                      style={{ color: 'rgba(239,68,68,0.3)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.3)')}>✕</button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Action toolbar: Descuento | Separar | Cancelar */}
          <div className="flex shrink-0" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
            {[
              { id: 'descuento', icon: '💸', label: 'Descuento' },
              { id: 'separar',   icon: '✂️', label: 'Separar' },
            ].map(btn => (
              <button
                key={btn.id}
                onClick={() => {
                  if (mode === btn.id) { setMode('normal'); setSeleccion(new Set()) }
                  else { setMode(btn.id as CartMode); setSeleccion(new Set()) }
                }}
                className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-black uppercase tracking-wide transition-all"
                style={{
                  background: mode === btn.id ? `${accentColor}15` : 'var(--dark)',
                  color: mode === btn.id ? accentColor : 'var(--muted)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: '0.9rem' }}>{btn.icon}</span>
                <span style={{ fontSize: '0.6rem' }}>{btn.label}</span>
              </button>
            ))}
            <button
              onClick={onCancelar}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-black uppercase tracking-wide transition-all"
              style={{ background: 'var(--dark)', color: 'rgba(239,68,68,0.5)' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.05)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(239,68,68,0.5)'; e.currentTarget.style.background = 'var(--dark)' }}
            >
              <span style={{ fontSize: '0.9rem' }}>🗑️</span>
              <span style={{ fontSize: '0.6rem' }}>Cancelar</span>
            </button>
          </div>

          {/* Nota general de la orden */}
          <div className="px-3 py-2 shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--dark)' }}>
            <input
              type="text"
              inputMode="text"
              enterKeyHint="done"
              value={notaOrden}
              onChange={e => onNotaOrden(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="Nota general de la orden..."
              className="w-full text-xs font-bold px-2 py-1.5"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', borderRadius: 0 }}
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>

          {/* Num personas (solo comedor) */}
          {tipo === 'comedor' && (
            <div className="px-3 py-2 flex items-center justify-between shrink-0"
              style={{ borderTop: '1px solid var(--border)', background: 'var(--dark)' }}>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Personas</span>
              <div className="flex items-center gap-2">
                <button onClick={() => onNumPersonas(Math.max(1, numPersonas - 1))}
                  className="w-6 h-6 flex items-center justify-center font-black text-sm"
                  style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer' }}>−</button>
                <span className="font-black text-sm w-5 text-center" style={{ color: accentColor }}>{numPersonas}</span>
                <button onClick={() => onNumPersonas(numPersonas + 1)}
                  className="w-6 h-6 flex items-center justify-center font-black text-sm"
                  style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}

          {/* Discount panel */}
          {mode === 'descuento' && (
            <div className="px-3 py-3 shrink-0 space-y-2.5" style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
              {descuento ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black" style={{ color: '#22c55e' }}>
                    ✓ -{descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `$${descuento.valor}`} aplicado
                  </span>
                  <button onClick={quitarDescuento}
                    className="text-xs font-black px-2 py-1 transition-colors"
                    style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-1">
                    {(['porcentaje', 'fijo'] as const).map(t => (
                      <button key={t} onClick={() => setDescTipo(t)}
                        className="flex-1 py-1.5 text-xs font-black uppercase tracking-wide transition-all"
                        style={{
                          background: descTipo === t ? accentColor : 'var(--charcoal)',
                          color: descTipo === t ? '#000' : 'var(--muted)',
                          border: `1px solid ${descTipo === t ? accentColor : 'var(--border)'}`,
                        }}>
                        {t === 'porcentaje' ? '% Porcentaje' : '$ Monto fijo'}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={descValor}
                      onChange={e => setDescValor(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { aplicarDescuento(); (e.target as HTMLInputElement).blur() } }}
                      placeholder={descTipo === 'porcentaje' ? 'Ej: 10' : 'Ej: 50'}
                      className="flex-1 py-1.5 text-sm font-black pos-input"
                      style={{ color: accentColor }}
                      min={0} max={descTipo === 'porcentaje' ? 100 : undefined}
                      autoFocus
                    />
                    <button onClick={aplicarDescuento}
                      className="px-3 font-black text-sm transition-all"
                      style={{ background: accentColor, color: '#000', border: 'none', cursor: 'pointer' }}>
                      ✓
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-3 pt-3 pb-3 shrink-0 space-y-2" style={{ borderTop: mode !== 'descuento' ? '2px solid var(--border)' : 'none', background: 'var(--dark)' }}>

            {mode === 'separar' ? (
              /* Split bill footer */
              seleccion.size > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {itemsSeleccionados.length} ítem{itemsSeleccionados.length !== 1 ? 's' : ''} seleccionado{itemsSeleccionados.length !== 1 ? 's' : ''}
                    </span>
                    <span className="font-black text-base" style={{ color: 'var(--yellow)' }}>${totalSeleccion.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => { onCobrarSeleccion(itemsSeleccionados); setMode('normal'); setSeleccion(new Set()) }}
                    className="w-full font-black text-sm uppercase tracking-wider py-3 transition-all active:scale-95"
                    style={{ background: 'var(--yellow)', color: '#000', border: 'none', cursor: 'pointer' }}>
                    💰 Cobrar selección ${totalSeleccion.toFixed(2)}
                  </button>
                  <button
                    onClick={() => { setMode('normal'); setSeleccion(new Set()) }}
                    className="w-full text-xs font-black uppercase tracking-wider py-2 transition-all"
                    style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    Cancelar selección
                  </button>
                </div>
              ) : (
                <div className="text-center py-2">
                  <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    Selecciona los productos a cobrar por separado
                  </p>
                  <button onClick={() => { setMode('normal'); setSeleccion(new Set()) }}
                    className="mt-2 text-xs font-black uppercase tracking-wider transition-colors"
                    style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                    ← Cancelar
                  </button>
                </div>
              )
            ) : (
              /* Normal footer */
              <>
                {descuento && descuentoMonto > 0 ? (
                  <div className="space-y-1 mb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>Subtotal</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black" style={{ color: '#22c55e' }}>
                        Descuento {descuento.tipo === 'porcentaje' ? `(${descuento.valor}%)` : ''}
                      </span>
                      <span className="text-sm font-black" style={{ color: '#22c55e' }}>-${descuentoMonto.toFixed(2)}</span>
                    </div>
                    <div className="h-px" style={{ background: 'var(--border)' }} />
                  </div>
                ) : null}

                {/* Tiempo estimado de preparación */}
                {cart.length > 0 && (() => {
                  const maxPrep = Math.max(...cart.map(i => getPrepTime(i.nombre, i.emoji)))
                  return (
                    <div className="flex items-center justify-between py-1.5 px-2 mb-0.5"
                      style={{ background: 'rgba(240,168,0,0.06)', border: '1px solid rgba(240,168,0,0.2)' }}>
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--muted)' }}>⏱ Tiempo est.</span>
                      <span className="text-xs font-black" style={{ color: 'var(--yellow)' }}>~{maxPrep} min</span>
                    </div>
                  )
                })()}

                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Total</span>
                  <span className="font-black text-xl" style={{ color: 'var(--yellow)' }}>${total.toFixed(2)}</span>
                </div>

                {tipo === 'comedor' ? (
                  <>
                    <button onClick={onMandarCocina}
                      className="w-full font-black text-sm uppercase tracking-widest py-3.5 transition-all active:scale-95"
                      style={{ background: '#22c55e', color: '#000', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#16a34a')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#22c55e')}>
                      🍽️ Mandar a Cocina
                    </button>
                    <button onClick={onCobrar}
                      className="w-full font-black text-xs uppercase tracking-widest py-2.5 transition-all active:scale-95"
                      style={{ background: 'transparent', color: 'var(--yellow)', border: '1px solid rgba(240,168,0,0.35)', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,168,0,0.07)'; e.currentTarget.style.borderColor = 'var(--yellow)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(240,168,0,0.35)' }}>
                      💰 Cobrar cuenta
                    </button>
                  </>
                ) : (
                  <button onClick={onCobrar}
                    className="w-full font-black text-sm uppercase tracking-widest py-3.5 transition-all active:scale-95"
                    style={{ background: 'var(--yellow)', color: '#000', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#d4940a')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--yellow)')}>
                    💰 Cobrar ${total.toFixed(2)}
                  </button>
                )}

                {/* Print + Historial */}
                <div className="flex gap-2">
                  <button onClick={onPrint}
                    className="flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all"
                    style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                    🖨 Ticket
                  </button>
                  {hasMesa && (
                    <button onClick={onHistorial}
                      className="flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all"
                      style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                      📋 Historial
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
