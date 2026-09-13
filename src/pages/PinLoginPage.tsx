import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import { logger } from '../services/logger'

interface StaffMember {
  id: string
  nombre: string
  apellido: string
  rol: string
  pin: string | null
}

interface Props {
  onLogin: (cajero: { id: string; nombre: string; last_name: string; rol: string; turno: 'mañana' | 'tarde' }) => void
  sesionActiva: boolean
}

const WMO: Record<number, { desc: string; icon: string }> = {
  0:  { desc: 'Despejado',      icon: '☀️' },
  1:  { desc: 'Mayormente claro', icon: '🌤️' },
  2:  { desc: 'Parcialmente nublado', icon: '⛅' },
  3:  { desc: 'Nublado',        icon: '☁️' },
  45: { desc: 'Niebla',         icon: '🌫️' },
  48: { desc: 'Niebla',         icon: '🌫️' },
  51: { desc: 'Llovizna',       icon: '🌦️' },
  53: { desc: 'Llovizna',       icon: '🌦️' },
  55: { desc: 'Llovizna',       icon: '🌦️' },
  61: { desc: 'Lluvia ligera',  icon: '🌧️' },
  63: { desc: 'Lluvia',         icon: '🌧️' },
  65: { desc: 'Lluvia intensa', icon: '🌧️' },
  71: { desc: 'Nieve ligera',   icon: '❄️' },
  73: { desc: 'Nieve',          icon: '❄️' },
  80: { desc: 'Chubascos',      icon: '🌦️' },
  81: { desc: 'Chubascos',      icon: '🌦️' },
  95: { desc: 'Tormenta',       icon: '⛈️' },
}

const PERSONAL_CACHE_KEY = 'pos_personal_cache'

const ROL_LABELS: Record<string, string> = {
  admin: 'Administrador', cajero: 'Cajero', cocinero: 'Cocinero',
  mesero: 'Mesero', barista: 'Barista', gerente: 'Gerente',
}
const ROL_COLORS: Record<string, string> = {
  admin: '#a855f7', cajero: '#F0A800', cocinero: '#ef4444',
  mesero: '#22c55e', barista: '#3b82f6', gerente: '#a855f7',
}

export default function PinLoginPage({ onLogin, sesionActiva }: Props) {
  const [personal, setPersonal]         = useState<StaffMember[]>([])
  const [pin, setPin]                   = useState('')
  const [verificando, setVerificando]   = useState(false)
  const [pinError, setPinError]         = useState(false)
  const [mostrarAdmin, setMostrarAdmin] = useState(false)
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [loginAdmin, setLoginAdmin]     = useState(false)
  const [hora, setHora]                 = useState(new Date())

  // Nuevas funcionalidades
  const [ventasDia, setVentasDia]         = useState({ total: 0, count: 0 })
  const [ordenesPend, setOrdenesPend]     = useState(0)
  const [ultimoAcceso, setUltimoAcceso]   = useState<{ nombre: string; tiempo: string } | null>(null)
  const [mensajeDelDia, setMensajeDelDia] = useState('')
  const [sistemaOk, setSistemaOk]         = useState(true)
  const [clima, setClima]                 = useState<{ temp: number; icon: string; desc: string } | null>(null)
  const [loginOk, setLoginOk]             = useState<{ id: string; nombre: string; apellido: string; rol: string } | null>(null)
  const [loginProgress, setLoginProgress] = useState(0)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Modal de asistencia
  const [showAsistencia, setShowAsistencia] = useState(false)
  const [presentes, setPresentes]           = useState<{id:string; cajero_nombre:string; hora_entrada:string}[]>([])
  const [entPin, setEntPin]                 = useState('')
  const [entVerif, setEntVerif]             = useState(false)
  const [entError, setEntError]             = useState(false)
  const [entOk, setEntOk]                   = useState<string|null>(null)
  const [salPersona, setSalPersona]         = useState<{id:string; cajero_nombre:string; hora_entrada:string}|null>(null)
  const [salPin, setSalPin]                 = useState('')
  const [salVerif, setSalVerif]             = useState(false)
  const [salError, setSalError]             = useState(false)
  const [salOk, setSalOk]                   = useState<string|null>(null)

  // ─── Reloj ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ─── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (sesionActiva) {
      cargarPersonal()
      cargarEstadisticas()
      cargarUltimoAcceso()
      cargarMensajeDelDia()
      cargarClima()
    }
    verificarSistema()
  }, [sesionActiva])

  // ─── Refresco en vivo cada 30s ──────────────────────────────────────────────
  useEffect(() => {
    if (!sesionActiva) return
    const t = setInterval(() => {
      cargarEstadisticas()
    }, 30_000)
    return () => clearInterval(t)
  }, [sesionActiva])

  async function cargarPersonal() {
    const { data, error } = await supabase
      .from('personal').select('id, nombre, apellido, rol, pin').eq('activo', true)
    if (error || !data) {
      void logger.warn('login', 'cargarPersonal falló — intentando caché', { error: error?.message, online: navigator.onLine })
      // Sin internet — intentar caché local
      try {
        const cached = localStorage.getItem(PERSONAL_CACHE_KEY)
        if (cached) {
          setPersonal(JSON.parse(cached) as StaffMember[])
          return
        }
      } catch {}
      toast.error('Sin conexión — conecta a internet una vez para activar el modo offline')
      return
    }
    // Guardar en caché para uso offline
    try { localStorage.setItem(PERSONAL_CACHE_KEY, JSON.stringify(data)) } catch {}
    setPersonal(data as StaffMember[])
  }

  async function cargarEstadisticas() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const [{ data: ventas }, { data: ordenes }] = await Promise.all([
      supabase.from('ventas').select('total').gte('created_at', hoy.toISOString()).eq('estado', 'completada'),
      supabase.from('ordenes').select('id').in('estado', ['abierta', 'en_caja']),
    ])
    const total = (ventas ?? []).reduce((s: number, v: any) => s + Number(v.total), 0)
    setVentasDia({ total, count: ventas?.length ?? 0 })
    setOrdenesPend(ordenes?.length ?? 0)
  }

  async function cargarUltimoAcceso() {
    const { data } = await supabase
      .from('cortes_caja')
      .select('cajero_nombre, apertura_at')
      .order('apertura_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      const diff = Date.now() - new Date((data as any).apertura_at).getTime()
      const mins = Math.floor(diff / 60000)
      const tiempo = mins < 60
        ? `hace ${mins} min`
        : mins < 1440
        ? `hace ${Math.floor(mins / 60)}h ${mins % 60}min`
        : `hace ${Math.floor(mins / 1440)} día${Math.floor(mins / 1440) > 1 ? 's' : ''}`
      setUltimoAcceso({ nombre: (data as any).cajero_nombre, tiempo })
    }
  }

  async function cargarMensajeDelDia() {
    try {
      const { data } = await supabase
        .from('configuracion')
        .select('valor')
        .eq('clave', 'mensaje_dia')
        .maybeSingle()
      if (data) setMensajeDelDia((data as any).valor || '')
    } catch { /* tabla puede no existir */ }
  }

  async function verificarSistema() {
    try {
      const { error } = await supabase.from('personal').select('id').limit(1)
      if (!error) { setSistemaOk(true); return }
    } catch {}
    // Sin conexión — considerar OK si hay caché local disponible
    try {
      const cached = localStorage.getItem(PERSONAL_CACHE_KEY)
      setSistemaOk(!!cached)
    } catch { setSistemaOk(false) }
  }

  async function cargarClima() {
    try {
      // Intenta geolocalización; si falla usa CDMX
      const coords = await new Promise<{ lat: number; lon: number }>((res, rej) => {
        if (!navigator.geolocation) { res({ lat: 19.4326, lon: -99.1332 }); return }
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => res({ lat: 19.4326, lon: -99.1332 }),
          { timeout: 4000 },
        )
      })
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&timezone=auto`
      const r = await fetch(url)
      if (!r.ok) return
      const json = await r.json()
      const code = json.current.weather_code as number
      const temp = Math.round(json.current.temperature_2m as number)
      const info = WMO[code] ?? { desc: 'Variable', icon: '🌡️' }
      setClima({ temp, icon: info.icon, desc: info.desc })
    } catch { /* silencioso */ }
  }

  // ─── PIN ───────────────────────────────────────────────────────────────────
  function presionarTecla(val: string) {
    if (verificando || loginOk) return
    if (val === 'C') { setPin(''); setPinError(false); return }
    if (val === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (pin.length >= 4) return
    const nuevo = pin + val
    setPin(nuevo)
    if (nuevo.length === 4) verificarPin(nuevo)
  }

  async function verificarPin(pinIngresado: string) {
    setVerificando(true)
    await new Promise(r => setTimeout(r, 380))
    // Convertir a string por si el campo pin es integer en la BD
    const encontrado = personal.find(p => p.pin != null && String(p.pin) === pinIngresado)
    if (encontrado) {
      const rol = (encontrado.rol ?? '').toLowerCase().trim()
      if (rol === 'cocinero') {
        // Cocineros sin acceso al POS, usar botón de asistencia
        setPinError(true)
        setTimeout(() => { setPinError(false); setPin('') }, 750)
        toast.error('Usa el botón "Marcar Entrada / Salida"')
        setVerificando(false)
        return
      }
      setPin('')
      setVerificando(false)
      setLoginOk(encontrado)
      setLoginProgress(0)
      let p = 0
      let cancelled = false
      progressRef.current = setInterval(() => {
        p += 2
        if (!cancelled) setLoginProgress(p)
        if (p >= 100) {
          if (progressRef.current) clearInterval(progressRef.current)
          if (!cancelled) onLogin({
            id: encontrado.id,
            nombre: encontrado.nombre,
            last_name: encontrado.apellido,
            rol: encontrado.rol,
            turno: new Date().getHours() < 15 ? 'mañana' : 'tarde',
          })
        }
      }, 40)
      // Marcar cancelado al desmontar (el cleanup de useEffect ya hace clearInterval,
      // pero cancelled evita que onLogin dispare tras unmount)
      ;(progressRef as any)._cancelLogin = () => { cancelled = true }
    } else {
      setPinError(true)
      setTimeout(() => { setPinError(false); setPin('') }, 750)
      toast.error('PIN incorrecto')
      setVerificando(false)
    }
  }

  // ─── Modal de asistencia ────────────────────────────────────────────────────
  async function cargarPresentes() {
    const hoyInicio = new Date()
    hoyInicio.setHours(0, 0, 0, 0)
    const { data, error } = await supabase
      .from('turnos_personal')
      .select('id, cajero_nombre, hora_entrada')
      .gte('hora_entrada', hoyInicio.toISOString())
      .is('hora_salida', null)
      .order('hora_entrada', { ascending: true })
    if (error) toast.error('Error al cargar asistencia')
    setPresentes((data as any[]) ?? [])
  }

  function abrirAsistencia() {
    setShowAsistencia(true)
    cargarPresentes()
  }

  function cerrarAsistencia() {
    setShowAsistencia(false)
    setEntPin(''); setEntVerif(false); setEntError(false); setEntOk(null)
    setSalPersona(null); setSalPin(''); setSalVerif(false); setSalError(false); setSalOk(null)
  }

  function presionarEntrada(val: string) {
    if (entVerif || entOk) return
    if (val === 'C') { setEntPin(''); setEntError(false); return }
    if (val === '⌫') { setEntPin(p => p.slice(0, -1)); return }
    if (entPin.length >= 4) return
    const nuevo = entPin + val
    setEntPin(nuevo)
    if (nuevo.length === 4) verificarEntrada(nuevo)
  }

  async function verificarEntrada(pin: string) {
    setEntVerif(true)
    await new Promise(r => setTimeout(r, 350))
    const emp = personal.find(p => p.pin != null && String(p.pin) === pin)
    if (!emp) {
      setEntError(true)
      setTimeout(() => { setEntError(false); setEntPin('') }, 750)
      toast.error('PIN incorrecto')
      setEntVerif(false)
      return
    }
    const ahora = new Date()
    const hoy = ahora.toISOString().split('T')[0]
    const nombre = `${emp.nombre} ${emp.apellido}`.trim()
    const { error: insertErr } = await supabase.from('turnos_personal').insert({
      cajero_nombre: nombre,
      hora_entrada: ahora.toISOString(),
      hora_salida: null,
      horas_trabajadas: null,
      fecha: hoy,
      tipo: 'normal',
    })
    if (insertErr) {
      toast.error('Error al registrar entrada')
      setEntVerif(false)
      return
    }
    setEntPin('')
    setEntVerif(false)
    setEntOk(nombre)
    await cargarPresentes()
    setTimeout(() => setEntOk(null), 2000)
  }

  function presionarSalida(val: string) {
    if (salVerif || salOk) return
    if (val === 'C') { setSalPin(''); setSalError(false); return }
    if (val === '⌫') { setSalPin(p => p.slice(0, -1)); return }
    if (salPin.length >= 4) return
    const nuevo = salPin + val
    setSalPin(nuevo)
    if (nuevo.length === 4) verificarSalida(nuevo)
  }

  async function verificarSalida(pin: string) {
    if (!salPersona) return
    setSalVerif(true)
    await new Promise(r => setTimeout(r, 350))
    const emp = personal.find(p => p.pin != null && String(p.pin) === pin)
    if (!emp) {
      setSalError(true)
      setTimeout(() => { setSalError(false); setSalPin('') }, 750)
      toast.error('PIN incorrecto')
      setSalVerif(false)
      return
    }
    const nombre = `${emp.nombre} ${emp.apellido}`.trim()
    if (nombre !== salPersona.cajero_nombre) {
      setSalError(true)
      setTimeout(() => { setSalError(false); setSalPin('') }, 750)
      toast.error('PIN no corresponde a este empleado')
      setSalVerif(false)
      return
    }
    const ahora = new Date().toISOString()
    const horas = (new Date(ahora).getTime() - new Date(salPersona.hora_entrada).getTime()) / 3600000
    const { error } = await supabase.from('turnos_personal')
      .update({ hora_salida: ahora, horas_trabajadas: parseFloat(horas.toFixed(2)) })
      .eq('id', salPersona.id)
    if (error) { toast.error('Error al registrar salida'); setSalVerif(false); return }
    setSalPin('')
    setSalVerif(false)
    setSalOk(nombre)
    cargarPresentes()
    setTimeout(() => { setSalOk(null); setSalPersona(null) }, 2000)
  }

  useEffect(() => () => {
    if (progressRef.current) {
      ;(progressRef as any)._cancelLogin?.()
      clearInterval(progressRef.current)
    }
  }, [])

  async function loginConEmail(e: React.FormEvent) {
    if (loginAdmin) return
    e.preventDefault()
    setLoginAdmin(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        void logger.error('login', 'Email login falló', { error: error.message, email })
        toast.error('Credenciales incorrectas')
        return
      }
      if (data.user) {
        const { data: perfil, error: perfilError } = await supabase
          .from('usuarios').select('id, nombre, last_name, es_admin, es_cajero')
          .eq('id', data.user.id).single()
        if (perfilError || !perfil) {
          toast.error('Perfil no encontrado en el sistema')
          return
        }
        onLogin({ id: (perfil as any).id, nombre: (perfil as any).nombre, last_name: (perfil as any).last_name, rol: (perfil as any).es_admin ? 'admin' : 'cajero', turno: new Date().getHours() < 15 ? 'mañana' : 'tarde' })
      }
    } catch {
      toast.error('Error de conexión. Intenta de nuevo.')
    } finally {
      setLoginAdmin(false)
    }
  }

  // ─── Derivaciones ──────────────────────────────────────────────────────────
  const h          = hora.getHours()
  const turnoLabel = h < 6 ? 'Madrugada' : h < 12 ? 'Turno Mañana' : h < 15 ? 'Turno Mediodía' : h < 20 ? 'Turno Tarde' : 'Turno Noche'
  const horaStr    = hora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  const segsStr    = String(hora.getSeconds()).padStart(2, '0')
  const ampm       = h < 12 ? 'AM' : 'PM'
  const fechaStr   = hora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const fmtMXN     = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })

  const teclas = [['1','2','3'],['4','5','6'],['7','8','9'],['C','0','⌫']]
  const keySubs: Record<string, string> = { '2':'ABC','3':'DEF','4':'GHI','5':'JKL','6':'MNO','7':'PQRS','8':'TUV','9':'WXYZ' }

  // ─── Pantalla de bienvenida ─────────────────────────────────────────────────
  if (loginOk) {
    const color = ROL_COLORS[loginOk.rol] ?? '#F0A800'
    const label = ROL_LABELS[loginOk.rol] ?? loginOk.rol
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          @keyframes zoomIn {
            from { opacity: 0; transform: scale(0.8) }
            to   { opacity: 1; transform: scale(1) }
          }
          @keyframes checkPop {
            0%   { transform: scale(0) rotate(-20deg) }
            60%  { transform: scale(1.2) rotate(5deg) }
            100% { transform: scale(1) rotate(0deg) }
          }
          @keyframes fadeSlide {
            from { opacity: 0; transform: translateY(12px) }
            to   { opacity: 1; transform: translateY(0) }
          }
        `}</style>
        <div style={{
          height: '100vh', background: '#060606',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          {/* Glow de fondo con color del rol */}
          <div style={{
            position: 'absolute', width: 600, height: 600, borderRadius: '50%',
            background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
            filter: 'blur(20px)', pointerEvents: 'none',
          }} />

          <div style={{
            position: 'relative', textAlign: 'center',
            animation: 'zoomIn 0.45s cubic-bezier(.16,1,.3,1) forwards',
          }}>
            {/* Avatar grande */}
            <div style={{
              width: 140, height: 140, borderRadius: '50%', margin: '0 auto 28px',
              background: `${color}18`,
              border: `3px solid ${color}`,
              boxShadow: `0 0 48px ${color}50, 0 0 16px ${color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '4rem', fontWeight: 900, color,
            }}>
              {loginOk.nombre.charAt(0).toUpperCase()}
            </div>

            {/* Check */}
            <div style={{
              position: 'absolute', bottom: 'calc(100% - 160px)', right: 'calc(50% - 86px)',
              width: 38, height: 38, borderRadius: '50%',
              background: '#22c55e', border: '3px solid #060606',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem',
              animation: 'checkPop 0.4s cubic-bezier(.34,1.56,.64,1) 0.2s both',
            }}>✓</div>

            {/* Nombre */}
            <p style={{
              color: '#fff', fontWeight: 900, fontSize: '2.2rem',
              letterSpacing: '0.04em', lineHeight: 1, marginBottom: 8,
              animation: 'fadeSlide 0.4s ease 0.15s both',
            }}>
              {loginOk.nombre} {loginOk.apellido}
            </p>

            {/* Rol badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `${color}18`, border: `1px solid ${color}55`,
              borderRadius: 24, padding: '5px 16px', marginBottom: 32,
              animation: 'fadeSlide 0.4s ease 0.25s both',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
              <span style={{ color, fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {label}
              </span>
            </div>

            {/* Bienvenida */}
            <p style={{
              color: '#888', fontWeight: 600, fontSize: '1rem',
              marginBottom: 36, letterSpacing: '0.02em',
              animation: 'fadeSlide 0.4s ease 0.3s both',
            }}>
              ¡Bienvenido! Cargando el sistema…
            </p>

            {/* Barra de progreso */}
            <div style={{
              width: 280, height: 4, background: 'rgba(255,255,255,0.07)',
              borderRadius: 4, overflow: 'hidden', margin: '0 auto',
              animation: 'fadeSlide 0.4s ease 0.35s both',
            }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: `linear-gradient(90deg, ${color}99, ${color})`,
                width: `${loginProgress}%`,
                transition: 'width 0.04s linear',
                boxShadow: `0 0 10px ${color}80`,
              }} />
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes shake {
          0%,100% { transform:translateX(0) } 20%,60% { transform:translateX(-9px) } 40%,80% { transform:translateX(9px) }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:translateY(0) }
        }
        @keyframes spinGear {
          from { transform:rotate(0deg) } to { transform:rotate(360deg) }
        }
        @keyframes dotPop {
          0% { transform:scale(0.75) } 55% { transform:scale(1.25) } 100% { transform:scale(1.1) }
        }
        @keyframes breathe {
          0%,100% { opacity:0.55 } 50% { opacity:1 }
        }
        @keyframes pulseGlow {
          0%,100% { box-shadow:0 0 18px rgba(240,168,0,0.35) }
          50%      { box-shadow:0 0 36px rgba(240,168,0,0.65) }
        }
        @keyframes badgePulse {
          0%,100% { transform:scale(1); box-shadow:0 0 0 0 rgba(239,68,68,0.5) }
          50%      { transform:scale(1.05); box-shadow:0 0 0 6px rgba(239,68,68,0) }
        }
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) }
        }

        .pos-login { height:100vh; display:flex; overflow:hidden; background:#050505; font-family:'Inter',system-ui,sans-serif; }

        /* LEFT */
        .lp { width:360px; flex-shrink:0; position:relative; overflow:hidden;
          background:linear-gradient(170deg,#111008 0%,#0b0900 50%,#050401 100%);
          border-right:1px solid rgba(240,168,0,0.18); display:flex; flex-direction:column; }
        @media(max-width:860px){ .lp { display:none; } }
        .lp-bar { position:absolute; top:0; left:0; right:0; height:4px; z-index:2;
          background:linear-gradient(90deg,transparent 0%,#c47f00 15%,#F0A800 35%,#ffd966 50%,#F0A800 65%,#c47f00 85%,transparent 100%);
          animation:breathe 3s ease-in-out infinite; }
        .lp-grid { position:absolute; inset:0; pointer-events:none;
          background-image:linear-gradient(rgba(240,168,0,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(240,168,0,0.025) 1px,transparent 1px);
          background-size:44px 44px; }
        .lp-glow { position:absolute; pointer-events:none; width:420px; height:420px; border-radius:50%;
          background:radial-gradient(circle,rgba(240,168,0,0.11) 0%,transparent 68%);
          top:42%; left:50%; transform:translate(-50%,-50%); animation:breathe 5s ease-in-out infinite; }
        .lp-inner { position:relative; z-index:1; display:flex; flex-direction:column;
          align-items:center; justify-content:space-between; height:100%; padding:36px 28px 30px; gap:0; }

        /* Logo */
        .logo-ring { position:relative; width:154px; height:154px; display:flex; align-items:center; justify-content:center; }
        .logo-ring::before { content:''; position:absolute; inset:-10px; border-radius:50%;
          border:1.5px solid rgba(240,168,0,0.3); animation:pulseGlow 4s ease-in-out infinite; }
        .logo-ring::after { content:''; position:absolute; inset:-22px; border-radius:50%;
          border:1px solid rgba(240,168,0,0.1); }
        .logo-img { width:138px; height:138px; object-fit:contain;
          filter:drop-shadow(0 0 28px rgba(240,168,0,0.6)) drop-shadow(0 0 8px rgba(240,168,0,0.3));
          position:relative; z-index:1; }
        .brand-block { text-align:center; margin-top:14px; }
        .brand-l1 { font-size:0.7rem; font-weight:700; letter-spacing:0.3em; text-transform:uppercase; color:rgba(255,255,255,0.6); margin-bottom:4px; }
        .brand-l2 { font-size:1.4rem; font-weight:900; letter-spacing:0.15em; text-transform:uppercase; color:#F0A800; line-height:1; }
        .brand-sep { height:2px; width:56px; margin:10px auto 0; background:linear-gradient(90deg,transparent,#F0A800 40%,#F0A800 60%,transparent); }

        /* Stats ventas */
        .stats-box { width:100%; background:rgba(0,0,0,0.45); border:1px solid rgba(240,168,0,0.15); border-radius:12px; padding:14px 16px; }
        .stats-label { font-size:0.6rem; font-weight:800; letter-spacing:0.2em; text-transform:uppercase; color:#888; margin-bottom:8px; }
        .stats-row { display:flex; gap:0; }
        .stats-item { flex:1; text-align:center; }
        .stats-item + .stats-item { border-left:1px solid rgba(255,255,255,0.07); }
        .stats-num { font-size:1.5rem; font-weight:900; color:#F0A800; line-height:1; }
        .stats-sub { font-size:0.62rem; font-weight:700; color:#777; text-transform:uppercase; letter-spacing:0.1em; margin-top:2px; }

        /* Clock */
        .clock-box { width:100%; background:rgba(0,0,0,0.5); border:1px solid rgba(240,168,0,0.2); border-radius:14px; padding:18px 20px; text-align:center; }
        .clock-main { display:flex; align-items:flex-start; justify-content:center; gap:1px; margin-bottom:4px; }
        .clock-hm { font-size:3.4rem; font-weight:900; line-height:1; color:#F0A800; letter-spacing:0.03em; font-variant-numeric:tabular-nums; }
        .clock-sec { font-size:1.3rem; font-weight:700; color:rgba(240,168,0,0.55); margin-top:9px; }
        .clock-ampm { font-size:0.75rem; font-weight:800; letter-spacing:0.12em; text-transform:uppercase; color:rgba(240,168,0,0.7); margin-bottom:3px; }
        .clock-date { font-size:0.74rem; font-weight:600; color:#aaa; text-transform:capitalize; letter-spacing:0.02em; }

        /* Último acceso */
        .last-box { width:100%; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:10px 14px;
          display:flex; align-items:center; gap:10px; }
        .last-icon { font-size:1.1rem; flex-shrink:0; }
        .last-name { font-size:0.78rem; font-weight:700; color:#ddd; }
        .last-time { font-size:0.65rem; font-weight:600; color:#888; }

        /* Mensaje del día */
        .msg-box { width:100%; background:rgba(240,168,0,0.06); border:1px solid rgba(240,168,0,0.2); border-radius:10px;
          padding:10px 14px; display:flex; align-items:flex-start; gap:8px; animation:slideDown 0.3s ease; }
        .msg-icon { font-size:1rem; flex-shrink:0; margin-top:1px; }
        .msg-text { font-size:0.75rem; font-weight:600; color:#e0c46c; line-height:1.4; }

        /* Turno + footer */
        .turno-badge { display:inline-flex; align-items:center; gap:8px; background:rgba(240,168,0,0.1);
          border:1px solid rgba(240,168,0,0.3); border-radius:24px; padding:5px 14px;
          font-size:0.7rem; font-weight:800; letter-spacing:0.12em; text-transform:uppercase; color:#F0A800; }
        .turno-dot { width:7px; height:7px; border-radius:50%; background:#F0A800; box-shadow:0 0 8px rgba(240,168,0,0.9); animation:breathe 2s ease-in-out infinite; }

        .footer-row { display:flex; align-items:center; justify-content:center; gap:12px; width:100%; }
        .footer-pill { display:flex; align-items:center; gap:5px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.07); border-radius:20px; padding:4px 10px; }
        .footer-pill-text { font-size:0.62rem; font-weight:600; letter-spacing:0.05em; color:#888; }

        /* RIGHT */
        .rp { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
          padding:28px 20px; position:relative; overflow:hidden; background:#080808; }
        .rp-glow { position:absolute; inset:0; pointer-events:none;
          background:radial-gradient(ellipse 55% 45% at 85% 85%,rgba(240,168,0,0.055) 0%,transparent 70%),
                     radial-gradient(ellipse 45% 35% at 15% 15%,rgba(240,168,0,0.03) 0%,transparent 70%); }

        /* Badge órdenes pendientes */
        .ordenes-badge { position:absolute; top:20px; right:20px; z-index:10;
          display:flex; align-items:center; gap:7px;
          background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35);
          border-radius:20px; padding:7px 14px;
          animation:badgePulse 2s ease-in-out infinite; }
        .ordenes-dot { width:8px; height:8px; border-radius:50%; background:#ef4444; box-shadow:0 0 8px rgba(239,68,68,0.9); animation:breathe 1.5s ease-in-out infinite; }
        .ordenes-text { font-size:0.72rem; font-weight:800; color:#ef4444; letter-spacing:0.05em; }

        /* Mobile logo */
        .mob-logo { display:none; flex-direction:column; align-items:center; gap:8px; margin-bottom:8px; }
        @media(max-width:860px){ .mob-logo { display:flex; } }

        /* PIN card */
        .pin-card { position:relative; z-index:1; width:100%; max-width:370px;
          background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:22px;
          padding:36px 32px 28px; display:flex; flex-direction:column; align-items:center; gap:24px;
          animation:fadeUp 0.5s cubic-bezier(.16,1,.3,1) forwards;
          box-shadow:0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05); }

        .pin-heading { font-size:1.5rem; font-weight:900; color:#fff; text-transform:uppercase; letter-spacing:0.08em; text-align:center; }
        .pin-subhead { font-size:0.8rem; font-weight:500; color:#aaa; text-align:center; margin-top:5px; }

        .dots-row { display:flex; gap:20px; }
        .dot { width:20px; height:20px; border-radius:50%; border:2px solid rgba(255,255,255,0.15); background:transparent; transition:all 0.16s cubic-bezier(.34,1.56,.64,1); }
        .dot.on { border-color:#F0A800; background:#F0A800; box-shadow:0 0 16px rgba(240,168,0,0.85),0 0 5px rgba(240,168,0,0.6); animation:dotPop 0.2s ease-out forwards; }
        .dot.err { border-color:#ef4444; background:#ef4444; box-shadow:0 0 16px rgba(239,68,68,0.85); }
        .dots-row.shake { animation:shake 0.45s ease-in-out; }

        .keypad { display:grid; grid-template-columns:repeat(3, 86px); gap:9px; }
        .key { width:86px; height:86px; border-radius:16px; font-size:1.6rem; font-weight:900; color:#fff;
          cursor:pointer; user-select:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
          position:relative; overflow:hidden; border:1px solid rgba(255,255,255,0.09); background:rgba(255,255,255,0.05);
          transition:transform 0.08s, background 0.11s, border-color 0.11s, box-shadow 0.11s;
          -webkit-tap-highlight-color:transparent; }
        .key::after { content:''; position:absolute; top:0; left:10%; right:10%; height:1px; background:rgba(255,255,255,0.12); pointer-events:none; }
        .key:hover { background:rgba(240,168,0,0.11); border-color:rgba(240,168,0,0.45); box-shadow:0 0 22px rgba(240,168,0,0.12), inset 0 1px 0 rgba(240,168,0,0.15); }
        .key:active { transform:scale(0.88); background:rgba(240,168,0,0.22); border-color:rgba(240,168,0,0.7); box-shadow:0 0 30px rgba(240,168,0,0.22); }
        .key-sub { font-size:0.42rem; font-weight:700; letter-spacing:0.18em; color:rgba(255,255,255,0.28); text-transform:uppercase; line-height:1; }
        .key.kd { color:#ff7070; background:rgba(239,68,68,0.07); border-color:rgba(239,68,68,0.15); font-size:1.3rem; }
        .key.kd:hover { background:rgba(239,68,68,0.16); border-color:rgba(239,68,68,0.45); }
        .key.kc { color:#bbb; font-size:0.82rem; font-weight:700; letter-spacing:0.04em; background:rgba(255,255,255,0.03); border-color:rgba(255,255,255,0.06); }
        .key.kc:hover { color:#fff; background:rgba(255,255,255,0.08); }

        .verifying-box { display:flex; flex-direction:column; align-items:center; gap:14px; padding:14px 0; }
        .gear-anim { animation:spinGear 1.4s linear infinite; font-size:2.5rem; }
        .verifying-label { font-size:0.78rem; font-weight:800; letter-spacing:0.22em; text-transform:uppercase; color:#aaa; }

        .field { width:100%; padding:0.75rem 1rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
          border-radius:12px; color:#fff; font-size:0.92rem; font-weight:600; outline:none; font-family:inherit;
          transition:border-color 0.15s, box-shadow 0.15s; }
        .field::placeholder { color:#777; }
        .field:focus { border-color:rgba(240,168,0,0.5); box-shadow:0 0 0 3px rgba(240,168,0,0.08); }
        .btn-gold { width:100%; padding:0.88rem; background:linear-gradient(135deg,#F0A800 0%,#d49210 100%);
          color:#000; border:none; border-radius:12px; font-weight:900; font-size:0.92rem;
          letter-spacing:0.12em; text-transform:uppercase; cursor:pointer; font-family:inherit;
          box-shadow:0 4px 24px rgba(240,168,0,0.3); transition:opacity 0.15s, transform 0.1s, box-shadow 0.15s; }
        .btn-gold:hover:not(:disabled) { opacity:0.92; box-shadow:0 6px 32px rgba(240,168,0,0.42); }
        .btn-gold:active:not(:disabled) { transform:scale(0.98); }
        .btn-gold:disabled { opacity:0.4; cursor:not-allowed; }

        .div-row { display:flex; align-items:center; gap:10px; width:100%; }
        .div-line { flex:1; height:1px; background:rgba(255,255,255,0.08); }
        .adm-btn { background:none; border:none; cursor:pointer; padding:2px 0; font-size:0.7rem; font-weight:700;
          letter-spacing:0.12em; text-transform:uppercase; color:#777; transition:color 0.15s; font-family:inherit; white-space:nowrap; }
        .adm-btn:hover { color:#aaa; }
        .adm-btn.open { color:#F0A800; }

        .sec-tag { display:flex; align-items:center; gap:6px; font-size:0.64rem; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#666; }
        .sec-dot { width:5px; height:5px; border-radius:50%; background:#555; flex-shrink:0; }
        .activate-icon { width:64px; height:64px; border-radius:18px; background:rgba(240,168,0,0.08); border:1px solid rgba(240,168,0,0.25); display:flex; align-items:center; justify-content:center; font-size:28px; }
      `}</style>

      <div className="pos-login">

        {/* ══════════ PANEL IZQUIERDO ══════════ */}
        <div className="lp">
          <div className="lp-bar" />
          <div className="lp-grid" />
          <div className="lp-glow" />

          <div className="lp-inner">

            {/* Logo */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
              <div className="logo-ring">
                <img src="./logo.png" alt="El Café del Constructor" className="logo-img" />
              </div>
              <div className="brand-block">
                <p className="brand-l1">El Café del</p>
                <p className="brand-l2">Constructor</p>
                <div className="brand-sep" />
              </div>
            </div>

            {/* Ventas del día */}
            <div className="stats-box">
              <p className="stats-label">📊 Ventas de hoy</p>
              <div className="stats-row">
                <div className="stats-item">
                  <p className="stats-num">{fmtMXN(ventasDia.total)}</p>
                  <p className="stats-sub">Recaudado</p>
                </div>
                <div className="stats-item">
                  <p className="stats-num">{ventasDia.count}</p>
                  <p className="stats-sub">Ventas</p>
                </div>
              </div>
            </div>

            {/* Reloj */}
            <div className="clock-box">
              <div className="clock-main">
                <span className="clock-hm">{horaStr}</span>
                <span className="clock-sec">:{segsStr}</span>
              </div>
              <p className="clock-ampm">{ampm}</p>
              <p className="clock-date">{fechaStr}</p>
            </div>

            {/* Último acceso */}
            {ultimoAcceso && (
              <div className="last-box">
                <span className="last-icon">👤</span>
                <div>
                  <p className="last-name">{ultimoAcceso.nombre}</p>
                  <p className="last-time">Último acceso · {ultimoAcceso.tiempo}</p>
                </div>
              </div>
            )}

            {/* Mensaje del día */}
            {mensajeDelDia && (
              <div className="msg-box">
                <span className="msg-icon">💬</span>
                <p className="msg-text">{mensajeDelDia}</p>
              </div>
            )}

            {/* Turno + clima + sistema */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, width:'100%' }}>
              <div className="turno-badge">
                <div className="turno-dot" />
                {turnoLabel}
              </div>

              <div className="footer-row">
                {/* Clima */}
                {clima && (
                  <div className="footer-pill">
                    <span style={{ fontSize:'0.9rem' }}>{clima.icon}</span>
                    <span className="footer-pill-text">{clima.temp}°C · {clima.desc}</span>
                  </div>
                )}
                {/* Sistema */}
                <div className="footer-pill">
                  <div style={{ width:6, height:6, borderRadius:'50%', background: sistemaOk ? (navigator.onLine ? '#22c55e' : '#F0A800') : '#ef4444', boxShadow:`0 0 6px ${sistemaOk ? (navigator.onLine ? '#22c55e' : '#F0A800') : '#ef4444'}` }} />
                  <span className="footer-pill-text">{sistemaOk ? (navigator.onLine ? 'En línea' : 'Modo offline') : 'Sin conexión'}</span>
                </div>
              </div>

              <p style={{ fontSize:'0.62rem', fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'#555', textAlign:'center' }}>
                Sistema POS · El Café del Constructor
              </p>
            </div>

          </div>
        </div>

        {/* ══════════ PANEL DERECHO ══════════ */}
        <div className="rp">
          <div className="rp-glow" />

          {/* Badge órdenes pendientes */}
          {ordenesPend > 0 && (
            <div className="ordenes-badge">
              <div className="ordenes-dot" />
              <span className="ordenes-text">
                {ordenesPend} orden{ordenesPend > 1 ? 'es' : ''} pendiente{ordenesPend > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Logo móvil */}
          <div className="mob-logo">
            <img src="./logo.png" alt="Logo" style={{ width:72, height:72, objectFit:'contain', filter:'drop-shadow(0 0 18px rgba(240,168,0,0.55))' }} />
            <p style={{ color:'#F0A800', fontWeight:900, fontSize:'0.88rem', textTransform:'uppercase', letterSpacing:'0.2em' }}>
              El Café del Constructor
            </p>
          </div>

          {/* ── Sin sesión ── */}
          {!sesionActiva ? (
            <div className="pin-card" style={{ gap:20 }}>
              <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                <div className="activate-icon">⚙️</div>
                <p style={{ fontSize:'1.3rem', fontWeight:900, color:'#fff', textTransform:'uppercase', letterSpacing:'0.1em' }}>Activar POS</p>
                <p style={{ fontSize:'0.82rem', fontWeight:500, color:'#aaa', textAlign:'center', lineHeight:1.5 }}>
                  Inicia sesión con tu cuenta de administrador para habilitar el sistema
                </p>
              </div>
              <form onSubmit={loginConEmail} style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
                <input type="email" inputMode="email" enterKeyHint="next" placeholder="Correo de administrador" value={email}
                  onChange={e => setEmail(e.target.value)} className="field" required />
                <input type="password" inputMode="text" enterKeyHint="done" placeholder="Contraseña" value={password}
                  onChange={e => setPassword(e.target.value)} className="field" required />
                <button type="submit" disabled={loginAdmin} className="btn-gold" style={{ marginTop:4 }}>
                  {loginAdmin ? 'Activando…' : 'Activar POS'}
                </button>
              </form>
            </div>

          ) : (
            /* ── PIN Pad ── */
            <div className="pin-card">
              <div style={{ textAlign:'center', width:'100%' }}>
                <p className="pin-heading">{verificando ? 'Verificando…' : 'Ingresa tu PIN'}</p>
                <p className="pin-subhead">{verificando ? 'Autenticando acceso al sistema…' : 'Introduce tu código de 4 dígitos'}</p>
              </div>

              <div className={`dots-row${pinError ? ' shake' : ''}`}>
                {[0,1,2,3].map(i => (
                  <div key={i} className={`dot ${pin.length > i ? (pinError ? 'err' : 'on') : ''}`} />
                ))}
              </div>

              {verificando ? (
                <div className="verifying-box">
                  <span className="gear-anim">⚙️</span>
                  <p className="verifying-label">Verificando acceso…</p>
                </div>
              ) : (
                <div className="keypad">
                  {teclas.map((fila, fi) =>
                    fila.map((t, ti) => (
                      <button
                        key={`${fi}-${ti}`}
                        className={`key ${t === '⌫' ? 'kd' : ''} ${t === 'C' ? 'kc' : ''}`}
                        onClick={() => presionarTecla(t)}
                      >
                        {t}
                        {keySubs[t] && <span className="key-sub">{keySubs[t]}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}

              <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:12 }}>
                <div className="div-row">
                  <div className="div-line" />
                  <button className={`adm-btn${mostrarAdmin ? ' open' : ''}`} onClick={() => setMostrarAdmin(v => !v)}>
                    {mostrarAdmin ? '▲ Ocultar' : '⚙ Acceso Administrador'}
                  </button>
                  <div className="div-line" />
                </div>
                {mostrarAdmin && (
                  <form onSubmit={loginConEmail} style={{ display:'flex', flexDirection:'column', gap:9 }}>
                    <input type="email" inputMode="email" enterKeyHint="next" placeholder="Correo de administrador" value={email}
                      onChange={e => setEmail(e.target.value)} className="field" required />
                    <input type="password" inputMode="text" enterKeyHint="done" placeholder="Contraseña" value={password}
                      onChange={e => setPassword(e.target.value)} className="field" required />
                    <button type="submit" disabled={loginAdmin} className="btn-gold">
                      {loginAdmin ? 'Entrando…' : 'Entrar como Admin'}
                    </button>
                  </form>
                )}
              </div>

              <div className="sec-tag">
                <div className="sec-dot" />
                Acceso seguro · Solo personal autorizado
                <div className="sec-dot" />
              </div>
            </div>
          )}

          {/* Botón de asistencia */}
          {sesionActiva && (
            <button
              onClick={abrirAsistencia}
              style={{
                position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)',
                display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap',
                background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)',
                borderRadius:20, padding:'9px 20px', cursor:'pointer', color:'#888',
                fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
                fontFamily:'inherit', transition:'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color='#fff'; (e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.25)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color='#888'; (e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,0.1)' }}
            >
              <span style={{ fontSize:'1rem' }}>⏱</span> Marcar Entrada / Salida
            </button>
          )}
        </div>

        {/* ══════════ MODAL ASISTENCIA ══════════ */}
        {showAsistencia && (
          <div style={{
            position:'fixed', inset:0, zIndex:200,
            background:'rgba(0,0,0,0.88)', backdropFilter:'blur(8px)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:"'Inter', system-ui, sans-serif",
          }}>
            <div style={{
              width:'min(880px, 96vw)', height:'min(580px, 92vh)',
              background:'#0d0d0d', border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:24, display:'flex', overflow:'hidden', position:'relative',
              boxShadow:'0 40px 100px rgba(0,0,0,0.8)',
            }}>
              {/* Cerrar */}
              <button onClick={cerrarAsistencia} style={{
                position:'absolute', top:14, right:14, zIndex:10,
                width:34, height:34, borderRadius:'50%',
                background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
                color:'#aaa', fontSize:'1rem', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit',
              }}>✕</button>

              {/* ── IZQUIERDA: PIN DE ENTRADA o SALIDA ── */}
              <div style={{
                width:320, flexShrink:0,
                borderRight:'1px solid rgba(255,255,255,0.07)',
                padding:'32px 28px', display:'flex', flexDirection:'column',
                alignItems:'center', gap:20,
                background: salPersona ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)',
              }}>
                {/* Confirmación entrada */}
                {entOk && !salPersona && (
                  <div style={{
                    position:'absolute', left:0, top:0, width:320, height:'100%',
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    gap:12, background:'#0d0d0d', borderRadius:'24px 0 0 24px', zIndex:5,
                  }}>
                    <div style={{ fontSize:'3rem' }}>✅</div>
                    <p style={{ color:'#22c55e', fontWeight:900, fontSize:'1.2rem', textAlign:'center' }}>¡Entrada registrada!</p>
                    <p style={{ color:'#aaa', fontSize:'0.9rem', fontWeight:600 }}>{entOk}</p>
                  </div>
                )}

                {/* Confirmación salida */}
                {salOk && (
                  <div style={{
                    position:'absolute', left:0, top:0, width:320, height:'100%',
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    gap:12, background:'#0d0d0d', borderRadius:'24px 0 0 24px', zIndex:5,
                  }}>
                    <div style={{ fontSize:'3rem' }}>👋</div>
                    <p style={{ color:'#F0A800', fontWeight:900, fontSize:'1.2rem', textAlign:'center' }}>¡Hasta luego!</p>
                    <p style={{ color:'#aaa', fontSize:'0.9rem', fontWeight:600 }}>{salOk}</p>
                  </div>
                )}

                {/* Título */}
                <div style={{ textAlign:'center' }}>
                  {salPersona ? (
                    <>
                      <p style={{ color:'#ef4444', fontWeight:900, fontSize:'1rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>Marcar Salida</p>
                      <p style={{ color:'#fff', fontWeight:800, fontSize:'1.15rem', marginTop:4 }}>{salPersona.cajero_nombre.split(' ')[0]}</p>
                      <p style={{ color:'#666', fontSize:'0.72rem', marginTop:2 }}>Ingresa tu PIN para confirmar</p>
                    </>
                  ) : (
                    <>
                      <p style={{ color:'#22c55e', fontWeight:900, fontSize:'1rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>Marcar Entrada</p>
                      <p style={{ color:'#888', fontSize:'0.72rem', marginTop:4 }}>Ingresa tu PIN de 4 dígitos</p>
                    </>
                  )}
                </div>

                {/* Dots */}
                {salPersona ? (
                  <div style={{ display:'flex', gap:16 }}>
                    {[0,1,2,3].map(i => (
                      <div key={i} style={{
                        width:16, height:16, borderRadius:'50%',
                        border: `2px solid ${salError ? '#ef4444' : salPin.length > i ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                        background: salPin.length > i ? (salError ? '#ef4444' : '#ef4444') : 'transparent',
                        boxShadow: salPin.length > i && !salError ? '0 0 12px rgba(239,68,68,0.8)' : 'none',
                        transition:'all 0.15s',
                      }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ display:'flex', gap:16 }}>
                    {[0,1,2,3].map(i => (
                      <div key={i} style={{
                        width:16, height:16, borderRadius:'50%',
                        border: `2px solid ${entError ? '#ef4444' : entPin.length > i ? '#22c55e' : 'rgba(255,255,255,0.15)'}`,
                        background: entPin.length > i ? (entError ? '#ef4444' : '#22c55e') : 'transparent',
                        boxShadow: entPin.length > i && !entError ? '0 0 12px rgba(34,197,94,0.8)' : 'none',
                        transition:'all 0.15s',
                      }} />
                    ))}
                  </div>
                )}

                {/* Keypad mini */}
                {(salVerif || entVerif) ? (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, padding:'10px 0' }}>
                    <span style={{ fontSize:'2rem', animation:'spinGear 1.4s linear infinite', display:'inline-block' }}>⚙️</span>
                    <p style={{ fontSize:'0.72rem', fontWeight:800, letterSpacing:'0.2em', textTransform:'uppercase', color:'#888' }}>Verificando…</p>
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 72px)', gap:8 }}>
                    {teclas.map((fila, fi) => fila.map((t, ti) => {
                      const accent = salPersona ? '#ef4444' : '#22c55e'
                      return (
                        <button
                          key={`m-${fi}-${ti}`}
                          onClick={() => salPersona ? presionarSalida(t) : presionarEntrada(t)}
                          style={{
                            width:72, height:72, borderRadius:14,
                            fontSize: t === 'C' ? '0.75rem' : t === '⌫' ? '1.2rem' : '1.5rem',
                            fontWeight:900, color: t === '⌫' ? '#ff7070' : t === 'C' ? '#bbb' : '#fff',
                            background: t === '⌫' ? 'rgba(239,68,68,0.07)' : t === 'C' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${t === '⌫' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.09)'}`,
                            cursor:'pointer', fontFamily:'inherit',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            transition:'all 0.1s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}22`; (e.currentTarget as HTMLButtonElement).style.borderColor = `${accent}60` }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = t === '⌫' ? 'rgba(239,68,68,0.07)' : t === 'C' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = t === '⌫' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.09)' }}
                        >
                          {t}
                        </button>
                      )
                    }))}
                  </div>
                )}

                {/* Cancelar salida */}
                {salPersona && !salVerif && !salOk && (
                  <button onClick={() => { setSalPersona(null); setSalPin(''); setSalError(false) }} style={{
                    background:'none', border:'none', cursor:'pointer', color:'#666',
                    fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
                    fontFamily:'inherit', textDecoration:'underline',
                  }}>
                    Cancelar
                  </button>
                )}
              </div>

              {/* ── DERECHA: LISTA DE PRESENTES ── */}
              <div style={{ flex:1, padding:'32px 28px', display:'flex', flexDirection:'column', gap:16, overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <p style={{ color:'#fff', fontWeight:900, fontSize:'1rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>En turno ahora</p>
                    <p style={{ color:'#666', fontSize:'0.72rem', marginTop:2 }}>{presentes.length === 0 ? 'Nadie ha marcado entrada hoy' : `${presentes.length} persona${presentes.length !== 1 ? 's' : ''} presente${presentes.length !== 1 ? 's' : ''}`}</p>
                  </div>
                  <button onClick={cargarPresentes} style={{
                    background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)',
                    borderRadius:8, padding:'5px 10px', color:'#777', fontSize:'0.7rem',
                    cursor:'pointer', fontFamily:'inherit', fontWeight:700,
                  }}>↻ Actualizar</button>
                </div>

                <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
                  {presentes.length === 0 ? (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, gap:10 }}>
                      <span style={{ fontSize:'2.5rem', opacity:0.3 }}>🏃</span>
                      <p style={{ color:'#555', fontSize:'0.82rem', fontWeight:600 }}>Aún no hay nadie</p>
                    </div>
                  ) : (
                    presentes.map(p => {
                      const horaEnt = new Date(p.hora_entrada).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })
                      const inicial = p.cajero_nombre.charAt(0).toUpperCase()
                      const esSalida = salPersona?.id === p.id
                      return (
                        <div key={p.id} style={{
                          display:'flex', alignItems:'center', gap:12,
                          background: esSalida ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${esSalida ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
                          borderRadius:12, padding:'10px 14px',
                          transition:'all 0.2s',
                        }}>
                          {/* Avatar */}
                          <div style={{
                            width:38, height:38, borderRadius:'50%', flexShrink:0,
                            background:'rgba(34,197,94,0.15)', border:'2px solid rgba(34,197,94,0.4)',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            color:'#22c55e', fontWeight:900, fontSize:'1rem',
                          }}>{inicial}</div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ color:'#fff', fontWeight:700, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.cajero_nombre}</p>
                            <p style={{ color:'#666', fontSize:'0.68rem', marginTop:2 }}>Entrada: {horaEnt}</p>
                          </div>
                          {/* Dot verde */}
                          <div style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 8px rgba(34,197,94,0.8)', flexShrink:0 }} />
                          {/* Botón salida */}
                          <button
                            onClick={() => { setSalPersona(p); setSalPin(''); setSalError(false) }}
                            style={{
                              background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
                              borderRadius:8, padding:'5px 12px', color:'#ef4444',
                              fontSize:'0.68rem', fontWeight:800, letterSpacing:'0.08em',
                              textTransform:'uppercase', cursor:'pointer', fontFamily:'inherit',
                              flexShrink:0, whiteSpace:'nowrap',
                            }}
                          >
                            Marcar Salida
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
