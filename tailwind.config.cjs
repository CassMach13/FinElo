/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Adicionamos nossas cores customizadas dentro de 'extend'
      // para que elas sejam adicionadas à paleta padrão do Tailwind, não a substituam.
      colors: {
        primary: '#1a202c',
        secondary: '#2d3748',
        accent: '#38b2ac',
        highlight: '#4299e1',
        light: '#f7fafc',
        'dark-text': '#e2e8f0',
        danger: '#f56565',
        'theme-canvas': 'rgb(var(--appearance-canvas) / <alpha-value>)',
        'theme-surface': 'rgb(var(--appearance-surface) / <alpha-value>)',
        'theme-content': 'rgb(var(--appearance-content) / <alpha-value>)',
        'theme-muted': 'rgb(var(--appearance-muted) / <alpha-value>)',
        'theme-divider': 'rgb(var(--appearance-divider) / <alpha-value>)',
        'theme-focus': 'rgb(var(--appearance-focus) / <alpha-value>)',
      },
      fontFamily: {
        // Landing + futuro app: Plus Jakarta Sans (scoped na landing via font-landing)
        landing: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
