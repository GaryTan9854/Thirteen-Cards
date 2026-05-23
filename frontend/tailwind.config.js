/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:   ['"LXGW WenKai Screen"', '"Noto Serif TC"', 'serif'],
        cinzel: ['Cinzel', '"LXGW WenKai Screen"', 'serif'],
      },
    },
  },
  plugins: [],
}
