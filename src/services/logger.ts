/**
 * Logger remoto — guarda eventos y errores en Supabase logs_pos
 * para diagnóstico desde cualquier PC.
 */
import { supabase } from '../supabase'

type Nivel = 'info' | 'warn' | 'error'

const PC_KEY = 'pos_pc_nombre'

function getPcNombre(): string {
  try {
    let nombre = localStorage.getItem(PC_KEY)
    if (!nombre) {
      nombre = `PC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
      localStorage.setItem(PC_KEY, nombre)
    }
    return nombre
  } catch {
    return 'PC-desconocida'
  }
}

async function log(nivel: Nivel, modulo: string, mensaje: string, detalle?: Record<string, unknown>) {
  try {
    await supabase.from('logs_pos').insert({
      pc_nombre: getPcNombre(),
      nivel,
      modulo,
      mensaje,
      detalle: detalle ?? null,
    })
  } catch {
    // Si falla el log, no romper nada
  }
}

export const logger = {
  info:  (modulo: string, mensaje: string, detalle?: Record<string, unknown>) => log('info',  modulo, mensaje, detalle),
  warn:  (modulo: string, mensaje: string, detalle?: Record<string, unknown>) => log('warn',  modulo, mensaje, detalle),
  error: (modulo: string, mensaje: string, detalle?: Record<string, unknown>) => log('error', modulo, mensaje, detalle),
}

/** Captura errores globales no manejados y los registra */
export function iniciarLoggerGlobal() {
  window.addEventListener('unhandledrejection', (e) => {
    log('error', 'global', 'Promise no manejada', {
      reason: String(e.reason),
    })
  })
  window.addEventListener('error', (e) => {
    log('error', 'global', e.message ?? 'Error JS', {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    })
  })
}
