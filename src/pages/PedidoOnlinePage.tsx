import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import toast, { Toaster } from 'react-hot-toast'

interface MenuItem {
  id: string
  nombre: string
  emoji: string
  categoria: string
  precio: number
  descripcion?: string
}

interface CartItem {
  menuId: string
  nombre: string
  emoji: string
  precio: number
  cantidad: number
  notas: string
}

type TipoEntrega = 'domicilio' | 'recoger'

const CAT_ICONS: Record<string, string> = {
  cafe_caliente: '☕', cafe_frio: '🧊', frappe: '🥤', bebida_fria: '🧃',
  sin_cafe: '🍵', croissant: '🥐', baguette: '🥖', sandwich: '🥪',
  waffle: '🧇', crepa: '🫓', pan_dulce: '🍞', alimento: '🍽️',
}

export default function PedidoOnlinePage() {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [catActiva, setCatActiva] = useState('Todos')
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [ordenConfirmada, setOrdenConfirmada] = useState<string | null>(null)
  const [form, setForm] = useState({
    nombre: '', telefono: '', direccion: '',
    tipo_entrega: 'domicilio' as TipoEntrega, notas: '',
  })

  useEffect(() => { cargarMenu() }, [])

  async function cargarMenu() {
    const { data } = await supabase
      .from('menu')
      .select('id, nombre, emoji, categoria, precio, descripcion')
      .eq('disponible', true)
      .order('categoria').order('nombre')
    if (data) {
      setMenu(data)
      const cats = Array.from(new Set(data.map((i: MenuItem) => i.categoria)))
      setCategorias(cats)
    }
    setLoading(false)
  }

  const menuFiltrado = catActiva === 'Todos' ? menu : menu.filter(i => i.categoria === catActiva)
  const totalItems = cart.reduce((s, i) => s + i.cantidad, 0)
  const totalPrecio = cart.reduce((s, i) => s + i.precio * i.cantidad, 0)

  function agregarItem(item: MenuItem) {
    setCart(prev => {
      const ex = prev.find(c => c.menuId === item.id)
      if (ex) return prev.map(c => c.menuId === item.id ? { ...c, cantidad: c.cantidad + 1 } : c)
      return [...prev, { menuId: item.id, nombre: item.nombre, emoji: item.emoji, precio: item.precio, cantidad: 1, notas: '' }]
    })
    toast.success(`${item.emoji} agregado`, { duration: 1200 })
  }

  function quitarItem(menuId: string) {
    setCart(prev => {
      const ex = prev.find(c => c.menuId === menuId)
      if (!ex) return prev
      if (ex.cantidad === 1) return prev.filter(c => c.menuId !== menuId)
      return prev.map(c => c.menuId === menuId ? { ...c, cantidad: c.cantidad - 1 } : c)
    })
  }

  function qty(menuId: string) { return cart.find(c => c.menuId === menuId)?.cantidad ?? 0 }

  async function enviarPedido() {
    if (!form.nombre.trim()) { toast.error('Ingresa tu nombre'); return }
    if (!form.telefono.trim()) { toast.error('Ingresa tu teléfono'); return }
    if (form.tipo_entrega === 'domicilio' && !form.direccion.trim()) {
      toast.error('Ingresa tu dirección de entrega'); return
    }
    if (cart.length === 0) { toast.error('Tu carrito está vacío'); return }

    setEnviando(true)
    try {
      const items = cart.map(c => ({
        menu_id: c.menuId,
        nombre: c.nombre,
        emoji: c.emoji,
        precio: c.precio,
        cantidad: c.cantidad,
        notas: c.notas || '',
      }))

      const { data, error } = await supabase.rpc('crear_pedido_delivery', {
        p_cliente_nombre: form.nombre.trim(),
        p_cliente_telefono: form.telefono.trim(),
        p_direccion_entrega: form.direccion.trim() || null,
        p_tipo_entrega: form.tipo_entrega,
        p_notas: form.notas.trim() || null,
        p_items: items,
      })

      if (error) throw new Error(error.message)

      const id = (data as any)?.id ?? ''
      setOrdenConfirmada(id.slice(0, 6).toUpperCase())
      setCart([])
      setShowCart(false)
      setShowForm(false)
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar el pedido. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  // ─── Pantalla de confirmación ─────────────────────────────────────
  if (ordenConfirmada) {
    return (
      <div style={s.confirmWrapper}>
        <Toaster />
        <div style={s.confirmBox}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <p style={s.confirmTitle}>¡Pedido enviado!</p>
          <p style={s.confirmRef}>Referencia: <strong style={{ color: '#f0a800' }}>{ordenConfirmada}</strong></p>
          <p style={s.confirmSub}>
            Recibirás confirmación al teléfono <strong>{form.telefono}</strong> en breve.
          </p>
          <button
            onClick={() => {
              setOrdenConfirmada(null)
              setForm({ nombre: '', telefono: '', direccion: '', tipo_entrega: 'domicilio', notas: '' })
            }}
            style={s.confirmBtn}>
            Hacer otro pedido
          </button>
        </div>
      </div>
    )
  }

  // ─── Página principal ─────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', fontFamily: "'Courier New', monospace" }}>
      <Toaster position="top-center" />

      {/* Header */}
      <header style={s.header}>
        <div>
          <p style={s.headerTitle}>⚙️ El Café del Constructor</p>
          <p style={s.headerSub}>Pedido en línea · Tuxtla Gutiérrez</p>
        </div>
        {totalItems > 0 && (
          <button onClick={() => setShowCart(true)} style={s.cartBtn}>
            🛒 {totalItems} · ${totalPrecio.toFixed(2)}
          </button>
        )}
      </header>

      {/* Categorías */}
      <div style={s.catBar}>
        <button onClick={() => setCatActiva('Todos')}
          style={{ ...s.catBtn, ...(catActiva === 'Todos' ? s.catBtnActive : {}) }}>
          🍽️ Todos
        </button>
        {categorias.map(cat => (
          <button key={cat} onClick={() => setCatActiva(cat)}
            style={{ ...s.catBtn, ...(catActiva === cat ? s.catBtnActive : {}) }}>
            {CAT_ICONS[cat] || '•'} {cat.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Menú */}
      <div style={{ padding: '16px', maxWidth: 960, margin: '0 auto', paddingBottom: 100 }}>
        {loading ? (
          <p style={{ color: '#666', textAlign: 'center', padding: 48 }}>Cargando menú...</p>
        ) : menuFiltrado.length === 0 ? (
          <p style={{ color: '#666', textAlign: 'center', padding: 48 }}>Sin productos disponibles</p>
        ) : (
          <div style={s.menuGrid}>
            {menuFiltrado.map(item => {
              const q = qty(item.id)
              return (
                <div key={item.id} style={s.menuCard}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 32 }}>{item.emoji}</span>
                    <p style={s.itemNombre}>{item.nombre}</p>
                    {item.descripcion && <p style={s.itemDesc}>{item.descripcion}</p>}
                    <p style={s.itemPrecio}>${item.precio.toFixed(2)}</p>
                  </div>
                  {q === 0 ? (
                    <button onClick={() => agregarItem(item)} style={s.addBtn}>+ Agregar</button>
                  ) : (
                    <div style={s.qtyRow}>
                      <button onClick={() => quitarItem(item.id)} style={s.qtyBtn}>−</button>
                      <span style={s.qtyNum}>{q}</span>
                      <button onClick={() => agregarItem(item)} style={{ ...s.qtyBtn, background: '#f0a800', color: '#000' }}>+</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Botón flotante del carrito */}
      {totalItems > 0 && !showCart && (
        <div style={s.floatingCartWrapper}>
          <button onClick={() => setShowCart(true)} style={s.floatingCartBtn}>
            🛒 Ver pedido ({totalItems} items) · ${totalPrecio.toFixed(2)}
          </button>
        </div>
      )}

      {/* ─── Drawer del carrito ─────────────────────────────────── */}
      {showCart && (
        <div style={s.overlay}>
          <div style={{ flex: 1 }} onClick={() => setShowCart(false)} />
          <div style={s.drawer}>
            <div style={s.drawerHeader}>
              <p style={s.drawerTitle}>🛒 Tu pedido</p>
              <button onClick={() => setShowCart(false)} style={s.closeBtn}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cart.map(item => (
                <div key={item.menuId} style={s.cartItem}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#eee', fontWeight: 900, fontSize: 13 }}>
                      {item.emoji} {item.nombre}
                    </span>
                    <span style={{ color: '#f0a800', fontWeight: 900 }}>
                      ${(item.precio * item.cantidad).toFixed(2)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <button onClick={() => quitarItem(item.menuId)} style={s.qtyBtnSm}>−</button>
                    <span style={{ color: '#fff', minWidth: 20, textAlign: 'center', fontWeight: 900 }}>{item.cantidad}</span>
                    <button onClick={() => agregarItem({ id: item.menuId, nombre: item.nombre, emoji: item.emoji, precio: item.precio, categoria: '', descripcion: '' })} style={{ ...s.qtyBtnSm, background: '#f0a800', color: '#000' }}>+</button>
                    <input
                      value={item.notas}
                      onChange={e => setCart(prev => prev.map(c => c.menuId === item.menuId ? { ...c, notas: e.target.value } : c))}
                      placeholder="Nota especial..."
                      style={s.notasInput}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={s.drawerFooter}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ color: '#aaa', fontWeight: 900 }}>Total</span>
                <span style={{ color: '#f0a800', fontWeight: 900, fontSize: 22 }}>${totalPrecio.toFixed(2)}</span>
              </div>
              <button onClick={() => { setShowCart(false); setShowForm(true) }} style={s.continueBtn}>
                Continuar →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal de checkout ───────────────────────────────────── */}
      {showForm && (
        <div style={s.modalOverlay}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <p style={s.modalTitle}>📋 Datos del pedido</p>
              <button onClick={() => setShowForm(false)} style={s.closeBtn}>✕</button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 60px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Tipo entrega */}
              <div>
                <label style={s.fieldLabel}>Tipo de entrega</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {(['domicilio', 'recoger'] as TipoEntrega[]).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, tipo_entrega: t }))}
                      style={{ ...s.tipoBtn, ...(form.tipo_entrega === t ? s.tipoBtnActive : {}) }}>
                      {t === 'domicilio' ? '🛵 A domicilio' : '🏪 Recoger aquí'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Campos */}
              {[
                { label: 'Tu nombre *', key: 'nombre', placeholder: 'Ej: Juan García', type: 'text' },
                { label: 'Teléfono *', key: 'telefono', placeholder: '961 123 4567', type: 'tel' },
                ...(form.tipo_entrega === 'domicilio'
                  ? [{ label: 'Dirección de entrega *', key: 'direccion', placeholder: 'Calle, número, colonia...', type: 'text' }]
                  : []),
                { label: 'Notas del pedido', key: 'notas', placeholder: 'Sin azúcar, extra crema...', type: 'text' },
              ].map(field => (
                <div key={field.key}>
                  <label style={s.fieldLabel}>{field.label}</label>
                  <input
                    type={field.type}
                    value={(form as any)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    style={s.textInput}
                  />
                </div>
              ))}

              {/* Resumen */}
              <div style={{ background: '#111', border: '1px solid #2a2a2a', padding: 14 }}>
                <p style={{ ...s.fieldLabel, marginBottom: 8 }}>Resumen del pedido</p>
                {cart.map(item => (
                  <div key={item.menuId} style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc', fontSize: 12, marginBottom: 4 }}>
                    <span>{item.emoji} {item.nombre} ×{item.cantidad}</span>
                    <span>${(item.precio * item.cantidad).toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f0a800', fontWeight: 900, fontSize: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid #2a2a2a' }}>
                  <span>Total</span>
                  <span>${totalPrecio.toFixed(2)}</span>
                </div>
              </div>

              <button onClick={enviarPedido} disabled={enviando} style={{ ...s.continueBtn, opacity: enviando ? 0.6 : 1, cursor: enviando ? 'not-allowed' : 'pointer' }}>
                {enviando ? 'Enviando pedido...' : '📲 Confirmar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  header: { background: '#111', borderBottom: '1px solid #222', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20 },
  headerTitle: { color: '#f0a800', fontWeight: 900, fontSize: 17, textTransform: 'uppercase', letterSpacing: 2, margin: 0 },
  headerSub: { color: '#555', fontSize: 11, margin: 0, marginTop: 2 },
  catBar: { background: '#111', borderBottom: '1px solid #1e1e1e', padding: '10px 16px', display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' },
  catBtn: { padding: '6px 14px', border: '1px solid #2a2a2a', background: 'none', color: '#666', fontWeight: 900, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'Courier New', monospace" },
  catBtnActive: { borderColor: '#f0a800', background: 'rgba(240,168,0,0.08)', color: '#f0a800' },
  menuGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 },
  menuCard: { background: '#1a1a1a', border: '1px solid #252525', padding: 16 },
  itemNombre: { color: '#eee', fontWeight: 900, fontSize: 14, margin: '6px 0 2px' },
  itemDesc: { color: '#666', fontSize: 11, margin: 0, marginBottom: 4 },
  itemPrecio: { color: '#f0a800', fontWeight: 900, fontSize: 18, margin: '6px 0 0' },
  addBtn: { width: '100%', padding: '9px', background: '#f0a800', color: '#000', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', border: 'none', cursor: 'pointer', letterSpacing: 1, fontFamily: "'Courier New', monospace" },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyBtn: { flex: 1, padding: '8px', background: '#2a2a2a', color: '#eee', fontWeight: 900, fontSize: 20, border: 'none', cursor: 'pointer' },
  qtyNum: { color: '#f0a800', fontWeight: 900, fontSize: 20, minWidth: 28, textAlign: 'center' },
  qtyBtnSm: { padding: '4px 12px', background: '#2a2a2a', color: '#eee', fontWeight: 900, fontSize: 16, border: 'none', cursor: 'pointer' },
  floatingCartWrapper: { position: 'fixed', bottom: 20, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 50, padding: '0 20px' },
  floatingCartBtn: { background: '#f0a800', color: '#000', fontWeight: 900, fontSize: 14, border: 'none', padding: '14px 32px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1, boxShadow: '0 4px 24px rgba(240,168,0,0.45)', fontFamily: "'Courier New', monospace" },
  cartBtn: { background: '#f0a800', color: '#000', fontWeight: 900, border: 'none', padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontFamily: "'Courier New', monospace" },
  overlay: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', background: 'rgba(0,0,0,0.65)' },
  drawer: { width: 380, maxWidth: '93vw', background: '#111', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #2a2a2a', height: '100vh' },
  drawerHeader: { padding: '16px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d' },
  drawerTitle: { color: '#f0a800', fontWeight: 900, fontSize: 16, textTransform: 'uppercase', margin: 0 },
  drawerFooter: { padding: '16px 20px', borderTop: '1px solid #1e1e1e', background: '#0d0d0d' },
  cartItem: { background: '#1a1a1a', border: '1px solid #252525', padding: 12 },
  notasInput: { flex: 1, background: '#222', border: '1px solid #333', color: '#ccc', padding: '4px 8px', fontSize: 11, fontFamily: "'Courier New', monospace", outline: 'none' },
  continueBtn: { width: '100%', padding: '14px', background: '#f0a800', color: '#000', fontWeight: 900, fontSize: 14, textTransform: 'uppercase', letterSpacing: 2, border: 'none', cursor: 'pointer', fontFamily: "'Courier New', monospace" },
  closeBtn: { background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer', padding: 4 },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: '#111', border: '1px solid #2a2a2a', borderTop: '3px solid #f0a800', width: '100%', maxWidth: 460, maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  modalHeader: { padding: '16px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d' },
  modalTitle: { color: '#f0a800', fontWeight: 900, fontSize: 16, textTransform: 'uppercase', margin: 0 },
  fieldLabel: { color: '#666', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 },
  textInput: { width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#eee', padding: '10px 12px', fontSize: 14, fontFamily: "'Courier New', monospace", outline: 'none', boxSizing: 'border-box' },
  tipoBtn: { padding: '11px', border: '2px solid #2a2a2a', background: 'none', color: '#666', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', cursor: 'pointer', fontFamily: "'Courier New', monospace" },
  tipoBtnActive: { borderColor: '#f0a800', background: 'rgba(240,168,0,0.08)', color: '#f0a800' },
  confirmWrapper: { minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { textAlign: 'center', maxWidth: 420 },
  confirmTitle: { color: '#f0a800', fontWeight: 900, fontSize: 26, textTransform: 'uppercase', letterSpacing: 2, margin: '8px 0' },
  confirmRef: { color: '#aaa', fontSize: 16, margin: '8px 0' },
  confirmSub: { color: '#666', fontSize: 13, marginTop: 8 },
  confirmBtn: { marginTop: 28, padding: '13px 36px', background: '#f0a800', color: '#000', fontWeight: 900, fontFamily: "'Courier New', monospace", fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, border: 'none', cursor: 'pointer' },
}
