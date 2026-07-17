/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          black:    '#0D0D0D',
          charcoal: '#1A1A1A',
          dark:     '#242424',
          gray:     '#2E2E2E',
          border:   '#3A3A3A',
          yellow:   '#F0A800',
          'yellow-lt': '#FFB800',
          text:     '#F5F5F5',
          muted:    '#888888',
        }
      },
    },
  },
  plugins: [],
}
