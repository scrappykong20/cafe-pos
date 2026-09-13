import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import CustomerDisplayPage from './pages/CustomerDisplayPage.tsx'
import TouchKeyboard from './components/TouchKeyboard.tsx'

// ── Teclado Android/Capacitor ─────────────────────────────────────────────
// Cuando se toca un input/textarea, fuerza el foco para que el teclado aparezca.
// Cuando se toca un botón con el teclado activo, lo oculta automáticamente.
document.addEventListener('touchstart', (e) => {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    // Fuerza el focus para mostrar el teclado en Android WebView
    setTimeout(() => target.focus(), 0)
  } else if (
    target.tagName === 'BUTTON' ||
    target.closest('button') ||
    target.closest('[role="button"]')
  ) {
    // Oculta el teclado al presionar cualquier botón
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      active.blur()
    }
  }
}, { passive: true })

const isDisplay = window.location.pathname.includes('/display') ||
  new URLSearchParams(window.location.search).has('display')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDisplay ? (
      <CustomerDisplayPage />
    ) : (
      <>
        <App />
        <TouchKeyboard />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '12px',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#f8fafc' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#f8fafc' } },
          }}
        />
      </>
    )}
  </StrictMode>,
)
