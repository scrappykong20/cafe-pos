/**
 * TouchKeyboard — Teclado virtual flotante para pantallas táctiles
 *
 * Aparece automáticamente al hacer foco en cualquier <input> o <textarea>.
 * No roba el foco del campo activo (usa onMouseDown + preventDefault en las teclas).
 * Soporta modo numérico (para campos type="number", type="tel", inputMode="numeric")
 * y modo QWERTY completo para texto libre.
 *
 * Para desactivar en un campo específico, agrega: data-no-keyboard="true"
 * Para forzar modo numérico:                      data-keyboard="numeric"
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNumericInput(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el instanceof HTMLTextAreaElement) return false
  if (el.dataset.keyboard === 'numeric') return true
  return (
    el.type === 'number' ||
    el.type === 'tel' ||
    el.inputMode === 'numeric' ||
    el.inputMode === 'decimal'
  )
}

/**
 * Setea el valor de un input controlado por React desde fuera de React.
 * Usa el setter nativo para disparar el evento que React intercepta.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

// ── Layout QWERTY ─────────────────────────────────────────────────────────────

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]
const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

// ── Componente principal ──────────────────────────────────────────────────────

export default function TouchKeyboard() {
  const [visible, setVisible] = useState(false)
  const [numeric, setNumeric] = useState(false)
  const [shifted, setShifted] = useState(false)
  const [caps, setCaps] = useState(false)
  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  // Bandera: evita ocultar el teclado mientras el usuario presiona una tecla
  const pressingRef = useRef(false)
  const focusOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Detectar foco en inputs ─────────────────────────────────────────────

  const handleFocusIn = useCallback((e: FocusEvent) => {
    const target = e.target
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement)
    ) return
    if (target.readOnly || target.disabled) return
    if ((target as HTMLInputElement).dataset.noKeyboard === 'true') return

    activeInputRef.current = target
    setNumeric(isNumericInput(target))
    setVisible(true)
  }, [])

  const handleFocusOut = useCallback((e: FocusEvent) => {
    // Si está presionando una tecla, ignorar el focusout (evita parpadeo)
    if (pressingRef.current) return
    // Si el foco se mueve a otra parte del teclado, no lo ocultamos
    const related = (e as FocusEvent & { relatedTarget: Element | null }).relatedTarget
    if (related?.closest('#touch-keyboard-root')) return
    // Pequeño delay para manejar transiciones rápidas de foco (touch events)
    if (focusOutTimerRef.current) clearTimeout(focusOutTimerRef.current)
    focusOutTimerRef.current = setTimeout(() => {
      if (pressingRef.current) return
      if (document.activeElement?.closest?.('#touch-keyboard-root')) return
      if (document.activeElement === activeInputRef.current) return
      setVisible(false)
      activeInputRef.current = null
    }, 150)
  }, [])

  useEffect(() => {
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      if (focusOutTimerRef.current) clearTimeout(focusOutTimerRef.current)
    }
  }, [handleFocusIn, handleFocusOut])

  // ── Lógica de teclas ────────────────────────────────────────────────────

  const pressKey = useCallback(
    (key: string) => {
      const input = activeInputRef.current
      if (!input) return
      // Marcar que estamos presionando para no ocultar el teclado durante la acción
      pressingRef.current = true

      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? input.value.length
      const current = input.value
      let newValue = current
      let newCursor = start

      if (key === '⌫') {
        if (start === end && start > 0) {
          newValue = current.slice(0, start - 1) + current.slice(end)
          newCursor = start - 1
        } else if (start !== end) {
          newValue = current.slice(0, start) + current.slice(end)
          newCursor = start
        }
      } else if (key === 'Enter') {
        if (input instanceof HTMLTextAreaElement) {
          newValue = current.slice(0, start) + '\n' + current.slice(end)
          newCursor = start + 1
        } else {
          input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          )
          setVisible(false)
          input.blur()
          return
        }
      } else if (key === ' ') {
        newValue = current.slice(0, start) + ' ' + current.slice(end)
        newCursor = start + 1
      } else {
        const char = shifted || caps ? key.toUpperCase() : key
        newValue = current.slice(0, start) + char + current.slice(end)
        newCursor = start + char.length
        if (shifted && !caps) setShifted(false)
      }

      setNativeValue(input, newValue)

      // Restaurar cursor después de que React re-renderice
      requestAnimationFrame(() => {
        try {
          input.focus()
          input.setSelectionRange(newCursor, newCursor)
        } catch (_) {}
        // Liberar la bandera después de restaurar el foco
        pressingRef.current = false
      })
    },
    [shifted, caps],
  )

  // Evita que el click o toque en una tecla robe el foco del input activo
  const preventBlur = (e: React.MouseEvent | React.TouchEvent) => e.preventDefault()

  const close = () => {
    setVisible(false)
    activeInputRef.current?.blur()
    activeInputRef.current = null
  }

  if (!visible) return null

  // ── Layout numérico ──────────────────────────────────────────────────────

  if (numeric) {
    return (
      <div
        id="touch-keyboard-root"
        onMouseDown={preventBlur}
        onTouchStart={preventBlur}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 99999,
          background: '#0f172a',
          borderTop: '1px solid #334155',
          padding: '12px',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {[['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].map(
          (row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: '8px' }}>
              {row.map((k) => (
                <NumKey key={k} label={k} onPress={() => pressKey(k)} />
              ))}
            </div>
          ),
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <NumKey label="." onPress={() => pressKey('.')} />
          <NumKey label="0" onPress={() => pressKey('0')} wide />
          <NumKey label="⌫" onPress={() => pressKey('⌫')} accent />
        </div>
        <button
          onMouseDown={preventBlur}
          onClick={close}
          style={{
            marginTop: 4,
            fontSize: 11,
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Cerrar ✕
        </button>
      </div>
    )
  }

  // ── Layout QWERTY completo ───────────────────────────────────────────────

  return (
    <div
      id="touch-keyboard-root"
      onMouseDown={preventBlur}
      onTouchStart={preventBlur}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: '#0f172a',
        borderTop: '1px solid #334155',
        padding: '8px 6px 10px',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '5px',
      }}
    >
      {/* Fila de números */}
      <div style={{ display: 'flex', gap: 4 }}>
        {NUMBERS.map((k) => (
          <Key key={k} label={k} onPress={() => pressKey(k)} sm />
        ))}
        <Key label="⌫" onPress={() => pressKey('⌫')} accent sm />
      </div>

      {/* Filas QWERTY */}
      {ROWS.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 4 }}>
          {ri === 2 && (
            <Key
              label={caps ? '⬆︎' : '⇧'}
              onPress={() => {
                setCaps((c) => !c)
                setShifted(false)
              }}
              accent={shifted || caps}
              wide
            />
          )}
          {row.map((k) => (
            <Key
              key={k}
              label={shifted || caps ? k.toUpperCase() : k}
              onPress={() => pressKey(k)}
            />
          ))}
          {ri === 2 && (
            <Key label="⌫" onPress={() => pressKey('⌫')} accent wide />
          )}
        </div>
      ))}

      {/* Fila inferior */}
      <div style={{ display: 'flex', gap: 4 }}>
        <Key label="✕" onPress={close} accent />
        <Key
          label="⇧"
          onPress={() => setShifted((s) => !s)}
          accent={shifted}
        />
        <Key label="Espacio" onPress={() => pressKey(' ')} space />
        <Key label="↵" onPress={() => pressKey('Enter')} accent wide />
      </div>
    </div>
  )
}

// ── Sub-componentes de tecla ──────────────────────────────────────────────────

interface KeyProps {
  label: string
  onPress: () => void
  wide?: boolean
  space?: boolean
  accent?: boolean
  sm?: boolean
}

function Key({ label, onPress, wide, space, accent, sm }: KeyProps) {
  const h = sm ? 36 : 42
  const minW = space ? 160 : wide ? 62 : sm ? 34 : 40
  const bg = accent ? '#475569' : '#1e293b'
  const bgHover = accent ? '#64748b' : '#334155'

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault()
        onPress()
      }}
      onTouchStart={(e) => {
        e.preventDefault()
        onPress()
      }}
      style={{
        height: h,
        minWidth: minW,
        flex: space ? 1 : undefined,
        maxWidth: space ? 280 : undefined,
        background: bg,
        color: '#f1f5f9',
        border: '1px solid #334155',
        borderRadius: 8,
        fontSize: sm ? 13 : 15,
        fontFamily: 'monospace',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.08s',
        padding: '0 8px',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = bgHover
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = bg
      }}
    >
      {label}
    </button>
  )
}

interface NumKeyProps {
  label: string
  onPress: () => void
  wide?: boolean
  accent?: boolean
}

function NumKey({ label, onPress, wide, accent }: NumKeyProps) {
  const bg = accent ? '#475569' : '#1e293b'
  const bgHover = accent ? '#64748b' : '#334155'

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault()
        onPress()
      }}
      onTouchStart={(e) => {
        e.preventDefault()
        onPress()
      }}
      style={{
        height: 56,
        minWidth: wide ? 116 : 56,
        background: bg,
        color: '#f1f5f9',
        border: '1px solid #334155',
        borderRadius: 10,
        fontSize: 20,
        fontFamily: 'monospace',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.08s',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = bgHover
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = bg
      }}
    >
      {label}
    </button>
  )
}
