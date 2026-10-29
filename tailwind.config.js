/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#15803D',
          dark: '#14532D',
          soft: '#F0FDF4',
        },
        canvas: '#F7F9F7',
        ink: '#17211B',
        muted: '#667085',
        line: '#E4EAE5',
        warn: { DEFAULT: '#D97706', soft: '#FEF3C7' },
        crit: { DEFAULT: '#DC2626', soft: '#FEE2E2' },
        info: { DEFAULT: '#2563EB', soft: '#DBEAFE' },
        ok: { DEFAULT: '#16A34A', soft: '#DCFCE7' },
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(20, 83, 45, 0.04)',
        pop: '0 4px 6px -1px rgba(23, 33, 27, 0.08), 0 2px 4px -2px rgba(23, 33, 27, 0.04)',
        modal: '0 20px 25px -5px rgba(23, 33, 27, 0.1), 0 8px 10px -6px rgba(23, 33, 27, 0.04)',
      },
      borderRadius: {
        card: '1rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        'slide-in': 'slide-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};
