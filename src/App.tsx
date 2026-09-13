import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import CanjeQRModal from './components/CanjeQRModal'
import PinLoginPage from './pages/PinLoginPage'
import MesasPage from './pages/MesasPage'
import OrdenPage from './pages/OrdenPage'
import KitchenPage from './pages/KitchenPage'
import ReportesPage from './pages/ReportesPage'
import CorteCajaPage from './pages/CorteCajaPage'
import HistorialPage from './pages/HistorialPage'
import InventarioPage from './pages/InventarioPage'
import ReservacionesPage from './pages/ReservacionesPage'
import TurnosPage from './pages/TurnosPage'
import ConfiguracionPage from './pages/ConfiguracionPage'
import AnalisisPage from './pages/AnalisisPage'
import GastosPage from './pages/GastosPage'
import AdelantosPage from './pages/AdelantosPage'
import PedidoOnlinePage from './pages/PedidoOnlinePage'
import DeliveryAlerts from './components/DeliveryAlerts'
import CuponesPage from './pages/CuponesPage'
import HappyHoursPage from './pages/HappyHoursPage'
import MenuEditorPage from './pages/MenuEditorPage'
import DashboardPage from './pages/DashboardPage'
import RecetasPage from './pages/RecetasPage'
import OrdenesCompraPage from './pages/OrdenesCompraPage'
import ModificadoresAdminPage from './pages/ModificadoresAdminPage'
import AperturaCajaPage from './pages/AperturaCajaPage'
import FiadosPage from './pages/FiadosPage'
import toast from 'react-hot-toast'
import { registrarAccion } from './services/auditLog'
import { crearTicket, imprimirPorTipo, hayImpresora, listarImpresoras, getSlot, setSlot } from './services/printer'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { syncOfflineQueue, getPendingCount, clearSynced } from './services/offlineQueue'

export interface CajeroActivo {
  id: string
  nombre: string
  last_name: string
  correo?: string
  rol: string
  es_admin: boolean
  es_cajero: boolean
  turno: 'mañana' | 'tarde'
}

type Screen = 'tipo' | 'apertura_caja' | 'mesas' | 'orden' | 'cocina' | 'reportes' | 'corte' | 'historial' | 'inventario' | 'reservaciones' | 'turnos' | 'configuracion' | 'analisis' | 'gastos' | 'adelantos' | 'cupones' | 'happyhours' | 'menueditor' | 'dashboard' | 'recetas' | 'ordenes_compra' | 'modificadores_admin' | 'fiados'
export type TipoOrden = 'llevar' | 'comedor' | 'empleado'

const INACTIVIDAD_SEGUNDOS = 300 // 5 minutos
const ADVERTENCIA_SEGUNDOS = 60  // mostrar aviso 1 min antes

export default function App() {
  const [loading, setLoading] = useState(true)
  const [sesionActiva, setSesionActiva] = useState(false)
  const [activeCajero, setActiveCajero] = useState<CajeroActivo | null>(null)
  const [screen, setScreen] = useState<Screen>('tipo')
  const [mesaId, setMesaId] = useState<string | null>(null)
  const [mesaNombre, setMesaNombre] = useState<string>('')
  const [tipoOrden, setTipoOrden] = useState<TipoOrden>('comedor')
  const [secondsLeft, setSecondsLeft] = useState(INACTIVIDAD_SEGUNDOS)
  const [showInactividadWarning, setShowInactividadWarning] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showCanjeModal, setShowCanjeModal] = useState(false)
  const [showSalirModal, setShowSalirModal] = useState(false)
  const [turnoStats, setTurnoStats] = useState<{ total: number; ventas: number } | null>(null)
  const [showModalEmpleado, setShowModalEmpleado] = useState(false)
  const [listaPersonal, setListaPersonal] = useState<{ id: string; nombre: string; apellido: string; rol: string }[]>([])
  const [connected, setConnected] = useState(true)
  const [pendingOffline, setPendingOffline] = useState(0)
  const inactividadRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const online = useOnlineStatus()

  // Realtime connection monitor
  useEffect(() => {
    const ch = supabase.channel('conn-check').subscribe(status => {
      setConnected(status === 'SUBSCRIBED')
    })
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Sincronizar ventas offline cuando vuelve la conexión
  useEffect(() => {
    setPendingOffline(getPendingCount())
    if (!online) return
    const pending = getPendingCount()
    if (pending === 0) return
    syncOfflineQueue().then(synced => {
      if (synced > 0) {
        clearSynced()
        setPendingOffline(0)
        toast.success(`✅ ${synced} venta${synced > 1 ? 's' : ''} sincronizada${synced > 1 ? 's' : ''} con éxito`)
      }
    })
  }, [online])

  // Realtime + polling: actualizar cajero activo si cambia su rol en la BD
  useEffect(() => {
    if (!activeCajero) return

    function aplicarCambio(updated: { rol?: string; nombre?: string; apellido?: string; activo?: boolean }) {
      if (updated.activo === false) {
        toast.error('Tu cuenta fue desactivada. Sesión cerrada.')
        setActiveCajero(null)
        setScreen('tipo')
        return
      }
      const ROL_CON_ACCESO = ['admin', 'gerente', 'cajero', 'mesero', 'barista']
      if (updated.rol && !ROL_CON_ACCESO.includes(updated.rol)) {
        toast.error(`Rol "${updated.rol}" no tiene acceso al POS. Sesión cerrada.`)
        setActiveCajero(null)
        setScreen('tipo')
        return
      }
      setActiveCajero(prev => {
        if (!prev) return null
        const nuevoRol = updated.rol ?? prev.rol
        if (prev.rol === nuevoRol && prev.nombre === (updated.nombre ?? prev.nombre)) return prev
        return {
          ...prev,
          rol: nuevoRol,
          nombre: updated.nombre ?? prev.nombre,
          last_name: updated.apellido ?? prev.last_name,
          es_admin:  ['admin', 'gerente'].includes(nuevoRol),
          es_cajero: ROL_CON_ACCESO.includes(nuevoRol),
        }
      })
    }

    // Realtime (requiere que personal esté en supabase_realtime publication)
    const ch = supabase
      .channel(`personal-cajero-${activeCajero.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'personal',
        filter: `id=eq.${activeCajero.id}`,
      }, (payload) => {
        aplicarCambio(payload.new as { rol?: string; nombre?: string; apellido?: string; activo?: boolean })
      })
      .subscribe()

    // Polling cada 15s como respaldo (por si personal no está en realtime publication)
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('personal')
        .select('rol, nombre, apellido, activo')
        .eq('id', activeCajero.id)
        .maybeSingle()
      if (data) aplicarCambio(data)
    }, 15000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
    }
  }, [activeCajero?.id])

  // ─── Bloqueo por inactividad ──────────────────────────────────────
  const bloquear = useCallback(() => {
    setActiveCajero(null)
    setScreen('tipo')
    setMesaId(null)
    setMesaNombre('')
    setShowInactividadWarning(false)
    if (inactividadRef.current) clearTimeout(inactividadRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    toast('Sesión cerrada por inactividad', { icon: '🔒' })
  }, [])

  const resetInactividad = useCallback(() => {
    setShowInactividadWarning(false)
    setSecondsLeft(INACTIVIDAD_SEGUNDOS)
    if (inactividadRef.current) clearTimeout(inactividadRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    if (!activeCajero) return

    // Advertencia a 1 min del timeout
    const warningTimeout = setTimeout(() => {
      setShowInactividadWarning(true)
      let s = ADVERTENCIA_SEGUNDOS
      setSecondsLeft(s)
      countdownRef.current = setInterval(() => {
        s -= 1
        setSecondsLeft(s)
        if (s <= 0) {
          clearInterval(countdownRef.current!)
          bloquear()
        }
      }, 1000)
    }, (INACTIVIDAD_SEGUNDOS - ADVERTENCIA_SEGUNDOS) * 1000)

    inactividadRef.current = warningTimeout
  }, [activeCajero, bloquear])

  useEffect(() => {
    const eventos = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    eventos.forEach(ev => window.addEventListener(ev, resetInactividad, { passive: true }))
    resetInactividad()
    return () => {
      eventos.forEach(ev => window.removeEventListener(ev, resetInactividad))
      if (inactividadRef.current) clearTimeout(inactividadRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [resetInactividad])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Guard de seguridad para pantallas de admin — ejecutado en useEffect para
  // no llamar toast/setScreen durante el render (viola reglas de React)
  const ADMIN_SCREENS = ['reportes', 'turnos', 'configuracion', 'analisis', 'cupones', 'happyhours', 'menueditor', 'dashboard', 'recetas', 'modificadores_admin']
  useEffect(() => {
    if (ADMIN_SCREENS.includes(screen) && !activeCajero?.es_admin) {
      toast.error('Acceso denegado')
      volverATipo()
    }
  }, [screen, activeCajero]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auth ────────────────────────────────────────────────────────
  // El POS firma automáticamente con la cuenta de servicio del terminal.
  // Esto establece una sesión "authenticated" para que las políticas RLS
  // de Supabase permitan el acceso a las tablas del negocio.
  // La seguridad operativa está en el PIN de cada cajero.
  useEffect(() => {
    async function iniciarSesionPOS() {
      try {
        // Recuperar sesión existente (si el app se suspendió)
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          setSesionActiva(true)
          setLoading(false)
          return
        }
        // Iniciar sesión con cuenta de servicio del terminal POS
        const posEmail    = import.meta.env.VITE_POS_EMAIL    as string | undefined
        const posPassword = import.meta.env.VITE_POS_PASSWORD as string | undefined
        if (posEmail && posPassword) {
          const { error } = await supabase.auth.signInWithPassword({
            email: posEmail,
            password: posPassword,
          })
          if (error) {
            console.error('[POS] Error al iniciar sesión de servicio:', error.message)
            toast.error('Error de conexión con el servidor — verifica credenciales POS')
          }
        } else {
          console.warn('[POS] VITE_POS_EMAIL / VITE_POS_PASSWORD no configurados — algunas funciones pueden fallar')
        }
      } catch (err) {
        console.error('[POS] Error inesperado en auth:', err)
      } finally {
        setSesionActiva(true)
        setLoading(false)
      }
    }
    iniciarSesionPOS()
  }, [])

  async function handleLogin(loginResult: { id: string; nombre: string; last_name: string; rol: string; turno: 'mañana' | 'tarde' }) {
    const ROL_ADMIN  = ['admin', 'gerente']
    const ROL_CAJERO = ['admin', 'gerente', 'cajero', 'mesero', 'barista']
    const cajero: CajeroActivo = {
      ...loginResult,
      es_admin:  ROL_ADMIN.includes(loginResult.rol),
      es_cajero: ROL_CAJERO.includes(loginResult.rol),
    }
    if (!cajero.es_cajero) {
      toast.error(`Rol "${loginResult.rol}" no tiene acceso al POS`)
      return
    }

    setActiveCajero(cajero)
    toast.success(`Bienvenido, ${cajero.nombre}`)

    // Auto-detectar impresora si no hay ninguna configurada
    if (!hayImpresora('caja')) {
      listarImpresoras().then(lista => {
        const epson = lista.find(p =>
          p.toLowerCase().includes('tm-t') ||
          p.toLowerCase().includes('receipt') ||
          p.toLowerCase().includes('epson')
        )
        if (epson && !getSlot(1).nombre && !getSlot(1).ip) {
          setSlot(1, { tipo: 'caja', modo: 'cable', nombre: epson, ip: '' })
          toast.success(`Impresora detectada: ${epson}`, { duration: 3000 })
        }
      }).catch(() => {})
    }

    // Verificar si ya hay UNA CAJA ABIERTA HOY (de cualquier cajero)
    // Si alguien ya abrió caja, los demás cajeros no necesitan volver a abrirla
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const { data: cajaAbierta, error: errCaja } = await supabase
      .from('cortes_caja')
      .select('id')
      .eq('estado', 'abierto')
      .gte('apertura_at', hoy.toISOString())
      .limit(1)
      .maybeSingle()

    if (cajaAbierta) {
      // Cachear el ID del corte activo para modo offline
      try { localStorage.setItem('pos_corte_activo_id', cajaAbierta.id) } catch {}
      setScreen('tipo')
    } else if (errCaja || !navigator.onLine) {
      // Sin internet — usar caché para saber si la caja ya fue abierta
      const cachedCorteId = localStorage.getItem('pos_corte_activo_id')
      if (cachedCorteId) {
        setScreen('tipo')
      } else {
        setScreen('apertura_caja')
      }
    } else {
      // Online y sin caja abierta — limpiar caché
      try { localStorage.removeItem('pos_corte_activo_id') } catch {}
      setScreen('apertura_caja')
    }
    // D3 — Audit log: login exitoso
    registrarAccion('login', { cajero: cajero.nombre }, cajero.nombre)
    // Recordatorios de reservación próxima hora
    void (async () => {
      try {
        const hoy = new Date().toISOString().slice(0, 10)
        const ahora = new Date()
        const en60 = new Date(ahora.getTime() + 60 * 60 * 1000)
        const horaMin = ahora.toTimeString().slice(0, 5)
        const horaMax = en60.toTimeString().slice(0, 5)
        const { data: proximas } = await supabase
          .from('reservaciones')
          .select('cliente_nombre, hora, personas, mesa_nombre, telefono')
          .eq('fecha', hoy)
          .eq('estado', 'confirmada')
          .gte('hora', horaMin)
          .lte('hora', horaMax)
        if (proximas && proximas.length > 0) {
          proximas.forEach((r: any) => {
            const msg = `⏰ Reservación próxima: ${r.cliente_nombre} · ${r.personas} personas · ${r.hora}${r.mesa_nombre ? ` · ${r.mesa_nombre}` : ''}`
            toast(msg, { duration: 8000, icon: '📅' })
          })
        }
      } catch {}
    })()
  }

  function elegirLlevar() { setTipoOrden('llevar'); setMesaId(null); setMesaNombre('Para Llevar'); setScreen('orden') }
  function elegirComedor() { setTipoOrden('comedor'); setScreen('mesas') }
  async function elegirEmpleado() {
    // Cargar lista de personal activo y mostrar modal de selección
    const { data } = await supabase
      .from('personal')
      .select('id, nombre, apellido, rol')
      .eq('activo', true)
      .order('nombre')
    setListaPersonal((data as any[]) ?? [])
    setShowModalEmpleado(true)
  }
  function confirmarEmpleado(nombre: string, apellido: string) {
    setTipoOrden('empleado')
    setMesaId(null)
    setMesaNombre(`Empleado: ${nombre} ${apellido}`.trim())
    setShowModalEmpleado(false)
    setScreen('orden')
  }
  function abrirMesa(id: string, nombre: string) { setMesaId(id); setMesaNombre(nombre); setScreen('orden') }
  function volverATipo() { setScreen('tipo'); setMesaId(null); setMesaNombre('') }
  function volverAMesas() { setScreen('mesas'); setMesaId(null); setMesaNombre('') }
  async function solicitarCambiarCajero() {
    if (!activeCajero) return
    // Cargar stats del turno de hoy para mostrar en el modal
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const { data } = await supabase.from('ventas')
      .select('total')
      .gte('created_at', hoy.toISOString())
      .eq('estado', 'completada')
      .eq('cajero_nombre', `${activeCajero.nombre} ${activeCajero.last_name}`)
    const stats = { ventas: data?.length ?? 0, total: (data ?? []).reduce((s: number, v: any) => s + Number(v.total), 0) }
    setTurnoStats(stats)
    setShowLogoutConfirm(true)
  }
  function cambiarCajero() { setActiveCajero(null); setScreen('tipo'); setMesaId(null); setMesaNombre(''); setShowLogoutConfirm(false) }
  function irACocina() { setScreen('cocina') }
  function irAReportes() {
    // A2 — solo admin
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden ver reportes'); return }
    setScreen('reportes')
  }
  function irACorte() { setScreen('corte') }
  function cerrarSesionCompleta() {
    setActiveCajero(null)
    setScreen('tipo')
    setMesaId(null)
    setMesaNombre('')
    setShowLogoutConfirm(false)
    toast.success('Turno cerrado. ¡Hasta luego!')
  }
  function irAHistorial() { setScreen('historial') }
  function irAInventario() { setScreen('inventario') }
  function irAReservaciones() { setScreen('reservaciones') }
  function irATurnos() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden ver los turnos'); return }
    setScreen('turnos')
  }
  function irAConfiguracion() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden acceder a configuración'); return }
    setScreen('configuracion')
  }
  function irAAnalisis() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden ver análisis'); return }
    setScreen('analisis')
  }
  function irAGastos() { setScreen('gastos') }
  function irAAdelantos() { setScreen('adelantos') }
  function irACupones() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden gestionar cupones'); return }
    setScreen('cupones')
  }
  function irAHappyHours() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden gestionar happy hours'); return }
    setScreen('happyhours')
  }
  function irAMenuEditor() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden editar el menú'); return }
    setScreen('menueditor')
  }
  function irADashboard() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden ver el dashboard'); return }
    setScreen('dashboard')
  }
  function irARecetas() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden gestionar recetas'); return }
    setScreen('recetas')
  }
  function irAOrdenesCompra() { setScreen('ordenes_compra') }
  function irAFiados() { setScreen('fiados') }
  function irAModificadores() {
    if (!activeCajero?.es_admin) { toast.error('Solo administradores pueden gestionar modificadores'); return }
    setScreen('modificadores_admin')
  }

  // ─── Página pública de pedidos online (no requiere auth) ──────────────
  if (new URLSearchParams(window.location.search).get('pedido') === '1') {
    return <PedidoOnlinePage />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--black)' }}>
        <div className="text-center">
          <div className="text-5xl mb-4 animate-gear inline-block">⚙️</div>
          <p className="text-xs font-black uppercase tracking-widest mt-2" style={{ color: 'var(--muted)' }}>
            Iniciando POS...
          </p>
        </div>
      </div>
    )
  }

  if (!activeCajero) {
    return <PinLoginPage onLogin={handleLogin} sesionActiva={sesionActiva} />
  }

  // Banner offline — siempre visible cuando no hay internet
  const OfflineBanner = !online ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: '#b45309', color: '#fff',
      padding: '6px 16px', textAlign: 'center',
      fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <span>📶</span>
      <span>MODO OFFLINE — Las ventas se guardan localmente y se sincronizan al reconectarse</span>
      {pendingOffline > 0 && <span style={{ background: '#92400e', padding: '2px 8px', borderRadius: 4 }}>
        {pendingOffline} pendiente{pendingOffline > 1 ? 's' : ''}
      </span>}
    </div>
  ) : pendingOffline > 0 ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: '#065f46', color: '#fff',
      padding: '6px 16px', textAlign: 'center',
      fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.15em',
      textTransform: 'uppercase',
    }}>
      ⚙️ Sincronizando {pendingOffline} venta{pendingOffline > 1 ? 's' : ''} offline...
    </div>
  ) : null

  if (screen === 'apertura_caja') {
    return (
      <AperturaCajaPage
        cajero={activeCajero}
        onAperturado={() => setScreen('tipo')}
        onSalir={cambiarCajero}
      />
    )
  }

  if (screen === 'orden') {
    return (
      <>
        {OfflineBanner}
        <OrdenPage
          mesaId={mesaId}
          mesaNombre={mesaNombre}
          cajero={activeCajero}
          tipo={tipoOrden}
          onVolver={mesaId ? volverAMesas : volverATipo}
        />
        {showInactividadWarning && <InactividadWarning secondsLeft={secondsLeft} onContinuar={resetInactividad} onBloquear={bloquear} />}
        {showLogoutConfirm && activeCajero && (
          <LogoutConfirmModal
            cajero={activeCajero}
            stats={turnoStats}
            onConfirm={cambiarCajero}
            onCancel={() => setShowLogoutConfirm(false)}
          />
        )}
      </>
    )
  }

  if (screen === 'mesas') {
    return (
      <>
        {OfflineBanner}
        <MesasPage cajero={activeCajero} onAbrirMesa={abrirMesa} onCambiarCajero={solicitarCambiarCajero} onVolver={volverATipo} />
        {showInactividadWarning && <InactividadWarning secondsLeft={secondsLeft} onContinuar={resetInactividad} onBloquear={bloquear} />}
        {showLogoutConfirm && activeCajero && (
          <LogoutConfirmModal
            cajero={activeCajero}
            stats={turnoStats}
            onConfirm={cambiarCajero}
            onCancel={() => setShowLogoutConfirm(false)}
          />
        )}
      </>
    )
  }

  if (screen === 'cocina') {
    return <KitchenPage cajero={activeCajero} onVolver={() => setScreen('tipo')} />
  }

  if (screen === 'reportes') {
    if (!activeCajero?.es_admin) return null
    return <ReportesPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'corte') {
    return <CorteCajaPage cajero={activeCajero} onVolver={volverATipo} onCerrarSesion={cerrarSesionCompleta} onIrApertura={() => setScreen('apertura_caja')} />
  }

  if (screen === 'historial') {
    return <HistorialPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'inventario') {
    return <InventarioPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'reservaciones') {
    return <ReservacionesPage cajero={activeCajero} onClose={() => setScreen('mesas')} />
  }

  if (screen === 'turnos') {
    if (!activeCajero?.es_admin) return null
    return <TurnosPage cajero={activeCajero} onClose={() => setScreen('mesas')} />
  }

  if (screen === 'configuracion') {
    if (!activeCajero?.es_admin) return null
    return <ConfiguracionPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'analisis') {
    if (!activeCajero?.es_admin) return null
    return <AnalisisPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'gastos') {
    return <GastosPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'adelantos') {
    return <AdelantosPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'cupones') {
    if (!activeCajero?.es_admin) return null
    return <CuponesPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'happyhours') {
    if (!activeCajero?.es_admin) return null
    return <HappyHoursPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'menueditor') {
    if (!activeCajero?.es_admin) return null
    return <MenuEditorPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'dashboard') {
    if (!activeCajero?.es_admin) return null
    return <DashboardPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'recetas') {
    if (!activeCajero?.es_admin) return null
    return <RecetasPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'ordenes_compra') {
    return <OrdenesCompraPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'modificadores_admin') {
    if (!activeCajero?.es_admin) return null
    return <ModificadoresAdminPage cajero={activeCajero} onVolver={volverATipo} />
  }

  if (screen === 'fiados') {
    return <FiadosPage cajero={activeCajero} onVolver={volverATipo} />
  }

  // screen === 'tipo'
  return (
    <>
      {OfflineBanner}
      {activeCajero && <DeliveryAlerts cajero={activeCajero} />}

      {/* ── Botón flotante "Canjear Recompensa" — siempre visible ── */}
      {activeCajero && (
        <button
          onClick={() => setShowCanjeModal(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-5 py-3 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95"
          style={{ boxShadow: '0 4px 24px rgba(240,168,0,0.5)' }}
        >
          <span className="text-xl">🎁</span>
          <span className="text-sm">Canjear Recompensa</span>
        </button>
      )}

      {/* ── Modal de canje de recompensa ── */}
      {showCanjeModal && <CanjeQRModal onClose={() => setShowCanjeModal(false)} cajeroNombre={activeCajero ? `${activeCajero.nombre} ${activeCajero.last_name}` : ''} />}

      {/* ── Botón flotante "Salir del Sistema" — esquina inferior izquierda ── */}
      {(window as any).electronAPI && (
        <button
          onClick={() => setShowSalirModal(true)}
          title="Salir del sistema"
          style={{
            position: 'fixed', bottom: 24, left: 24, zIndex: 40,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px',
            background: 'rgba(13,13,13,0.95)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: 'rgba(239,68,68,0.6)',
            fontWeight: 900, fontSize: 10, letterSpacing: '0.12em',
            textTransform: 'uppercase', cursor: 'pointer', borderRadius: 0,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; e.currentTarget.style.color = 'rgba(239,68,68,0.6)' }}
        >
          ⏻ Salir
        </button>
      )}

      {/* ── Modal de salida con clave ── */}
      {showSalirModal && <SalirSistemaModal onClose={() => setShowSalirModal(false)} />}

      {/* ── Modal selección de empleado ── */}
      {showModalEmpleado && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShowModalEmpleado(false)}
        >
          <div
            style={{
              background: '#111',
              border: '1px solid rgba(255,255,255,0.08)',
              borderTop: '3px solid #f97316',
              borderRadius: 8,
              width: '100%', maxWidth: 480,
              maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: '#0d0d0d',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div>
                <p style={{ color: '#f97316', fontWeight: 900, fontSize: '1rem', letterSpacing: '0.18em', textTransform: 'uppercase', margin: 0 }}>
                  👷 Consumo de Empleado
                </p>
                <p style={{ color: '#555', fontSize: '0.72rem', marginTop: 3, fontWeight: 600 }}>
                  Selecciona el empleado para esta orden
                </p>
              </div>
              <button
                onClick={() => setShowModalEmpleado(false)}
                style={{
                  background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#666', fontWeight: 900, fontSize: '0.8rem',
                  padding: '0.4rem 0.7rem', cursor: 'pointer', borderRadius: 4,
                  letterSpacing: '0.05em',
                }}
              >✕</button>
            </div>

            {/* Lista de empleados */}
            <div style={{ overflowY: 'auto', padding: '0.75rem' }}>
              {listaPersonal.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#555', fontWeight: 700 }}>
                  No hay personal activo registrado
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {listaPersonal.map(p => {
                    const rolColor: Record<string, string> = {
                      cajero: '#F0A800', cocinero: '#ef4444', mesero: '#22c55e',
                      barista: '#3b82f6', admin: '#a855f7', gerente: '#a855f7',
                    }
                    const color = rolColor[p.rol] ?? '#888'
                    return (
                      <button
                        key={p.id}
                        onClick={() => confirmarEmpleado(p.nombre, p.apellido)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.9rem',
                          padding: '0.8rem 1rem',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.07)',
                          borderRadius: 6,
                          cursor: 'pointer', textAlign: 'left', width: '100%',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(249,115,22,0.08)'
                          e.currentTarget.style.borderColor = 'rgba(249,115,22,0.35)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                          background: `${color}18`,
                          border: `2px solid ${color}55`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1.2rem', fontWeight: 900, color,
                        }}>
                          {p.nombre.charAt(0).toUpperCase()}
                        </div>
                        {/* Nombre */}
                        <div style={{ flex: 1 }}>
                          <p style={{ color: '#e5e5e5', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>
                            {p.nombre} {p.apellido}
                          </p>
                          <p style={{ color: '#555', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '2px 0 0' }}>
                            {p.rol}
                          </p>
                        </div>
                        {/* Flecha */}
                        <span style={{ color: '#333', fontSize: '1rem' }}>›</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <TipoOrdenPage
        cajero={activeCajero}
        onLlevar={elegirLlevar}
        onComedor={elegirComedor}
        onEmpleado={elegirEmpleado}
        onCambiarCajero={solicitarCambiarCajero}
        onCocina={irACocina}
        onReportes={irAReportes}
        onCorte={irACorte}
        onHistorial={irAHistorial}
        onInventario={irAInventario}
        onReservaciones={irAReservaciones}
        onTurnos={irATurnos}
        onConfiguracion={irAConfiguracion}
        onAnalisis={irAAnalisis}
        onGastos={irAGastos}
        onAdelantos={irAAdelantos}
        onCupones={irACupones}
        onHappyHours={irAHappyHours}
        onMenuEditor={irAMenuEditor}
        onDashboard={irADashboard}
        onRecetas={irARecetas}
        onOrdenesCompra={irAOrdenesCompra}
        onModificadores={irAModificadores}
        onFiados={irAFiados}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        connected={connected}
      />
      {showInactividadWarning && <InactividadWarning secondsLeft={secondsLeft} onContinuar={resetInactividad} onBloquear={bloquear} />}
      {showLogoutConfirm && activeCajero && (
        <LogoutConfirmModal
          cajero={activeCajero}
          stats={turnoStats}
          onConfirm={cambiarCajero}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </>
  )
}

/* ── Modal de confirmación de cambio de cajero ── */
function LogoutConfirmModal({ cajero, stats, onConfirm, onCancel }: {
  cajero: CajeroActivo
  stats: { total: number; ventas: number } | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-xs p-6 flex flex-col gap-4 animate-slide-up"
        style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)' }}>
        <div className="text-center">
          <span className="text-3xl">🔐</span>
          <p className="font-black text-base uppercase tracking-wide mt-2" style={{ color: 'var(--text)' }}>
            ¿Cambiar cajero?
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {cajero.nombre} {cajero.last_name}
          </p>
        </div>
        {stats && (
          <div className="grid grid-cols-2 gap-2">
            <div className="px-3 py-2.5 text-center" style={{ background: 'var(--dark)', border: '1px solid var(--border)' }}>
              <p className="font-black text-lg" style={{ color: 'var(--yellow)' }}>{stats.ventas}</p>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Ventas hoy</p>
            </div>
            <div className="px-3 py-2.5 text-center" style={{ background: 'var(--dark)', border: '1px solid var(--border)' }}>
              <p className="font-black text-lg" style={{ color: '#22c55e' }}>{fmt(stats.total)}</p>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Recaudado</p>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
            style={{ background: 'var(--dark)', color: 'var(--muted)', border: '2px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
            style={{ background: 'var(--yellow)', color: '#000', border: '2px solid var(--yellow)', borderRadius: 0, cursor: 'pointer' }}>
            Sí, cambiar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Modal de salida del sistema con clave ── */
function SalirSistemaModal({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [saliendo, setSaliendo] = useState(false)

  async function intentarSalir() {
    if (saliendo) return
    setSaliendo(true)
    setError(false)
    try {
      const ok = await (window as any).electronAPI?.cerrarApp(pin)
      if (!ok) {
        setError(true)
        setPin('')
      }
    } catch {
      setError(true)
      setPin('')
    } finally {
      setSaliendo(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') intentarSalir()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--charcoal)',
          border: '1px solid var(--border)',
          borderTop: '3px solid #ef4444',
          width: '100%', maxWidth: 360,
          padding: '2rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          animation: 'slideUp 0.18s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Ícono */}
        <div style={{
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(239,68,68,0.08)',
          border: '2px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26,
        }}>
          ⏻
        </div>

        {/* Título */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ef4444', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>
            Salir del Sistema
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 6, fontWeight: 600 }}>
            Ingresa la clave de administrador para cerrar la aplicación
          </p>
        </div>

        {/* Input clave */}
        <div style={{ width: '100%' }}>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={e => { setPin(e.target.value); setError(false) }}
            onKeyDown={handleKey}
            placeholder="_ _ _ _"
            maxLength={10}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--dark)',
              border: `2px solid ${error ? '#ef4444' : 'var(--border)'}`,
              color: error ? '#ef4444' : 'var(--text)',
              fontWeight: 900, fontSize: '1.4rem',
              letterSpacing: '0.5em', textAlign: 'center',
              padding: '0.75rem 1rem',
              outline: 'none', borderRadius: 0,
              fontFamily: 'monospace',
              transition: 'border-color 0.15s',
            }}
          />
          {error && (
            <p style={{ color: '#ef4444', fontSize: '0.7rem', fontWeight: 700, textAlign: 'center', marginTop: 6, letterSpacing: '0.05em' }}>
              Clave incorrecta — intenta de nuevo
            </p>
          )}
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '0.75rem',
              background: 'var(--dark)', border: '2px solid var(--border)',
              color: 'var(--muted)', fontWeight: 900, fontSize: '0.75rem',
              letterSpacing: '0.15em', textTransform: 'uppercase',
              cursor: 'pointer', borderRadius: 0,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={intentarSalir}
            disabled={!pin || saliendo}
            style={{
              flex: 1, padding: '0.75rem',
              background: !pin || saliendo ? 'rgba(239,68,68,0.15)' : '#ef4444',
              border: '2px solid #ef4444',
              color: !pin || saliendo ? '#ef444488' : '#fff',
              fontWeight: 900, fontSize: '0.75rem',
              letterSpacing: '0.15em', textTransform: 'uppercase',
              cursor: !pin || saliendo ? 'not-allowed' : 'pointer', borderRadius: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {saliendo ? '...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Aviso de inactividad ── */
function InactividadWarning({ secondsLeft, onContinuar, onBloquear }: {
  secondsLeft: number
  onContinuar: () => void
  onBloquear: () => void
}) {
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm p-8 flex flex-col items-center gap-5 text-center animate-slide-up"
        style={{ background: 'var(--charcoal)', border: '1px solid var(--border)', borderTop: '3px solid var(--yellow)' }}>
        <span className="text-4xl">🔒</span>
        <div>
          <p className="font-black text-lg uppercase tracking-wide" style={{ color: 'var(--text)' }}>
            Sesión inactiva
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            El POS se bloqueará en
          </p>
          <p className="font-black text-5xl mt-2 tabular-nums" style={{ color: 'var(--yellow)' }}>
            {secondsLeft}s
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={onBloquear}
            className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
            style={{ background: 'var(--dark)', color: 'var(--muted)', border: '2px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>
            Bloquear ahora
          </button>
          <button onClick={onContinuar}
            className="flex-1 py-3 font-black text-sm uppercase tracking-wider"
            style={{ background: 'var(--yellow)', color: '#000', border: '2px solid var(--yellow)', borderRadius: 0, cursor: 'pointer' }}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Pantalla tipo de orden ── */
function TipoOrdenPage({
  cajero, onLlevar, onComedor, onEmpleado, onCambiarCajero, onCocina, onReportes, onCorte, onHistorial, onInventario, onReservaciones, onTurnos, onConfiguracion, onAnalisis, onGastos, onAdelantos, onCupones, onHappyHours, onMenuEditor, onDashboard, onRecetas, onOrdenesCompra, onModificadores, onFiados, darkMode, onToggleDark, connected,
}: {
  cajero: CajeroActivo
  onLlevar: () => void
  onComedor: () => void
  onEmpleado: () => void
  onCambiarCajero: () => void
  onCocina: () => void
  onReportes: () => void
  onCorte: () => void
  onHistorial: () => void
  onInventario: () => void
  onReservaciones: () => void
  onTurnos: () => void
  onConfiguracion: () => void
  onAnalisis: () => void
  onGastos: () => void
  onAdelantos: () => void
  onCupones: () => void
  onHappyHours: () => void
  onMenuEditor: () => void
  onDashboard: () => void
  onRecetas: () => void
  onOrdenesCompra: () => void
  onModificadores: () => void
  onFiados: () => void
  darkMode: boolean
  onToggleDark: () => void
  connected?: boolean
}) {
  const ROL_COLORS: Record<string, string> = {
    admin: '#a855f7', gerente: '#3b82f6', cajero: '#22c55e',
    mesero: '#f59e0b', cocinero: '#ef4444',
  }
  const ROL_LABELS: Record<string, string> = {
    admin: 'Admin', gerente: 'Gerente', cajero: 'Cajero',
    mesero: 'Mesero', cocinero: 'Cocinero',
  }
  const rolColor = ROL_COLORS[cajero.rol] || 'var(--yellow)'
  const rolLabel = ROL_LABELS[cajero.rol] || cajero.rol

  const [ahora, setAhora] = useState(new Date())
  const [liveStats, setLiveStats] = useState({ ventas: 0, total: 0, ordenesPendientes: 0 })
  const [showVentas, setShowVentas] = useState(false)
  const [ventasModal, setVentasModal] = useState<{ id: string; total: number; metodo_pago: string; created_at: string; cajero_nombre: string }[]>([])
  const [cargandoVentas, setCargandoVentas] = useState(false)
  const [ventasApertura, setVentasApertura] = useState<string | null>(null)
  const [ventasPropinasTurnos, setVentasPropinasTurnos] = useState<{ manana: { tarjeta: number; efectivo: number }; tarde: { tarjeta: number; efectivo: number } }>({ manana: { tarjeta: 0, efectivo: 0 }, tarde: { tarjeta: 0, efectivo: 0 } })

  useEffect(() => {
    const timer = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    cargarLiveStats()
    const canal = supabase.channel('tipo-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, cargarLiveStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargarLiveStats)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  async function cargarLiveStats() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const [{ data: ventas }, { data: pendientes }] = await Promise.all([
      supabase.from('ventas').select('total').gte('created_at', hoy.toISOString()).eq('estado', 'completada'),
      supabase.from('ordenes').select('id').in('estado', ['abierta', 'en_caja']),
    ])
    const total = (ventas ?? []).reduce((s: number, v: any) => s + Number(v.total), 0)
    setLiveStats({ ventas: ventas?.length ?? 0, total, ordenesPendientes: pendientes?.length ?? 0 })
  }

  const horaStr = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const fechaStr = ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

  async function verVentas() {
    setCargandoVentas(true)
    setShowVentas(true)
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const hoyISO = hoy.toISOString()
    const { data: corte } = await supabase
      .from('cortes_caja')
      .select('apertura_at')
      .eq('cajero_id', cajero.id)
      .eq('estado', 'abierto')
      .gte('apertura_at', hoyISO)
      .maybeSingle()
    const desde = (corte as any)?.apertura_at ?? hoyISO
    setVentasApertura(desde)
    const [{ data: ventas }, { data: cortesHoy }] = await Promise.all([
      supabase
        .from('ventas')
        .select('id, total, metodo_pago, created_at, cajero_nombre')
        .gte('created_at', desde)
        .eq('estado', 'completada')
        .order('created_at', { ascending: true }),
      supabase
        .from('cortes_caja')
        .select('turno, total_propinas_tarjeta, total_propinas_efectivo')
        .gte('apertura_at', hoyISO),
    ])
    setVentasModal((ventas as any[]) ?? [])
    // Acumular propinas por turno de todos los cortes del día
    const pt = { manana: { tarjeta: 0, efectivo: 0 }, tarde: { tarjeta: 0, efectivo: 0 } }
    ;((cortesHoy as any[]) ?? []).forEach((c: any) => {
      const t = c.turno === 'tarde' ? 'tarde' : 'manana'
      pt[t].tarjeta  += Number(c.total_propinas_tarjeta ?? 0)
      pt[t].efectivo += Number(c.total_propinas_efectivo ?? 0)
    })
    setVentasPropinasTurnos(pt)
    setCargandoVentas(false)
  }

  async function imprimirVentas() {
    if (!hayImpresora('caja')) { toast('No hay impresora de caja configurada', { icon: '⚠️' }); return }

    const fmt     = (n: number) => '$' + n.toFixed(2)
    const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const totalGeneral  = ventasModal.reduce((s, v) => s + Number(v.total), 0)
    const totalEfectivo = ventasModal.filter(v => v.metodo_pago === 'efectivo').reduce((s, v) => s + Number(v.total), 0)
    const totalTarjeta  = ventasModal.filter(v => v.metodo_pago === 'tarjeta').reduce((s, v) => s + Number(v.total), 0)
    const totalMixto    = ventasModal.filter(v => v.metodo_pago === 'mixto').reduce((s, v) => s + Number(v.total), 0)
    const pt = ventasPropinasTurnos
    const totalPropinas = pt.manana.tarjeta + pt.manana.efectivo + pt.tarde.tarjeta + pt.tarde.efectivo
    const desde = ventasApertura ? new Date(ventasApertura).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '--'
    const hasta = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const abrev = (nombre: string) => {
      const p = nombre.trim().split(' ')
      return p.length >= 2 ? p[0][0] + '. ' + p.slice(1).join(' ') : nombre
    }

    const { data: ajRows } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['rest_nombre', 'rest_direccion', 'rest_telefono'])
    const aj: Record<string, string> = {}
    for (const r of ajRows ?? []) aj[r.clave] = r.valor
    const nombreLocal = (aj['rest_nombre'] || 'EL CAFE DEL CONSTRUCTOR').toUpperCase()

    const t = crearTicket()
    t.encabezado(nombreLocal, 'REPORTE DE VENTAS', {
      direccion: aj['rest_direccion'],
      telefono:  aj['rest_telefono'],
      eslogan:   'Tu obra, tu cafe, tus recompensas',
      info:      [`${cajero.nombre} ${cajero.last_name}`, `${desde} - ${hasta}`],
    })
    t.seccion('Resumen por metodo de pago')
    t.fila('Efectivo', fmt(totalEfectivo))
    t.fila('Tarjeta',  fmt(totalTarjeta))
    t.fila('Mixto',    fmt(totalMixto))
    t.sepDoble()
    t.totalGrande('TOTAL', fmt(totalGeneral))
    t.linea(`(${ventasModal.length} ventas)`.padStart(42))

    if (totalPropinas > 0) {
      t.sep()
      t.seccion('Propinas del dia')
      t.linea('Turno manana:')
      t.fila('  Tarjeta',  fmt(pt.manana.tarjeta))
      t.fila('  Efectivo', fmt(pt.manana.efectivo))
      t.linea('Turno tarde:')
      t.fila('  Tarjeta',  fmt(pt.tarde.tarjeta))
      t.fila('  Efectivo', fmt(pt.tarde.efectivo))
      t.sepDoble()
      t.filaB('TOTAL PROPINAS', fmt(totalPropinas))
    }

    t.sep()
    t.seccion('Detalle de ventas')
    t.filaB('#  Hora   Cajero            Pago   Total', '')
    t.sep()
    ventasModal.forEach((v, i) => {
      const num   = String(i + 1).padStart(2, '0')
      const hora  = fmtHora(v.created_at)
      const nom   = abrev(v.cajero_nombre || '--').slice(0, 14).padEnd(14)
      const pago  = (v.metodo_pago || '').slice(0, 6).padEnd(6)
      const total = fmt(Number(v.total)).padStart(7)
      t.linea(`${num} ${hora} ${nom} ${pago} ${total}`)
    })
    t.sep()
    t.centrar('-- Fin del reporte --')

    const ok = await imprimirPorTipo('caja', t.fin())
    if (!ok) toast.error('Error al imprimir — verifica la configuracion de impresora')
  }

  function abrirPantallaCliente() {
    window.open(window.location.origin + window.location.pathname + '?display=1', '_blank', 'width=1024,height=768,toolbar=no,menubar=no')
  }

  // Grupos de acceso por rol
  const CAJERO_TOOLS = [
    { icon: '📦', label: 'Inventario',    action: onInventario,   color: '#f59e0b' },
    { icon: '🗃',  label: 'Corte',         action: onCorte,        color: '#a855f7' },
    { icon: '📅', label: 'Reservaciones', action: onReservaciones, color: '#06b6d4' },
    { icon: '💵', label: 'Adelantos',     action: onAdelantos,    color: '#22c55e' },
    { icon: '💰', label: 'Ventas',        action: verVentas,      color: '#22c55e' },
    { icon: '📒', label: 'Fiados',        action: onFiados,       color: '#ef4444' },
  ]

  const ADMIN_GROUPS = [
    {
      label: 'Operaciones',
      items: [
        { icon: '🍳', label: 'Cocina',        action: onCocina,        color: '#ef4444' },
        { icon: '📊', label: 'Reportes',      action: onReportes,      color: '#3b82f6' },
        { icon: '📋', label: 'Historial',     action: onHistorial,     color: '#22c55e' },
        { icon: '🗃',  label: 'Corte',         action: onCorte,         color: '#a855f7' },
        { icon: '💰', label: 'Ventas',        action: verVentas,       color: '#22c55e' },
        { icon: '📅', label: 'Reservaciones', action: onReservaciones,  color: '#06b6d4' },
        { icon: '📦', label: 'Inventario',    action: onInventario,    color: '#f59e0b' },
        { icon: '👷', label: 'Turnos',        action: onTurnos,        color: '#f97316' },
      ],
    },
    {
      label: 'Gestión',
      items: [
        { icon: '💸', label: 'Gastos',     action: onGastos,      color: '#ef4444' },
        { icon: '💵', label: 'Adelantos',  action: onAdelantos,   color: '#22c55e' },
        { icon: '📒', label: 'Fiados',     action: onFiados,      color: '#ef4444' },
        { icon: '🛒', label: 'Órd. Compra', action: onOrdenesCompra, color: '#f97316' },
        { icon: '🎟', label: 'Cupones',    action: onCupones,     color: '#a855f7' },
        { icon: '⚡', label: 'Happy Hrs',  action: onHappyHours,  color: '#F0A800' },
      ],
    },
    {
      label: 'Menú & Config',
      items: [
        { icon: '🍽', label: 'Menú',          action: onMenuEditor,   color: '#f59e0b' },
        { icon: '📋', label: 'Recetas',       action: onRecetas,      color: '#f59e0b' },
        { icon: '⚙️', label: 'Modificadores', action: onModificadores, color: '#a855f7' },
        { icon: '📈', label: 'Dashboard',     action: onDashboard,    color: '#F0A800' },
        { icon: '🔬', label: 'Análisis',      action: onAnalisis,     color: '#22c55e' },
        { icon: '⚙️', label: 'Config',        action: onConfiguracion, color: '#6b7280' },
      ],
    },
  ]

  function NavBtn({ icon, label, action, color }: { icon: string; label: string; action: () => void; color: string }) {
    return (
      <button
        onClick={action}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, padding: '10px 8px', cursor: 'pointer', borderRadius: 0,
          background: 'var(--charcoal)', border: `1px solid var(--border)`,
          minWidth: 68, flex: '1 1 68px',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = color
          e.currentTarget.style.background = `${color}12`
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.background = 'var(--charcoal)'
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 9, fontWeight: 900, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>
    )
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--black)' }}>
      <div className="hazard-stripe-sm h-1 shrink-0" />

      {/* Header */}
      <header className="px-3 py-2 flex items-center gap-2 shrink-0"
        style={{ background: 'var(--charcoal)', borderBottom: '1px solid var(--border)' }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xl animate-gear inline-block select-none">⚙️</span>
          <div className="hidden sm:block">
            <p className="font-black text-xs uppercase tracking-wider" style={{ color: 'var(--text)' }}>Café del Constructor</p>
            <p className="text-xs" style={{ color: 'var(--muted)', fontSize: 10 }}>Sistema POS</p>
          </div>
        </div>

        {/* Reloj central */}
        <div className="flex-1 flex flex-col items-center">
          <p className="font-black text-lg tabular-nums" style={{ color: 'var(--yellow)', letterSpacing: '0.04em' }}>
            {horaStr}
          </p>
          <p className="text-xs capitalize hidden sm:block" style={{ color: 'var(--muted)', fontSize: 10 }}>{fechaStr}</p>
        </div>

        {/* Derecha: usuario + controles */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Cajero info */}
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>{cajero.nombre} {cajero.last_name}</p>
            <span className="inline-block text-xs font-black uppercase tracking-widest px-1.5 py-0.5"
              style={{ background: `${rolColor}18`, border: `1px solid ${rolColor}55`, color: rolColor, borderRadius: 0, fontSize: 9 }}>
              {rolLabel}
            </span>
          </div>

          {/* Indicador conexión */}
          <div className="flex items-center gap-1" title={connected !== false ? 'Conectado' : 'Sin conexión'}>
            <div className={connected !== false ? 'animate-dot-pulse' : ''}
              style={{ width: 7, height: 7, borderRadius: '50%', background: connected !== false ? '#22c55e' : '#ef4444', boxShadow: `0 0 4px ${connected !== false ? '#22c55e' : '#ef4444'}` }} />
            <span className="hidden sm:inline text-xs font-black uppercase" style={{ color: connected !== false ? '#22c55e' : '#ef4444', opacity: 0.8, fontSize: 9, letterSpacing: '0.05em' }}>
              {connected !== false ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* Pantalla cliente */}
          <button onClick={abrirPantallaCliente} title="Pantalla cliente"
            className="text-xs font-black px-2 py-1.5 hidden sm:block"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none', cursor: 'pointer', borderRadius: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.color = '#22c55e' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
            🖥
          </button>

          <button onClick={onToggleDark} title={darkMode ? 'Modo claro' : 'Modo oscuro'}
            className="text-xs font-black px-2 py-1.5"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none', cursor: 'pointer', borderRadius: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
            {darkMode ? '☀️' : '🌙'}
          </button>

          <button onClick={onCambiarCajero}
            className="text-xs font-black uppercase tracking-wider px-2 py-1.5"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none', cursor: 'pointer', borderRadius: 0 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}>
            ⇄ <span className="hidden sm:inline">Cajero</span>
          </button>
        </div>
      </header>

      {/* Stats en tiempo real */}
      <div className="px-3 py-1.5 flex items-center gap-2 shrink-0 overflow-x-auto"
        style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-black uppercase tracking-widest shrink-0" style={{ color: 'var(--muted)', fontSize: 9 }}>Hoy:</span>
        <div className="flex items-center gap-1.5 px-2 py-0.5 shrink-0"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <span className="text-xs font-black" style={{ color: '#22c55e', fontSize: 10 }}>
            💰 {liveStats.ventas} venta{liveStats.ventas !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 shrink-0"
          style={{ background: 'rgba(240,168,0,0.08)', border: '1px solid rgba(240,168,0,0.2)' }}>
          <span className="text-xs font-black" style={{ color: 'var(--yellow)', fontSize: 10 }}>
            ${liveStats.total.toLocaleString('es-MX', { minimumFractionDigits: 0 })} MXN
          </span>
        </div>
        {liveStats.ordenesPendientes > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 shrink-0"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span className="text-xs font-black" style={{ color: '#ef4444', fontSize: 10 }}>
              🍳 {liveStats.ordenesPendientes} en cocina
            </span>
          </div>
        )}
      </div>

      {/* ── Acceso rápido ── */}
      <div className="shrink-0 px-3 py-2" style={{ background: 'var(--dark)', borderBottom: '1px solid var(--border)' }}>
        {cajero.es_admin ? (
          // Admin: grupos organizados
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ADMIN_GROUPS.map(group => (
              <div key={group.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 900, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', opacity: 0.5, whiteSpace: 'nowrap', minWidth: 64 }}>
                  {group.label}
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                  {group.items.map(item => (
                    <NavBtn key={item.label} {...item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Cajero: solo 3 herramientas
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 900, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', opacity: 0.5, whiteSpace: 'nowrap' }}>
              Herramientas
            </span>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {CAJERO_TOOLS.map(item => (
                <NavBtn key={item.label} {...item} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content: selector de tipo de orden */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 overflow-hidden">
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: 'var(--yellow)' }}>
            // Nueva orden
          </p>
          <h2 className="font-black text-xl uppercase tracking-wide" style={{ color: 'var(--text)' }}>
            ¿Cómo es el pedido?
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-3 w-full" style={{ maxWidth: 680 }}>
          {[
            { label: 'Para Llevar', sub: 'Orden sin mesa',      icon: '🛍️', color: 'var(--yellow)', bg: 'rgba(240,168,0,0.07)',  action: onLlevar  },
            { label: 'Comedor',     sub: 'Seleccionar mesa',    icon: '🪑',  color: '#22c55e',       bg: 'rgba(34,197,94,0.07)',  action: onComedor },
            { label: 'Empleado',    sub: 'Consumo sin cobro',   icon: '👷',  color: '#f97316',       bg: 'rgba(249,115,22,0.07)', action: onEmpleado },
          ].map(({ label, sub, icon, color, bg, action }) => (
            <button key={label} onClick={action}
              className="flex flex-col items-center justify-center gap-3 transition-all active:scale-95"
              style={{
                background: 'var(--charcoal)', border: '2px solid var(--border)',
                borderTop: `3px solid ${color}`, padding: 'clamp(1rem, 4vw, 2.5rem) 1rem',
                borderRadius: 0, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = bg; e.currentTarget.style.borderColor = color }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--charcoal)'; e.currentTarget.style.borderColor = 'var(--border)'; (e.currentTarget.style as any).borderTopColor = color }}>
              <span className="text-4xl select-none">{icon}</span>
              <div className="text-center">
                <p className="font-black text-base uppercase tracking-wide" style={{ color: 'var(--text)' }}>{label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 py-1.5 px-4 flex items-center justify-center gap-3"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--charcoal)' }}>
        <div className="hazard-stripe-sm" style={{ width: 14, height: 8, opacity: 0.5 }} />
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--muted)', opacity: 0.5, fontSize: 9 }}>
          v2.5.0 · Café del Constructor POS
        </p>
        <div className="hazard-stripe-sm" style={{ width: 14, height: 8, opacity: 0.5 }} />
      </div>

      {/* ── Modal VENTAS ── */}
      {showVentas && (() => {
        const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
        const totalGral   = ventasModal.reduce((s, v) => s + Number(v.total), 0)
        const vEfectivo   = ventasModal.filter(v => v.metodo_pago === 'efectivo')
        const vTarjeta    = ventasModal.filter(v => v.metodo_pago === 'tarjeta')
        const vMixto      = ventasModal.filter(v => v.metodo_pago === 'mixto')
        const totEfectivo = vEfectivo.reduce((s, v) => s + Number(v.total), 0)
        const totTarjeta  = vTarjeta.reduce((s, v) => s + Number(v.total), 0)
        const totMixto    = vMixto.reduce((s, v) => s + Number(v.total), 0)
        const desdeStr    = ventasApertura
          ? new Date(ventasApertura).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
          : '—'

        const metodoBadge = (mp: string) => {
          const cfg: Record<string, { bg: string; color: string; border: string }> = {
            efectivo: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', border: 'rgba(34,197,94,0.3)' },
            tarjeta:  { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
            mixto:    { bg: 'rgba(240,168,0,0.12)', color: 'var(--yellow)', border: 'rgba(240,168,0,0.3)' },
          }
          const c = cfg[mp] ?? cfg.mixto
          return (
            <span style={{
              fontSize: '0.62rem', fontWeight: 900, textTransform: 'capitalize',
              padding: '2px 8px', borderRadius: 3, letterSpacing: '0.05em',
              background: c.bg, color: c.color, border: `1px solid ${c.border}`,
            }}>{mp}</span>
          )
        }

        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }} onClick={() => setShowVentas(false)}>
            <div style={{
              background: '#111',
              border: '1px solid rgba(255,255,255,0.08)',
              borderTop: '3px solid var(--yellow)',
              borderRadius: 8,
              width: '100%', maxWidth: 620,
              maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            }} onClick={e => e.stopPropagation()}>

              {/* ── Header ── */}
              <div style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0, background: '#0d0d0d',
              }}>
                <div>
                  <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1rem', letterSpacing: '0.18em', textTransform: 'uppercase', margin: 0 }}>
                    💰 Ventas del Turno
                  </p>
                  <p style={{ color: '#555', fontSize: '0.72rem', marginTop: 3, fontWeight: 600 }}>
                    Desde las {desdeStr} · {cajero.nombre} {cajero.last_name}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={imprimirVentas} disabled={cargandoVentas || ventasModal.length === 0}
                    style={{
                      padding: '0.45rem 1rem', background: 'var(--yellow)', color: '#000',
                      border: 'none', fontWeight: 900, fontSize: '0.75rem',
                      letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
                      opacity: cargandoVentas || ventasModal.length === 0 ? 0.45 : 1,
                      borderRadius: 4,
                    }}>
                    🖨️ Imprimir
                  </button>
                  <button onClick={() => setShowVentas(false)} style={{
                    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#666', fontWeight: 900, fontSize: '0.75rem',
                    padding: '0.45rem 0.85rem', cursor: 'pointer',
                    letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 4,
                  }}>✕</button>
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {cargandoVentas ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--yellow)', fontWeight: 900, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    ⚙️ Cargando ventas…
                  </div>
                ) : ventasModal.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center' }}>
                    <p style={{ color: '#444', fontWeight: 700, fontSize: '0.9rem' }}>Sin ventas registradas en este turno</p>
                  </div>
                ) : (
                  <>
                    {/* ── Gran total ── */}
                    <div style={{
                      padding: '1.25rem 1.5rem',
                      background: 'linear-gradient(135deg, rgba(240,168,0,0.08) 0%, rgba(240,168,0,0.03) 100%)',
                      borderBottom: '1px solid rgba(240,168,0,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div>
                        <p style={{ color: '#888', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 4 }}>
                          Total recaudado del turno
                        </p>
                        <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '2rem', letterSpacing: '0.02em', lineHeight: 1 }}>
                          {fmt(totalGral)}
                        </p>
                      </div>
                      <div style={{
                        background: 'rgba(240,168,0,0.1)', border: '1px solid rgba(240,168,0,0.25)',
                        borderRadius: 8, padding: '0.5rem 1rem', textAlign: 'center',
                      }}>
                        <p style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}>{ventasModal.length}</p>
                        <p style={{ color: '#777', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                          venta{ventasModal.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {/* ── Desglose por método de pago ── */}
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <p style={{ color: '#555', fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '0.75rem' }}>
                        Desglose por método de pago
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
                        {[
                          { label: 'Efectivo', icon: '💵', count: vEfectivo.length, total: totEfectivo, color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' },
                          { label: 'Tarjeta', icon: '💳', count: vTarjeta.length, total: totTarjeta, color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)' },
                          { label: 'Mixto', icon: '🔄', count: vMixto.length, total: totMixto, color: '#F0A800', bg: 'rgba(240,168,0,0.08)', border: 'rgba(240,168,0,0.2)' },
                        ].map(m => (
                          <div key={m.label} style={{
                            background: m.bg, border: `1px solid ${m.border}`,
                            borderRadius: 6, padding: '0.75rem',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 16 }}>{m.icon}</span>
                              <span style={{ color: m.color, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.label}</span>
                            </div>
                            <p style={{ color: '#fff', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1, marginBottom: 3 }}>
                              {fmt(m.total)}
                            </p>
                            <p style={{ color: '#666', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                              {m.count} venta{m.count !== 1 ? 's' : ''}
                              {m.count > 0 && ventasModal.length > 0
                                ? ` · ${Math.round((m.count / ventasModal.length) * 100)}%`
                                : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Barra visual proporcional ── */}
                    {totalGral > 0 && (
                      <div style={{ padding: '0 1.25rem 1rem' }}>
                        <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', marginTop: '0.75rem' }}>
                          {totEfectivo > 0 && <div style={{ flex: totEfectivo, background: '#22c55e' }} title={`Efectivo: ${fmt(totEfectivo)}`} />}
                          {totTarjeta > 0 && <div style={{ flex: totTarjeta, background: '#3b82f6' }} title={`Tarjeta: ${fmt(totTarjeta)}`} />}
                          {totMixto > 0 && <div style={{ flex: totMixto, background: '#F0A800' }} title={`Mixto: ${fmt(totMixto)}`} />}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: 5 }}>
                          {[['#22c55e','Efectivo'],['#3b82f6','Tarjeta'],['#F0A800','Mixto']].map(([c, l]) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                              <span style={{ color: '#555', fontSize: '0.62rem', fontWeight: 700 }}>{l}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Propinas por turno ── */}
                    {(() => {
                      const pt = ventasPropinasTurnos
                      const totProp = pt.manana.tarjeta + pt.manana.efectivo + pt.tarde.tarjeta + pt.tarde.efectivo
                      if (totProp === 0) return null
                      const fmtP = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
                      return (
                        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(168,85,247,0.04)' }}>
                          <p style={{ color: '#a855f7', fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '0.75rem' }}>
                            💜 Propinas del día
                          </p>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                            {[
                              {
                                turno: 'Turno Mañana', icon: '🌅',
                                tarjeta: pt.manana.tarjeta, efectivo: pt.manana.efectivo,
                              },
                              {
                                turno: 'Turno Tarde', icon: '🌆',
                                tarjeta: pt.tarde.tarjeta, efectivo: pt.tarde.efectivo,
                              },
                            ].map(t => (
                              <div key={t.turno} style={{
                                background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)',
                                borderRadius: 6, padding: '0.75rem',
                              }}>
                                <p style={{ color: '#a855f7', fontWeight: 900, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                  {t.icon} {t.turno}
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                  <span style={{ color: '#666', fontSize: '0.7rem', fontWeight: 700 }}>💳 Tarjeta</span>
                                  <span style={{ color: '#3b82f6', fontWeight: 900, fontSize: '0.8rem' }}>{fmtP(t.tarjeta)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: '#666', fontSize: '0.7rem', fontWeight: 700 }}>💵 Efectivo</span>
                                  <span style={{ color: '#22c55e', fontWeight: 900, fontSize: '0.8rem' }}>{fmtP(t.efectivo)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{
                            marginTop: '0.6rem', padding: '0.6rem 0.75rem',
                            background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
                            borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <span style={{ color: '#a855f7', fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total propinas</span>
                            <span style={{ color: '#fff', fontWeight: 900, fontSize: '1.1rem' }}>{fmtP(totProp)}</span>
                          </div>
                        </div>
                      )
                    })()}

                    {/* ── Lista de ventas ── */}
                    <div style={{ padding: '0 1.25rem 1.25rem' }}>
                      <p style={{ color: '#555', fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '0.6rem' }}>
                        Detalle de ventas
                      </p>
                      {/* Cabecera tabla */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '28px 1fr 1fr 90px',
                        gap: '0.5rem', padding: '0.4rem 0.5rem',
                        background: '#0a0a0a', borderRadius: '4px 4px 0 0',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {['#','Hora · Cajero','Método','Total'].map((h, i) => (
                          <span key={h} style={{
                            color: '#444', fontWeight: 900, fontSize: '0.6rem',
                            textTransform: 'uppercase', letterSpacing: '0.12em',
                            textAlign: i === 3 ? 'right' : 'left',
                          }}>{h}</span>
                        ))}
                      </div>
                      {/* Filas */}
                      {ventasModal.map((v, i) => (
                        <div key={v.id} style={{
                          display: 'grid', gridTemplateColumns: '28px 1fr 1fr 90px',
                          gap: '0.5rem', padding: '0.5rem 0.5rem',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          alignItems: 'center',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        }}>
                          <span style={{ color: '#444', fontWeight: 900, fontSize: '0.65rem' }}>#{i + 1}</span>
                          <div>
                            <p style={{ color: '#ddd', fontWeight: 700, fontSize: '0.82rem', margin: 0 }}>
                              {new Date(v.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p style={{ color: '#555', fontSize: '0.65rem', fontWeight: 600, margin: 0 }}>
                              {v.cajero_nombre || '—'}
                            </p>
                          </div>
                          <div>{metodoBadge(v.metodo_pago)}</div>
                          <span style={{ color: '#fff', fontWeight: 900, fontSize: '0.85rem', textAlign: 'right' }}>
                            {fmt(Number(v.total))}
                          </span>
                        </div>
                      ))}
                      {/* Total footer */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '28px 1fr 1fr 90px',
                        gap: '0.5rem', padding: '0.6rem 0.5rem',
                        background: 'rgba(240,168,0,0.06)',
                        border: '1px solid rgba(240,168,0,0.15)',
                        borderTop: '2px solid rgba(240,168,0,0.3)',
                        borderRadius: '0 0 4px 4px',
                        alignItems: 'center',
                      }}>
                        <span />
                        <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          Total · {ventasModal.length} ventas
                        </span>
                        <span />
                        <span style={{ color: 'var(--yellow)', fontWeight: 900, fontSize: '1rem', textAlign: 'right' }}>
                          {fmt(totalGral)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

