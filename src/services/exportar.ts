/**
 * Exporta un array de objetos a CSV y dispara la descarga automática.
 * No requiere librerías externas.
 */
export function exportarCSV(datos: Record<string, unknown>[], nombreArchivo: string): void {
  if (datos.length === 0) return

  const encabezados = Object.keys(datos[0])
  const escaparCelda = (valor: unknown): string => {
    const str = valor == null ? '' : String(valor)
    // Si contiene coma, comilla o salto de línea, envuelve en comillas
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
  }

  const filas = [
    encabezados.join(','),
    ...datos.map(fila =>
      encabezados.map(col => escaparCelda(fila[col])).join(',')
    ),
  ]

  const csvContent = '\uFEFF' + filas.join('\r\n') // BOM para Excel en UTF-8

  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = nombreArchivo.endsWith('.csv') ? nombreArchivo : nombreArchivo + '.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch {
    // Fallo silencioso — no rompe la aplicación
  }
}

/**
 * Abre una ventana de impresión con contenido HTML estilizado en blanco.
 */
export function exportarPDF(titulo: string, contenidoHtml: string): void {
  try {
    const ventana = window.open('', '_blank', 'width=900,height=700')
    if (!ventana) return

    ventana.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titulo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #ffffff;
      color: #111111;
      padding: 32px 40px;
      font-size: 13px;
    }
    h1 {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      border-bottom: 3px solid #111;
      padding-bottom: 10px;
      margin-bottom: 6px;
    }
    .subtitulo {
      font-size: 11px;
      color: #666;
      letter-spacing: 0.1em;
      margin-bottom: 28px;
    }
    h2 {
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #555;
      margin: 24px 0 10px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 8px;
    }
    .kpi-card {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 14px 12px;
      text-align: center;
    }
    .kpi-value {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 0.04em;
      color: #111;
    }
    .kpi-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #888;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 4px;
    }
    th {
      text-align: left;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #888;
      padding: 6px 8px;
      border-bottom: 2px solid #ddd;
    }
    td {
      padding: 8px 8px;
      font-size: 12px;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    .rank { color: #aaa; font-weight: 900; font-size: 10px; }
    .total-cell { font-weight: 900; text-align: right; }
    .footer {
      margin-top: 36px;
      font-size: 10px;
      color: #bbb;
      letter-spacing: 0.1em;
      border-top: 1px solid #eee;
      padding-top: 10px;
    }
    @media print {
      body { padding: 20px 24px; }
      .kpi-grid { grid-template-columns: repeat(4, 1fr); }
    }
  </style>
</head>
<body>
  <h1>El Café del Constructor</h1>
  <div class="subtitulo">${titulo} &nbsp;·&nbsp; Generado el ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
  ${contenidoHtml}
  <div class="footer">Reporte generado automáticamente por El Café del Constructor POS</div>
</body>
</html>`)

    ventana.document.close()
    ventana.focus()
    // Pequeño retardo para que el navegador termine de renderizar antes de imprimir
    setTimeout(() => {
      try { ventana.print() } catch { /* silencioso */ }
    }, 400)
  } catch {
    // Fallo silencioso — no rompe la aplicación
  }
}
