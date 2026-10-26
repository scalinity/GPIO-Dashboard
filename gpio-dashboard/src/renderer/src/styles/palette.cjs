// The interface's colours (SPEC 2.3, ADR-0142), written once: the night-lab HUD's ink ground, its
// cool text ramp, the glass of its cards, and five accents with fixed meanings. Cyan is
// measurement and selection, amber hardware and events, coral limits and faults, violet the
// assistant and a second series, green "OK". tailwind.config.js maps these into the theme under
// the existing class names and emits them as CSS variables; palette.test.ts checks their contrast.

const ink = '#0b0f1a'

/** The five accents. */
const accents = {
  cyan: '#7fe3ff',
  amber: '#ffb454',
  coral: '#ff6b86',
  violet: '#b99cff',
  green: '#8fe8a8'
}

/** `a` moved toward `b` by `t` (0 to 1), in sRGB. */
function mix(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** A Tailwind shade ramp around an accent: tints above it, the accent at 400 and 500, shades of
 * ink below. */
function ramp(c) {
  return {
    50: mix(c, '#ffffff', 0.9),
    100: mix(c, '#ffffff', 0.75),
    200: mix(c, '#ffffff', 0.55),
    300: mix(c, '#ffffff', 0.3),
    400: c,
    500: c,
    600: mix(c, ink, 0.2),
    700: mix(c, ink, 0.4),
    800: mix(c, ink, 0.6),
    900: mix(c, ink, 0.75),
    950: mix(c, ink, 0.85)
  }
}

module.exports = {
  ink,
  ...accents,
  ramp,
  /** The ink ramp: 950 is the page, 900 and 800 the glass stops, the rest borders and wells. */
  surface: {
    950: ink,
    900: '#0d1220',
    800: '#141a2a',
    700: '#1c2336',
    600: '#283049',
    500: '#3a4360',
    400: '#55607e'
  },
  /** The HUD's text ramp, from the title white down to key hints (100 to 600 are text). */
  text: {
    50: '#f7f9fd',
    100: '#eef2fa',
    200: '#dfe6f5',
    300: '#c7cee0',
    400: '#9ea8c2',
    500: '#8d97b3',
    600: '#7d87a4',
    700: '#4a536d',
    800: '#2a3146',
    900: '#1a2032',
    950: '#111626'
  },
  /** A selected segment or primary button: near-white ground, ink text. */
  onBg: '#eef4ff',
  onText: '#101626',
  /** Light cyan, for icons and text on a cyan-tinted ground (the play button). */
  cyanLight: '#bff2ff',
  /** Light coral, the same on a coral-tinted ground (Stop). */
  coralLight: '#ffc2cd',
  /** Translucent fills, all over ink. */
  glass: {
    top: '#141a2ae8',
    bottom: '#0d1220e3',
    chip: '#0d1220c4',
    tip: '#0b1020e8',
    toast: '#0e1220dd',
    dialog: '#101526',
    seg: '#ffffff0c',
    tool: '#ffffff12',
    hover: '#ffffff14',
    hoverStrong: '#ffffff24',
    hairline: '#ffffff12',
    track: '#ffffff1f'
  },
  shadow: '0 18px 50px -20px #000b'
}
