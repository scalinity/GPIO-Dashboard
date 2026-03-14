/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Deep dark theme base
        surface: {
          950: '#050A14',
          900: '#0A0F1A',
          800: '#111827',
          700: '#1F2937',
          600: '#374151',
          500: '#4B5563'
        },
        // Accent (indigo)
        accent: {
          DEFAULT: '#6366F1',
          light: '#818CF8',
          dim: '#4F46E5',
          glow: '#6366F130'
        },
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
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace']
      },
      borderRadius: {
        card: '14px',
        btn: '10px',
        pill: '9999px'
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)',
        'glow-accent': '0 0 20px rgba(99,102,241,0.15)',
        'glow-success': '0 0 6px rgba(16,185,129,0.4)',
        'glow-warn': '0 0 6px rgba(251,191,36,0.4)',
        'glow-danger': '0 0 6px rgba(239,68,68,0.4)',
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
  plugins: []
}
