import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import CustomerDisplayPage from './pages/CustomerDisplayPage.tsx'

const isDisplay = window.location.pathname.includes('/display') ||
  new URLSearchParams(window.location.search).has('display')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDisplay ? (
      <CustomerDisplayPage />
    ) : (
      <>
        <App />
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
