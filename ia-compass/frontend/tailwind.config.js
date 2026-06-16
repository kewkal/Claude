/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'brand-blue': '#38BDF8',
        'brand-dark': '#1E40AF',
        'sidebar': '#0F172A',
        'card-dark': '#1E293B',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
