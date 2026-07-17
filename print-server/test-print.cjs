/**
 * Prueba de impresión directa — ejecutar con: node print-server/test-print.cjs
 */
const { execFileSync } = require('child_process')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const PRINTER = 'EPSON TM-T20IV Receipt6'

// ESC/POS: encabezado de prueba
const ESC = 0x1B, GS = 0x1D, LF = 0x0A

const bytes = [
  ESC, 0x40,          // init
  ESC, 0x74, 0x02,    // code page PC850
  ESC, 0x64, 0x02,    // feed 2 (margen superior)

  ESC, 0x61, 0x01,    // center
  ESC, 0x45, 0x01,    // bold on
  GS,  0x21, 0x01,    // double height
  ...Buffer.from('EL CAFE DEL CONSTRUCTOR'), LF,
  GS,  0x21, 0x00,    // normal
  ESC, 0x45, 0x00,    // bold off
  ...Buffer.from('--- TICKET DE PRUEBA ---'), LF,
  LF,
  ESC, 0x61, 0x00,    // left
  ...Buffer.from('Impresora: ' + PRINTER), LF,
  ...Buffer.from('Formato: ESC/POS RAW'), LF,
  ...Buffer.from('Resultado: NITIDO'), LF,
  LF,
  ESC, 0x61, 0x01,    // center
  ...Buffer.from('Si este texto se ve nitido,'), LF,
  ...Buffer.from('la configuracion es correcta!'), LF,

  ESC, 0x64, 0x04,    // feed 4 (margen inferior)
  GS,  0x56, 0x42, 0x03,  // partial cut
]

const base64 = Buffer.from(bytes).toString('base64')

const psScript = `
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelperTest {
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
  public struct DocInfo1 { public string pDocName; public string pOutputFile; public string pDatatype; }
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr h, int level, ref DocInfo1 di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  public static bool PrintRaw(string name, byte[] data) {
    IntPtr hPrinter;
    if (!OpenPrinter(name, out hPrinter, IntPtr.Zero)) return false;
    DocInfo1 di = new DocInfo1(); di.pDocName="TEST"; di.pOutputFile=null; di.pDatatype="RAW";
    if (StartDocPrinter(hPrinter, 1, ref di) == 0) { ClosePrinter(hPrinter); return false; }
    StartPagePrinter(hPrinter);
    int w; WritePrinter(hPrinter, data, data.Length, out w);
    EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
    return true;
  }
}
'@
} catch {}
$bytes = [System.Convert]::FromBase64String('${base64}')
$ok = [RawPrinterHelperTest]::PrintRaw('${PRINTER}', $bytes)
Write-Output $ok
`

const tmpPs = path.join(os.tmpdir(), `test_print_${Date.now()}.ps1`)
fs.writeFileSync(tmpPs, psScript, 'utf8')

try {
  console.log('Enviando ticket de prueba a:', PRINTER)
  const result = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs
  ], { timeout: 15000 }).toString().trim()
  console.log('Resultado PowerShell:', result)
  console.log(result.includes('True') ? '✅ IMPRIMIDO OK' : '❌ Error al imprimir')
} catch (e) {
  console.error('❌ Error:', e.message)
} finally {
  try { fs.unlinkSync(tmpPs) } catch {}
}
