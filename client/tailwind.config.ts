import animate from 'tailwindcss-animate';
import type { Config } from 'tailwindcss';

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        // Hindi (Devanagari) glyphs fall through to Noto Sans Devanagari, loaded globally in index.html.
        sans: ['"DM Sans"', '"Noto Sans Devanagari"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          active: token('primary-active'),
          soft: token('primary-soft'),
          foreground: token('primary-foreground'),
        },
        accent: {
          DEFAULT: token('accent'),
          soft: token('accent-soft'),
          foreground: token('accent-foreground'),
        },
        muted: {
          DEFAULT: token('muted'),
          foreground: token('muted-foreground'),
        },
        card: {
          DEFAULT: token('card'),
          foreground: token('card-foreground'),
        },
        destructive: {
          DEFAULT: token('destructive'),
          soft: token('destructive-soft'),
          foreground: token('destructive-foreground'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 2px 8px rgb(15 23 42 / 0.05)',
        pop: '0 4px 12px rgb(15 23 42 / 0.08), 0 12px 32px rgb(15 23 42 / 0.10)',
      },
      spacing: {
        'bottom-nav': 'calc(4rem + env(safe-area-inset-bottom))',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
