import { supabase } from '../supabase'

/**
 * D3 — Audit Log
 * Inserta una acción en la tabla `audit_log`.
 * Si hay error, solo hace console.warn — nunca lanza excepción.
 */
export async function registrarAccion(
  accion: string,
  detalle: Record<string, unknown>,
  usuarioNombre?: string,
): Promise<void> {
  try {
    const { error } = await supabase.from('log_auditoria').insert({
      accion,
      detalle,
      cajero_nombre: usuarioNombre ?? 'Sistema',
    })
    if (error) console.warn('[auditLog] Error al registrar acción:', accion, error.message)
  } catch (err) {
    console.warn('[auditLog] Error al registrar acción:', accion, err)
  }
}
