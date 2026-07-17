import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.cafedelconstructor.pos',
  appName: 'Café POS',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f172a',
  },
  server: {
    // En producción usa los archivos locales (no URL externa)
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
