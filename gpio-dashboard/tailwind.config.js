const plugin = require('tailwindcss/plugin')
const palette = require('./src/renderer/src/styles/palette.cjs')

// The night-lab HUD (SPEC 2.3, ADR-0142): the palette's colours take over the theme's existing
// names, so `surface`, `accent`, `gray`, `red`, `amber`, `emerald`, `green`, `sky` and `violet`
// classes take the new look where they stand.
const cyan = palette.ramp(palette.cyan)

/** The palette as CSS variables on :root, for the stylesheets and the few colours set in code. */
const variables = {
  '--ink': palette.ink,
  '--text': palette.text[100],
  '--text-kicker': palette.text[200],
  '--text-lede': palette.text[300],
  '--mute': palette.text[400],
  '--mute-stat': palette.text[500],
  '--mute-hint': palette.text[600],
  '--cyan': palette.cyan,
  '--cyan-light': palette.cyanLight,
  '--amber': palette.amber,
  '--coral': palette.coral,
  '--coral-light': palette.coralLight,
  '--violet': palette.violet,
  '--green': palette.green,
  '--on-bg': palette.onBg,
  '--on-text': palette.onText,
  '--surface-900': palette.surface[900],
  '--surface-800': palette.surface[800],
  '--glass': `linear-gradient(150deg, ${palette.glass.top}, ${palette.glass.bottom})`,
  '--chip': palette.glass.chip,
  '--tip-bg': palette.glass.tip,
  '--toast-bg': palette.glass.toast,
  '--dialog-bg': palette.glass.dialog,
  '--seg-bg': palette.glass.seg,
  '--tool-bg': palette.glass.tool,
  '--hover': palette.glass.hover,
  '--hover-strong': palette.glass.hoverStrong,
  '--hairline': palette.glass.hairline,
  '--track': palette.glass.track,
  '--shadow': palette.shadow
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: palette.ink,
        surface: palette.surface,
        accent: {
          DEFAULT: palette.cyan,
          light: palette.cyanLight,
          dim: cyan[600],
          glow: `${palette.cyan}30`
        },
        on: { bg: palette.onBg, text: palette.onText },
        gray: palette.text,
        red: palette.ramp(palette.coral),
        amber: palette.ramp(palette.amber),
        emerald: palette.ramp(palette.green),
        green: palette.ramp(palette.green),
        sky: cyan,
        violet: palette.ramp(palette.violet),
        // Pin type colors (preserved)
        pin: {
          gpio: '#22C55E',
          power5v: '#EF4444',
          power3v3: '#F97316',
          ground: '#1E293B',
          i2c: '#3B82F6',
          spi: '#A855F7',
          uart: '#EC4899',
          pcm: '#14B8A6',
          eeprom: '#F59E0B'
        },
        // State indicators (preserved)
        state: {
          high: '#22C55E',
          low: '#475569',
          input: '#3B82F6',
          output: '#F97316'
        }
      },
      // Outfit for the interface and DM Mono for values (main.jsx loads both). The system faces
      // after them carry the glyphs they lack, such as Ω, → and ⌘.
      fontFamily: {
        sans: ['Outfit Variable', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'Menlo', 'monospace']
      },
      borderRadius: {
        card: '16px',
        btn: '10px',
        pill: '9999px'
      },
      boxShadow: {
        card: palette.shadow,
        'card-hover': palette.shadow,
        'glow-accent': `0 0 20px ${palette.cyan}26`,
        'glow-success': `0 0 6px ${palette.green}66`,
        'glow-warn': `0 0 6px ${palette.amber}66`,
        'glow-danger': `0 0 6px ${palette.coral}66`,
        'inner-highlight': 'inset 0 1px 0 0 rgba(255,255,255,0.03)'
      },
      animation: {
        'gpio-pulse': 'gpioPulse 200ms ease-out',
        'draw-in': 'drawIn 0.6s ease-out forwards',
        'fade-in': 'fadeIn 150ms ease-out',
        'slide-up': 'slideUp 200ms ease-out',
        shimmer: 'shimmer 2s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite'
      },
      keyframes: {
        gpioPulse: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' }
        },
        drawIn: {
          '0%': { strokeDashoffset: '1000' },
          '100%': { strokeDashoffset: '0' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' }
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' }
        }
      }
    }
  },
  plugins: [plugin(({ addBase }) => addBase({ ':root': variables }))]
}
