/**
 * Convierte el logo PNG a ESC/POS raster bitmap (GS v 0)
 * Genera logo-escpos.js con el base64 listo para usar en el servidor de impresión
 * Ejecutar: node print-server/convert-logo.cjs
 */
const sharp = require('sharp')
const fs    = require('fs')
const path  = require('path')

const LOGO_PATH    = 'C:\\Users\\Scrappykong20\\Desktop\\PROYECTO CAFETERIA APPS\\logo.png'
const OUTPUT_PATH  = path.join(__dirname, 'logo-escpos.js')
const PRINTER_WIDTH = 576  // dots — ancho de impresión 80mm a 203dpi
const TARGET_WIDTH  = 300  // px — ancho del logo dentro del ticket
const THRESHOLD     = 160  // umbral: píxeles más oscuros → punto negro

async function main() {
  console.log('Leyendo logo:', LOGO_PATH)

  const leftPad  = Math.floor((PRINTER_WIDTH - TARGET_WIDTH) / 2)
  const rightPad = PRINTER_WIDTH - TARGET_WIDTH - leftPad

  const { data, info } = await sharp(LOGO_PATH)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .trim({ background: '#ffffff', threshold: 10 })     // eliminar espacio blanco desigual del PNG
    .resize(TARGET_WIDTH, null, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
    .extend({ left: leftPad, right: rightPad, top: 4, bottom: 4,
              background: { r: 255, g: 255, b: 255 } }) // padding simétrico exacto
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1.2 })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const bytesPerRow = Math.ceil(width / 8)
  console.log(`Logo redimensionado: ${width}x${height}px, ${bytesPerRow} bytes/fila`)

  // Convertir píxeles grises a bitmap 1-bit (1 = negro)
  const bitmap = []
  for (let y = 0; y < height; y++) {
    const row = new Array(bytesPerRow).fill(0)
    for (let x = 0; x < width; x++) {
      const gray = data[(y * width + x) * channels]
      if (gray < THRESHOLD) {
        row[Math.floor(x / 8)] |= (0x80 >> (x % 8))
      }
    }
    bitmap.push(...row)
  }

  // Comando ESC/POS: GS v 0 (raster bit image)
  //   1D 76 30 m xL xH yL yH [data]
  //   m=0 → escala normal — centrado via padding en el bitmap
  const escpos = [
    0x1D, 0x76, 0x30, 0x00,   // GS v 0 0
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,  // xL xH
    height & 0xFF,  (height >> 8) & 0xFF,            // yL yH
    ...bitmap,
    0x0A,                      // LF — espacio después del logo
    0x1B, 0x61, 0x00,          // ESC a 0 — volver a izquierda
  ]

  const base64 = Buffer.from(escpos).toString('base64')
  const js = `// Logo ESC/POS generado automáticamente — no editar manualmente\n// Fuente: ${path.basename(LOGO_PATH)} (${width}x${height}px)\nmodule.exports = '${base64}'\n`
  fs.writeFileSync(OUTPUT_PATH, js, 'utf8')
  console.log(`✅ Logo ESC/POS guardado en: ${OUTPUT_PATH}`)
  console.log(`   Tamaño bitmap: ${(bitmap.length / 1024).toFixed(1)} KB`)
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1) })
