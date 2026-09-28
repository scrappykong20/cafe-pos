# Bitácora de cambios — Café POS (sesión 21-22 sep 2026)

Documento de continuación: si se va la luz o se retoma el trabajo después, aquí está
todo lo que se hizo, qué falta y cómo reconstruir el instalador.

---

## 1. Entrega principal: EXE con auto-instalación de hardware

**Objetivo:** que el instalador EXE deje la impresora térmica y el lector QR
funcionando al 100% sin configuración manual.

### Archivos creados/modificados

| Archivo | Cambio |
|---|---|
| `electron/setup-hardware.ps1` | **NUEVO.** Script que: ① deja el servicio Spooler en Automático+iniciado, ② instala el driver "Generic / Text Only" (incluido en Windows 10/11), ③ detecta impresoras USB conectadas sin cola y las instala como "POS TERMICA", ④ loguea todo en `C:\ProgramData\CafePOS\setup-hardware.log` |
| `electron/installer.nsh` | El instalador NSIS ejecuta el script anterior al finalizar (elevado, oculto, nunca bloquea la instalación) |
| `electron-builder.json` | `setup-hardware.ps1` añadido a `extraResources` → queda en `resources/app/setup-hardware.ps1` dentro del EXE. También se añadió whitelist de `node_modules` para `electron-updater` + 16 dependencias (ver bug 2 abajo) |
| `print-server/server.cjs` | Nuevo endpoint `POST /setup-printers` (re-ejecuta el script si conectan la impresora después de instalar) y `POST /clear-queue` |
| `src/services/printer.ts` | `autoDetectarImpresoras()` ahora llama a `/setup-printers` si no encuentra térmicas y re-escanea |

### Lector QR
**No necesita instalación.** Es HID (Windows lo instala solo como teclado) y la app
ya captura sus lecturas globalmente por velocidad de tecleo (<50ms entre teclas).

### Cómo regenerar el EXE
```bash
cd "C:/Users/Scrappykong20/Desktop/PROYECTO CAFETERIA APPS/cafe-pos"
npm run make-exe
```
Salida: `C:/Users/Scrappykong20/Desktop/PROYECTO CAFETERIA APPS/instalador/Cafe POS Setup 2.5.0.exe`

---

## 2. Bugs corregidos (16 en total)

### Impresión / Electron / instalador
1. **CORS bloqueaba TODA la impresión en el EXE instalado** (`server.cjs`): la app empaquetada carga como `file://` (origen `null`) y no estaba en la allowlist → Chromium descartaba las respuestas. Añadidos orígenes `null`, `https://localhost`, `capacitor://localhost` y header `Access-Control-Allow-Private-Network`. **Verificado en vivo con curl.**
2. **Auto-actualización muerta** (`electron-builder.json`): `files` excluía `node_modules`, así que `electron-updater` no iba en el asar y el `require` fallaba en silencio. Se incluyó con todas sus dependencias transitivas (171 archivos verificados en el asar).
3. `POST /clear-queue` no existía (el fallback de `limpiarColaImpresion` para navegador/Android daba 404) → añadido.
4. `/setup-printers` en desarrollo buscaba el script en ruta equivocada → ahora prueba `../setup-hardware.ps1` (empaquetado) y `../electron/setup-hardware.ps1` (dev).
5. **Auto-detección podía asignar la misma impresora a caja y cocina** (tickets duplicados) → ahora excluye impresoras ya ocupadas en el otro slot (`printer.ts`).
6. **Botón "Probar impresión" probaba la impresora equivocada** si ambos slots eran tipo "caja" → nueva función `imprimirSlot(n, data)` que imprime exactamente el slot elegido (`printer.ts`, `ConfiguracionPage.tsx`).
7. Regex `esNombreImpresoraSeguro` (`server.cjs`) rechazaba nombres válidos con `& + / @ # :` → ampliado (sin permitir comillas, `;`, `$`, backtick).
8. Inyección de comilla en PowerShell (`electron/main.js` `limpiarColaImpresion`): nombre de impresora sin escapar → escape `'` → `''`. Además los scripts ya no reportan "ok" falso (ahora `if ($Error.Count -gt 0) { "fail" }`).
9. Race condition al reiniciar print-server (`main.js` `reiniciar-print-server`): el nuevo proceso arrancaba a los 1000ms y moría con EADDRINUSE → ahora espera el evento `exit` del viejo (con timeout de seguridad de 3s).

### Selector de impresora (pedido del usuario)
10. **Ya no hay que escribir el nombre de la impresora** (`ConfiguracionPage.tsx`): menú desplegable con las impresoras instaladas en Windows (se carga solo al entrar a Configuración), botón "🔄 Actualizar lista", y botón "Probar impresión" por slot con confirmación ✓/✗. Si no hay impresoras, muestra aviso rojo con instrucciones.

### Cobro (CheckoutModal.tsx / offlineQueue.ts / OrdenPage.tsx)
11. **Cobro parcial (dividir cuenta) cerraba la orden completa y liberaba la mesa** → nueva prop `esPagoParcial` (pasada desde `OrdenPage.tsx:1517`); con pago parcial no se marca la orden `pagada` ni se liberan mesas. También en la ruta offline (`es_pago_parcial` en la cola).
12. **Doble cobro con cupón**: el candado anti-doble-pago (`procesandoRef`) se activaba DESPUÉS del `await` de revalidación del cupón → dos Enter rápidos cobraban dos veces. Ahora se activa antes, con reset en cada salida temprana.
13. **Cancelar con terminal MercadoPago activa dejaba el cobro vivo** → Escape y click fuera bloqueados durante `mpEstado` creando/esperando; "Sí, cancelar" ahora ejecuta `cancelarPagoTerminal()` antes de cerrar.
14. **Pago exacto rechazado por floats** (`25.1 - 5.1 = 20.000000000000004`) → redondeo a centavos con `r2()` en `totalACobrar`, `cambio` y `puedeConfirmar`.
15. **Venta duplicada al sincronizar offline** → se conserva `ventaIdInsertada` tras el insert y se pasa como `venta_id_bd` a la cola (que ya sabía no re-insertar). La cola ahora también guarda `engranajes_canjeados` (antes el cliente conservaba engranajes ya canjeados) y `mesa_id` (libera mesas de ventas sin orden al sincronizar).
16. `enviarEncuesta` sin try/catch → rejection sin capturar sin internet. Corregido.

### Lector QR (QRScannerModal.tsx)
17. **El interceptor global perdía el primer carácter** si el input no tenía foco (token truncado, o peor: el char caía en el campo de efectivo de atrás) → ahora el primer char de una ráfaga se intercepta, se refleja en el input y se devuelve el foco.
18. El listener se re-registraba en cada re-render del padre (prop `onScan` inline) reiniciando el buffer a mitad de escaneo → `onScan` en `useRef`.
19. **Fuga de cámara**: si el modal se cerraba con `getUserMedia` pendiente, el stream quedaba encendido → flag `cancelled` + stop de tracks/controles.

### Arranque de la app
20. **Login de servicio fallido arrancaba "logueado"** (`App.tsx`): `setSesionActiva(true)` estaba en el `finally`. Ahora: con internet → error claro + pantalla "Activar POS"; sin internet → modo offline con toast (se respeta el caché de personal).
21. `setError` dentro del updater de `setLoading` (`OrdenPage.tsx:369`) → setStates fuera del updater.

---

## 3. Verificaciones hechas

- `npx tsc -b` → **exit 0**
- `node --check electron/main.js` y `print-server/server.cjs` → **OK**
- Sintaxis de `setup-hardware.ps1` validada con el parser de PowerShell → **OK**
- `electron-builder.json` JSON válido
- CORS probado en vivo: `GET /printers` y `OPTIONS /print` con `Origin: null` responden correcto
- EXE final verificado: contiene `setup-hardware.ps1` en `resources/app/` y `electron-updater` en el asar (171 archivos)
- Monto MercadoPago (`monto * 100` centavos) confirmado correcto contra la API Point

---

## 4. PENDIENTES (no hechos — requieren tocar Supabase)

1. **Stock atómico**: el descuento de inventario es read-modify-write en el cliente →
   dos cajas vendiendo lo mismo a la vez pierden stock. Solución: función RPC en Postgres:
   ```sql
   CREATE OR REPLACE FUNCTION descontar_stock(p_inventario_id uuid, p_cantidad numeric)
   RETURNS void AS $$
     UPDATE inventario SET stock_actual = GREATEST(0, stock_actual - p_cantidad)
     WHERE id = p_inventario_id;
   $$ LANGUAGE sql;
   ```
   y llamarla desde `CheckoutModal.tsx` (~línea 757) y `offlineQueue.ts` (~línea 167).
   NO se creó porque implica cambiar la base de datos de producción.
2. **Folios de orden únicos entre cajas**: `numeroOrden` = count de ventas del día →
   dos cajas simultáneas pueden repetir folio. Requiere secuencia en BD. No corregido.
3. **Versión del EXE**: sigue en 2.5.0 (`package.json` y registry en `installer.nsh`).
   Si se publica como auto-actualización a equipos instalados, subir a 2.6.0 primero.
4. **PINs en localStorage** (`PinLoginPage.tsx`): texto plano por diseño (login offline);
   un PIN desactivado sigue funcionando sin internet. Decisión pendiente del dueño.
5. Borde menor de la cola offline: si el insert de venta+items tuvo éxito pero falla
   un paso posterior, al sincronizar se re-insertarían los items (la deduplicación
   cubre la venta, no los items). Ventana de ocurrencia muy pequeña.

---

## 5. Estado de los archivos

Los cambios están en el **working tree SIN COMMIT** en el repo `cafe-pos/`.
Para respaldar: `cd cafe-pos && git status` / `git diff` muestra todo.
Si se quiere commit, pedirlo explícitamente (el agente no hace commits solo).

**EXE final listo para distribuir:**
`C:/Users/Scrappykong20/Desktop/PROYECTO CAFETERIA APPS/instalador/Cafe POS Setup 2.5.0.exe`
(compilado 22-sep 10:04, ~101 MB, firmado con signtool, incluye todo lo anterior)
