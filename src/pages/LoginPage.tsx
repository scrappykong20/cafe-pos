import { useState } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password })
    if (error) {
      toast.error(error.message === 'Invalid login credentials'
        ? 'Correo o contraseña incorrectos'
        : 'Error al iniciar sesión')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--black)' }}>

      {/* Hazard stripes top/bottom */}
      <div className="hazard-stripe fixed top-0 left-0 right-0 h-2" />
      <div className="hazard-stripe fixed bottom-0 left-0 right-0 h-2" />

      {/* Background gear decoration */}
      <div className="absolute right-[-60px] top-[-60px] text-[200px] opacity-[0.03] select-none animate-gear pointer-events-none">
        ⚙️
      </div>
      <div className="absolute left-[-80px] bottom-[-80px] text-[250px] opacity-[0.03] select-none animate-gear pointer-events-none" style={{ animationDirection: 'reverse' }}>
        ⚙️
      </div>

      <div className="w-full max-w-xs relative z-10 animate-fade-up">

        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="./logo.png"
            alt="El Café del Constructor"
            className="mx-auto mb-4"
            style={{ width: 110, height: 110, objectFit: 'contain' }}
          />
          <h1 className="font-black text-xl uppercase tracking-tight" style={{ color: 'var(--text)' }}>
            El Café del
          </h1>
          <h2 className="font-black text-xl uppercase tracking-tight" style={{ color: 'var(--yellow)' }}>
            Constructor
          </h2>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
            <p className="text-xs font-black uppercase tracking-widest px-2" style={{ color: 'var(--muted)' }}>
              Sistema POS
            </p>
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--charcoal)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--yellow)',
        }}>
          {/* Header */}
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--dark)' }}>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--yellow)' }}>
              // Acceso de operador
            </p>
          </div>

          <form onSubmit={handleLogin} className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
                Correo
              </label>
              <input
                type="email"
                value={correo}
                onChange={e => setCorreo(e.target.value)}
                placeholder="cajero@cafeteria.com"
                required
                autoComplete="email"
                className="pos-input"
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pos-input"
                  style={{ paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-base transition-colors"
                  style={{ color: 'var(--muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--yellow)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-yellow mt-2"
            >
              {loading ? '⚙️ Entrando...' : 'Entrar al POS →'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs font-bold uppercase tracking-widest mt-5" style={{ color: 'var(--muted)' }}>
          Solo cajeros y administradores
        </p>
      </div>
    </div>
  )
}
