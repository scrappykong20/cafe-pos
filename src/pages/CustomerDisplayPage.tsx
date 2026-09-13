import { useEffect, useRef, useState } from 'react'

type DisplayMessage =
  | {
      type: 'cart_update'
      items: { nombre: string; emoji: string; precio: number; cantidad: number }[]
      total: number
      mesa: string
    }
  | { type: 'checkout'; total: number; cambio: number; metodoPago: string }
  | { type: 'idle' }

type DisplayState = 'idle' | 'cart' | 'checkout'

interface CartData {
  items: { nombre: string; emoji: string; precio: number; cantidad: number }[]
  total: number
  mesa: string
}

interface CheckoutData {
  total: number
  cambio: number
  metodoPago: string
}

const FRASES = [
  '☕ El mejor café de la ciudad',
  '⚙️ Acumula engranajes con cada compra',
  '🎁 Canjea tus puntos por productos gratis',
  '👷 Somos El Café del Constructor',
  '💳 Pagos con tarjeta sin comisión',
]

// ── CSS inyectado una sola vez ──────────────────────────────────────────────
const STYLES = `
@keyframes bgShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes gearSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes pulseScale {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.04); }
}
@keyframes countUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(30px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cd-bg-idle {
  background: linear-gradient(135deg, #1a1008, #0d0d0d, #1a1008, #241500);
  background-size: 400% 400%;
  animation: bgShift 12s ease infinite;
}
.cd-gear-spin {
  display: inline-block;
  animation: gearSpin 8s linear infinite;
}
.cd-frase-enter {
  animation: fadeSlideIn 0.6s ease both;
}
.cd-item-enter {
  animation: fadeSlideIn 0.4s ease both;
}
.cd-checkout-enter {
  animation: slideUp 0.5s ease both;
}
.cd-pulse {
  animation: pulseScale 2s ease-in-out infinite;
}
.cd-cambio-appear {
  animation: countUp 0.5s ease both;
}
`

function useStyleInjection() {
  useEffect(() => {
    const id = 'customer-display-styles'
    if (!document.getElementById(id)) {
      const tag = document.createElement('style')
      tag.id = id
      tag.textContent = STYLES
      document.head.appendChild(tag)
    }
  }, [])
}

// ── Animated counter hook ───────────────────────────────────────────────────
function useCountUp(target: number, duration = 1500, active = true): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    setValue(0)
    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.round(target * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration, active])

  return value
}

export default function CustomerDisplayPage() {
  useStyleInjection()

  const [state, setState] = useState<DisplayState>('idle')
  const [cartData, setCartData] = useState<CartData | null>(null)
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [visible, setVisible] = useState(true)

  // Idle carousel
  const [fraseIndex, setFraseIndex] = useState(0)
  const [fraseVisible, setFraseVisible] = useState(true)

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ── Carousel (idle only) ─────────────────────────────────────────────────
  useEffect(() => {
    if (state !== 'idle') return
    const interval = setInterval(() => {
      setFraseVisible(false)
      setTimeout(() => {
        setFraseIndex((i) => (i + 1) % FRASES.length)
        setFraseVisible(true)
      }, 400)
    }, 4000)
    return () => clearInterval(interval)
  }, [state])

  // ── BroadcastChannel listener — lógica preservada intacta ────────────────
  useEffect(() => {
    const channel = new BroadcastChannel('pos-customer-display')
    const timers: ReturnType<typeof setTimeout>[] = []

    channel.onmessage = (e) => {
      const msg = e.data as DisplayMessage

      setVisible(false)
      timers.push(setTimeout(() => {
        if (msg.type === 'cart_update') {
          setCartData({ items: msg.items, total: msg.total, mesa: msg.mesa })
          setCheckoutData(null)
          setState('cart')
        } else if (msg.type === 'checkout') {
          setCheckoutData({ total: msg.total, cambio: msg.cambio, metodoPago: msg.metodoPago })
          setState('checkout')
          timers.push(setTimeout(() => {
            setVisible(false)
            timers.push(setTimeout(() => {
              setState('idle')
              setCheckoutData(null)
              setVisible(true)
            }, 300))
          }, 8000))
        } else if (msg.type === 'idle') {
          setState('idle')
          setCartData(null)
          setCheckoutData(null)
        }
        setVisible(true)
      }, 250))
    }
    return () => { channel.close(); timers.forEach(clearTimeout) }
  }, [])

  // ── Formatters ────────────────────────────────────────────────────────────
  const fmt = (n: number) =>
    n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

  const fmtHora = (d: Date) =>
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const fmtMetodo = (m: string) => {
    if (m === 'efectivo') return '💵 Efectivo'
    if (m === 'tarjeta') return '💳 Tarjeta'
    if (m === 'mixto') return '🔀 Mixto'
    return m
  }

  const transitionStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(16px)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IDLE
  // ══════════════════════════════════════════════════════════════════════════
  if (state === 'idle') {
    return (
      <div
        className="cd-bg-idle"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          ...transitionStyle,
        }}
      >
        {/* Hazard stripe top */}
        <div
          className="hazard-stripe-sm h-1"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10 }}
        />

        {/* Clock — esquina superior derecha */}
        <div
          style={{
            position: 'fixed',
            top: '1.25rem',
            right: '1.75rem',
            color: '#F0A800',
            fontWeight: 900,
            fontSize: 'clamp(1.1rem, 2.5vw, 1.6rem)',
            letterSpacing: '0.12em',
            fontVariantNumeric: 'tabular-nums',
            zIndex: 20,
            textShadow: '0 0 18px rgba(240,168,0,0.5)',
          }}
        >
          {fmtHora(currentTime)}
        </div>

        {/* Centro */}
        <div style={{ textAlign: 'center', padding: '2rem', zIndex: 1 }}>
          {/* Gear girando */}
          <div
            className="cd-gear-spin"
            style={{ fontSize: '7rem', marginBottom: '1.5rem', lineHeight: 1 }}
          >
            ⚙️
          </div>

          {/* Nombre del café */}
          <h1
            style={{
              color: '#F0A800',
              fontWeight: 900,
              fontSize: 'clamp(2.5rem, 7vw, 5rem)',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              margin: '0 0 0.4rem',
              lineHeight: 1.1,
              textShadow: '0 0 40px rgba(240,168,0,0.35)',
            }}
          >
            El Café del Constructor
          </h1>

          {/* Subtítulo */}
          <p
            style={{
              color: 'rgba(255,255,255,0.45)',
              fontWeight: 900,
              fontSize: 'clamp(0.9rem, 2.2vw, 1.3rem)',
              letterSpacing: '0.45em',
              textTransform: 'uppercase',
              margin: '0 0 3.5rem',
            }}
          >
            Bienvenido
          </p>

          {/* Carrusel de frases */}
          <div
            style={{
              minHeight: '3.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {fraseVisible && (
              <p
                key={fraseIndex}
                className="cd-frase-enter"
                style={{
                  color: 'rgba(255,255,255,0.88)',
                  fontWeight: 700,
                  fontSize: 'clamp(1.3rem, 3.5vw, 2.2rem)',
                  letterSpacing: '0.05em',
                  margin: 0,
                  padding: '0.6rem 2rem',
                  background: 'rgba(240,168,0,0.1)',
                  border: '1px solid rgba(240,168,0,0.25)',
                  borderRadius: 8,
                  backdropFilter: 'blur(4px)',
                }}
              >
                {FRASES[fraseIndex]}
              </p>
            )}
          </div>

          {/* Dots del carrusel */}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            {FRASES.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === fraseIndex ? '1.5rem' : '0.5rem',
                  height: '0.5rem',
                  borderRadius: 100,
                  background: i === fraseIndex ? '#F0A800' : 'rgba(255,255,255,0.2)',
                  transition: 'all 0.4s ease',
                }}
              />
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(0,0,0,0.7)',
            borderTop: '2px solid #F0A800',
            padding: '1rem 2rem',
            textAlign: 'center',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            style={{
              color: '#F0A800',
              fontWeight: 900,
              fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
            }}
          >
            ⚙️ Acumula Engranajes con cada compra
          </span>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CART
  // ══════════════════════════════════════════════════════════════════════════
  if (state === 'cart' && cartData) {
    const engranajes = Math.floor(cartData.total / 10)

    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0d0d0d',
          display: 'flex',
          flexDirection: 'column',
          ...transitionStyle,
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#1a1a1a',
            borderBottom: '3px solid #F0A800',
            padding: '1rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.8rem' }}>⚙️</span>
            <span
              style={{
                color: '#F0A800',
                fontWeight: 900,
                fontSize: 'clamp(1rem, 2.5vw, 1.4rem)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                textShadow: '0 0 20px rgba(240,168,0,0.4)',
              }}
            >
              El Café del Constructor
            </span>
          </div>
          <div
            style={{
              background: '#F0A800',
              borderRadius: 6,
              padding: '0.4rem 1.1rem',
            }}
          >
            <span
              style={{
                color: '#0d0d0d',
                fontWeight: 900,
                fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Mesa: {cartData.mesa}
            </span>
          </div>
        </div>

        {/* Items */}
        <div style={{ flex: 1, padding: '1.5rem 2rem', overflowY: 'auto' }}>
          {cartData.items.map((item, i) => (
            <div
              key={`${item.nombre}-${item.cantidad}`}
              className="cd-item-enter"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '1.1rem 1rem',
                marginBottom: '0.75rem',
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderLeft: '4px solid #F0A800',
                borderRadius: 8,
                gap: '1.2rem',
                animationDelay: `${i * 0.06}s`,
              }}
            >
              {/* Emoji grande */}
              <span
                style={{
                  fontSize: 'clamp(2.2rem, 5vw, 3rem)',
                  width: '3.5rem',
                  textAlign: 'center',
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                {item.emoji}
              </span>

              {/* Nombre + precio unitario */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 'clamp(1.1rem, 2.8vw, 1.6rem)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.nombre}
                </div>
                <div
                  style={{
                    color: 'rgba(255,255,255,0.45)',
                    fontWeight: 700,
                    fontSize: 'clamp(0.85rem, 2vw, 1.05rem)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginTop: '0.2rem',
                  }}
                >
                  {fmt(item.precio)} × {item.cantidad}
                </div>
              </div>

              {/* Badge cantidad */}
              <div
                style={{
                  background: '#F0A800',
                  color: '#0d0d0d',
                  fontWeight: 900,
                  fontSize: 'clamp(1rem, 2.5vw, 1.3rem)',
                  borderRadius: '50%',
                  width: '2.8rem',
                  height: '2.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {item.cantidad}
              </div>

              {/* Subtotal */}
              <div
                style={{
                  color: '#F0A800',
                  fontWeight: 900,
                  fontSize: 'clamp(1.1rem, 3vw, 1.6rem)',
                  letterSpacing: '0.04em',
                  textAlign: 'right',
                  minWidth: '6rem',
                }}
              >
                {fmt(item.precio * item.cantidad)}
              </div>
            </div>
          ))}

          {/* Divider hazard */}
          <div
            style={{
              margin: '1.5rem 0 1.2rem',
              height: 3,
              background: `repeating-linear-gradient(90deg, #F0A800 0, #F0A800 14px, transparent 14px, transparent 24px)`,
              borderRadius: 2,
            }}
          />

          {/* TOTAL grande */}
          <div
            className="cd-pulse"
            style={{
              textAlign: 'right',
              background: '#1a1a1a',
              border: '2px solid #F0A800',
              borderRadius: 10,
              padding: '1.2rem 1.8rem',
            }}
          >
            <div
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontWeight: 900,
                fontSize: 'clamp(0.75rem, 2vw, 1rem)',
                letterSpacing: '0.35em',
                textTransform: 'uppercase',
                marginBottom: '0.3rem',
              }}
            >
              Total a pagar
            </div>
            <div
              style={{
                color: '#F0A800',
                fontWeight: 900,
                fontSize: 'clamp(2.5rem, 8vw, 5rem)',
                letterSpacing: '0.02em',
                lineHeight: 1,
                textShadow: '0 0 30px rgba(240,168,0,0.5)',
              }}
            >
              {fmt(cartData.total)}
            </div>
          </div>
        </div>

        {/* Engranajes bottom bar */}
        <div
          style={{
            background: '#111',
            borderTop: '3px solid #F0A800',
            padding: '1rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '2rem' }}>⚙️</span>
          <span
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontWeight: 900,
              fontSize: 'clamp(1rem, 2.5vw, 1.3rem)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Acumularás
          </span>
          <span
            style={{
              color: '#F0A800',
              fontWeight: 900,
              fontSize: 'clamp(1.4rem, 3.5vw, 2rem)',
              letterSpacing: '0.08em',
              textShadow: '0 0 20px rgba(240,168,0,0.6)',
            }}
          >
            {engranajes} engranajes
          </span>
          <span
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontWeight: 900,
              fontSize: 'clamp(1rem, 2.5vw, 1.3rem)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            con esta compra
          </span>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHECKOUT
  // ══════════════════════════════════════════════════════════════════════════
  if (state === 'checkout' && checkoutData) {
    return (
      <CheckoutScreen
        checkoutData={checkoutData}
        transitionStyle={transitionStyle}
        fmt={fmt}
        fmtMetodo={fmtMetodo}
      />
    )
  }

  return null
}

// ── Componente separado para poder usar hooks en checkout ──────────────────
function CheckoutScreen({
  checkoutData,
  transitionStyle,
  fmt,
  fmtMetodo,
}: {
  checkoutData: CheckoutData
  transitionStyle: React.CSSProperties
  fmt: (n: number) => string
  fmtMetodo: (m: string) => string
}) {
  const engranajes = Math.floor(checkoutData.total / 10)
  const engranajasAnimated = useCountUp(engranajes, 1500, true)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #0d0d0d 0%, #0a1a0a 50%, #0d0d0d 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        ...transitionStyle,
      }}
    >
      <div
        className="cd-checkout-enter"
        style={{ textAlign: 'center', maxWidth: 600, width: '100%' }}
      >
        {/* Icono check */}
        <div
          style={{
            fontSize: '5rem',
            marginBottom: '0.75rem',
            lineHeight: 1,
          }}
        >
          ✅
        </div>

        {/* Título */}
        <h1
          style={{
            color: '#22c55e',
            fontWeight: 900,
            fontSize: 'clamp(2rem, 6vw, 3.5rem)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            margin: '0 0 0.5rem',
            lineHeight: 1.1,
            textShadow: '0 0 40px rgba(34,197,94,0.4)',
          }}
        >
          ¡Pago exitoso!
        </h1>

        {/* Despedida animada */}
        <p
          style={{
            color: 'rgba(255,255,255,0.65)',
            fontWeight: 700,
            fontSize: 'clamp(1.1rem, 3vw, 1.8rem)',
            letterSpacing: '0.06em',
            margin: '0 0 2rem',
          }}
        >
          ¡Gracias por tu visita! 👷
        </p>

        {/* Total pagado */}
        <div
          style={{
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderLeft: '5px solid #22c55e',
            borderRadius: 10,
            padding: '1.2rem 1.8rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontWeight: 900,
              fontSize: 'clamp(0.8rem, 2vw, 1rem)',
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
            }}
          >
            Total Pagado
          </span>
          <span
            style={{
              color: '#22c55e',
              fontWeight: 900,
              fontSize: 'clamp(1.4rem, 4vw, 2.2rem)',
              letterSpacing: '0.05em',
              textShadow: '0 0 20px rgba(34,197,94,0.4)',
            }}
          >
            {fmt(checkoutData.total)}
          </span>
        </div>

        {/* Cambio — enorme y llamativo */}
        {checkoutData.cambio > 0 && (
          <div
            className="cd-cambio-appear"
            style={{
              background: 'rgba(59,130,246,0.12)',
              border: '2px solid #3b82f6',
              borderRadius: 12,
              padding: '1.5rem 1.8rem',
              marginBottom: '1rem',
            }}
          >
            <div
              style={{
                color: 'rgba(255,255,255,0.6)',
                fontWeight: 900,
                fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
                letterSpacing: '0.35em',
                textTransform: 'uppercase',
                marginBottom: '0.4rem',
              }}
            >
              Tu cambio:
            </div>
            <div
              style={{
                color: '#60a5fa',
                fontWeight: 900,
                fontSize: 'clamp(3rem, 10vw, 6rem)',
                letterSpacing: '0.02em',
                lineHeight: 1,
                textShadow: '0 0 50px rgba(96,165,250,0.6)',
              }}
            >
              {fmt(checkoutData.cambio)}
            </div>
          </div>
        )}

        {/* Engranajes ganados con contador animado */}
        {engranajes > 0 && (
          <div
            style={{
              background: 'rgba(240,168,0,0.1)',
              border: '2px solid rgba(240,168,0,0.5)',
              borderRadius: 10,
              padding: '1rem 1.5rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
            }}
          >
            <span style={{ fontSize: '2rem' }}>⚙️</span>
            <div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.55)',
                  fontWeight: 700,
                  fontSize: 'clamp(0.8rem, 1.8vw, 0.95rem)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                }}
              >
                Engranajes ganados
              </div>
              <div
                style={{
                  color: '#F0A800',
                  fontWeight: 900,
                  fontSize: 'clamp(1.8rem, 5vw, 3rem)',
                  lineHeight: 1.1,
                  textShadow: '0 0 25px rgba(240,168,0,0.55)',
                }}
              >
                +{engranajasAnimated}
              </div>
            </div>
          </div>
        )}

        {/* Método de pago */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1.3rem',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 100,
            marginTop: '0.5rem',
          }}
        >
          <span
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontWeight: 700,
              fontSize: 'clamp(0.75rem, 1.8vw, 0.9rem)',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
            }}
          >
            Pago con
          </span>
          <span
            style={{
              color: '#ffffff',
              fontWeight: 900,
              fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {fmtMetodo(checkoutData.metodoPago)}
          </span>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(0,0,0,0.8)',
          borderTop: '2px solid #F0A800',
          padding: '1rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span
          style={{
            color: '#F0A800',
            fontWeight: 900,
            fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
          }}
        >
          ⚙️ Acumula Engranajes con cada compra
        </span>
      </div>
    </div>
  )
}
