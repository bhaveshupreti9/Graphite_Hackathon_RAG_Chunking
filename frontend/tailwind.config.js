/** Colours come from CSS variables in src/index.css so every token lives in one place. */
const rgb = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: rgb('bg'),
        surface: rgb('surface'),
        'surface-2': rgb('surface-2'),
        border: rgb('border'),
        fg: rgb('fg'),
        muted: rgb('muted'),
        accent: rgb('accent'),
        naive: rgb('naive'),
        good: rgb('good'),
        bad: rgb('bad'),
        noise: rgb('noise'),
        type: {
          prose: rgb('type-prose'),
          code: rgb('type-code'),
          table: rgb('type-table'),
          list: rgb('type-list'),
        },
      },
      fontFamily: {
        sans: ['"Bricolage Grotesque Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Modular scale (1.25) on a 15px base.
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['0.9375rem', { lineHeight: '1.55rem' }],
        lg: ['1.17rem', { lineHeight: '1.7rem' }],
        xl: ['1.46rem', { lineHeight: '1.9rem' }],
        '2xl': ['1.83rem', { lineHeight: '2.2rem' }],
        '3xl': ['2.29rem', { lineHeight: '2.6rem' }],
        '4xl': ['2.86rem', { lineHeight: '3.1rem' }],
        '5xl': ['3.58rem', { lineHeight: '3.7rem' }],
        '6xl': ['4.47rem', { lineHeight: '4.4rem' }],
      },
      spacing: { nav: 'var(--nav-h)' },
      maxWidth: { page: 'var(--page-max)' },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
