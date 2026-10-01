/** Colours are theme tokens (CSS variables set per data-theme in index.css). */
const token = name => `rgb(var(--c-${name}) / <alpha-value>)`
const tokens = names => Object.fromEntries(names.map(n => [n, token(n)]))

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                ...tokens([
                    'canvas', 'panel', 'well', 'card', 'field', 'raised', 'hover', 'active', 'selected',
                    'line', 'row', 'edge', 'edge-strong', 'track',
                    'accent', 'accent-hover', 'on-accent', 'accent-tint',
                    'best', 'gain', 'gain-fg', 'loss', 'loss-fg', 'ok', 'ok-fg', 'ok-bg', 'warn-fg', 'warn-bg', 'danger-fg', 'danger-bg',
                    'race-bg', 'race-fg', 'quali-bg', 'quali-fg', 'hy-bg', 'hy-fg', 'gt3-bg', 'gt3-fg', 'p2-bg', 'p2-fg',
                ]),
                fg: {
                    strong: token('fg-strong'),
                    DEFAULT: token('fg'),
                    soft: token('fg-soft'),
                    2: token('fg-2'),
                    muted: token('fg-muted'),
                    subtle: token('fg-subtle'),
                    faint: token('fg-faint'),
                    ghost: token('fg-ghost'),
                },
            },
            fontFamily: {
                sans: ['Barlow', 'system-ui', 'sans-serif'],
                display: ['"Archivo Variable"', 'Barlow', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
            },
        },
    },
    plugins: [],
}
