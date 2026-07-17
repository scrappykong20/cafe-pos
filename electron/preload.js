// Preload — corre en el mismo contexto V8 que la página (contextIsolation: false)
// El override de navigator.serviceWorker SÍ afecta a registerSW.js de la página.

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
