/**
 * MercadoPago Point Smart — Integración de terminal física
 * Docs: https://www.mercadopago.com.mx/developers/es/docs/mp-point/integration-api/glossary
 */
import { Capacitor } from '@capacitor/core'

// En Android nativo no existe el proxy de Vite → llamar directamente a MP
const BASE_URL = Capacitor.isNativePlatform()
  ? 'https://api.mercadopago.com'
  : '/mp-api'
const TOKEN    = import.meta.env.VITE_MP_ACCESS_TOKEN as string
const DEVICE_ID = import.meta.env.VITE_MP_DEVICE_ID as string

export interface MpIntento {
  id: string
  device_id: string
  amount: number
  description: string
  state: MpEstadoIntento
  payment?: {
    id: number
    type: string
    installments: number
    installments_cost: string
  }
  additional_info?: {
    external_reference: string
  }
}

// Estados posibles de la terminal
export type MpEstadoIntento =
  | 'OPEN'          // Enviado a la terminal, esperando interacción
  | 'ON_TERMINAL'   // El cliente está pasando la tarjeta
  | 'PROCESSING'    // Procesando el pago
  | 'FINISHED'      // Terminado (revisar si fue aprobado o rechazado)
  | 'CANCELED'      // Cancelado por el cajero o la terminal
  | 'ERROR'         // Error en la terminal

export interface MpResultadoPago {
  aprobado: boolean
  estado: MpEstadoIntento
  paymentId?: number
  mensaje?: string
}

function headers() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }
}

// ── localStorage para recordar el último intent ID ──────────────────────────
const MP_LAST_INTENT_KEY = 'mp_last_intent_id'

export function guardarUltimoIntento(id: string) {
  localStorage.setItem(MP_LAST_INTENT_KEY, id)
}

export function limpiarUltimoIntento() {
  localStorage.removeItem(MP_LAST_INTENT_KEY)
}

// ── Crear intento ────────────────────────────────────────────────────────────

/** Crea un intento de pago en la terminal física */
export async function crearIntentoPago(
  monto: number,
  descripcion: string,
  referenciaExterna: string,
): Promise<MpIntento> {
  if (!TOKEN || TOKEN.startsWith('TEST-0000')) {
    throw new Error('VITE_MP_ACCESS_TOKEN no configurado en .env')
  }
  if (!DEVICE_ID || DEVICE_ID === 'PAX_A910__SMARTPOS0000000000') {
    throw new Error('VITE_MP_DEVICE_ID no configurado en .env')
  }

  const res = await fetch(
    `${BASE_URL}/point/integration-api/devices/${DEVICE_ID}/payment-intents`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        amount: Math.round(monto * 100), // centavos
        additional_info: {
          external_reference: referenciaExterna,
          print_on_terminal: true,
        },
      }),
    },
  )

  const data = await res.json()
  if (!res.ok) {
    console.error('[MP] Error crearIntentoPago — respuesta completa:', JSON.stringify(data, null, 2))
    const msg = data?.message || data?.error || `HTTP ${res.status}`
    throw new Error(`MercadoPago: ${msg}`)
  }
  return data as MpIntento
}

// ── Consultar estado ─────────────────────────────────────────────────────────

/** Consulta el estado de un intento de pago */
export async function obtenerEstadoIntento(intentoId: string): Promise<MpIntento> {
  const res = await fetch(
    `${BASE_URL}/point/integration-api/payment-intents/${intentoId}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } },
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`MercadoPago: ${data?.message || res.status}`)
  return data as MpIntento
}

// ── Cancelar ─────────────────────────────────────────────────────────────────

/** Cancela un intento de pago activo por su ID */
export async function cancelarIntentoPago(intentoId: string): Promise<boolean> {
  const res = await fetch(
    `${BASE_URL}/point/integration-api/devices/${DEVICE_ID}/payment-intents/${intentoId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    },
  )
  return res.ok
}

/**
 * Cancela el intento guardado en localStorage (del uso anterior).
 * BUG 6: Implementa hasta 3 reintentos con delay de 1s entre cada uno.
 * Si fallan todos, limpia localStorage de todas formas para evitar quedar atascado.
 */
export async function cancelarIntentoAtascado(): Promise<void> {
  const savedId = localStorage.getItem(MP_LAST_INTENT_KEY)
  if (!savedId) return

  // No loguear el ID del intento en producción para evitar exposición de datos de transacción
  const MAX_REINTENTOS = 3
  let exito = false
  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      const ok = await cancelarIntentoPago(savedId)
      if (ok) { exito = true; break }
    } catch {
      // error de red — reintentar
    }
    if (intento < MAX_REINTENTOS) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  if (!exito) {
    console.warn('[MP] No se pudo cancelar el intento atascado después de', MAX_REINTENTOS, 'intentos — limpiando localStorage de todas formas')
  }
  // Siempre limpiar para no quedar atascado
  limpiarUltimoIntento()
}

// ── Liberar terminal (reset de modo) ─────────────────────────────────────────

async function setModoDispositivo(modo: 'PDV' | 'STANDALONE'): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/point/integration-api/devices/${DEVICE_ID}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ operating_mode: modo }),
    },
  )
  if (!res.ok) console.warn('[MP] setModo', modo, '→ error:', res.status)
}

/**
 * Libera la cola del dispositivo cambiando a STANDALONE y volviendo a PDV.
 * Cancela cualquier intent atascado aunque no conozcamos su ID.
 */
export async function liberarTerminal(): Promise<void> {
  await setModoDispositivo('STANDALONE')
  await new Promise(r => setTimeout(r, 2000))
  await setModoDispositivo('PDV')
  await new Promise(r => setTimeout(r, 1500))
  limpiarUltimoIntento()
}

// ── Pago final ───────────────────────────────────────────────────────────────

/** Obtiene info del pago ya procesado para verificar aprobación */
export async function obtenerPago(paymentId: number): Promise<{ status: string; status_detail: string }> {
  const res = await fetch(
    `${BASE_URL}/v1/payments/${paymentId}`,
    { headers: { 'Authorization': `Bearer ${TOKEN}` } },
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`MercadoPago: ${data?.message || res.status}`)
  return data
}

/** Interpreta el resultado final de un intento terminado */
export function interpretarResultado(intento: MpIntento): MpResultadoPago {
  if (intento.state === 'CANCELED') {
    return { aprobado: false, estado: 'CANCELED', mensaje: 'Pago cancelado en la terminal' }
  }
  if (intento.state === 'ERROR') {
    return { aprobado: false, estado: 'ERROR', mensaje: 'Error en la terminal' }
  }
  if (intento.state === 'FINISHED') {
    if (intento.payment?.id) {
      return { aprobado: true, estado: 'FINISHED', paymentId: intento.payment.id }
    }
    return { aprobado: false, estado: 'FINISHED', mensaje: 'Pago rechazado o sin datos' }
  }
  return { aprobado: false, estado: intento.state, mensaje: 'Estado desconocido' }
}

export const MP_CONFIGURADO =
  !!TOKEN &&
  !TOKEN.startsWith('TEST-0000') &&
  !!DEVICE_ID &&
  DEVICE_ID !== 'PAX_A910__SMARTPOS0000000000'
