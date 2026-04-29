/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0e0e10',
          panel: '#17171a',
          surface: '#1f1f24',
          elevated: '#26262d',
          hover: '#2d2d35',
        },
        border: {
          subtle: '#2a2a30',
          strong: '#3a3a42',
        },
        text: {
          primary: '#f5f5f7',
          secondary: '#a1a1aa',
          muted: '#6b6b75',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#8e72ff',
          subtle: '#7c5cff20',
        },
        track: {
          video: '#3b82f6',
          audio: '#10b981',
          text: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
