// Preload — corre en el mismo contexto V8 que la página (contextIsolation: false)
// El override de navigator.serviceWorker SÍ afecta a registerSW.js de la página.

const { ipcRenderer } = require('electron')

// Exponer API segura para que la app React pueda comunicarse con el proceso principal
window.electronAPI = {
  // Cierra la aplicación si la clave es correcta; retorna true/false
  cerrarApp: (clave) => ipcRenderer.invoke('cerrar-app', clave),
}


if ('serviceWorker' in navigator) {
  const noop = () => Promise.resolve()
  Object.defineProperty(navigator, 'serviceWorker', {
    get: () => ({
      register: noop,
      unregister: noop,
      getRegistrations: () => Promise.resolve([]),
      getRegistration: () => Promise.resolve(undefined),
      ready: new Promise(() => {}), // nunca resuelve — no hay SW
      addEventListener: () => {},
      removeEventListener: () => {},
      controller: null,
    }),
    configurable: true,
    enumerable: true,
  })
}
