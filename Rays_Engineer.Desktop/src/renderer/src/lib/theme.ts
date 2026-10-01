import { create } from 'zustand'

export type ThemeId = 'pitwall' | 'midnight' | 'paddock'

export interface ThemeInfo {
    id: ThemeId
    name: string
    description: string
    /** Preview swatches for the settings picker: ground, panel, text, accent. */
    swatches: [string, string, string, string]
}

export const THEMES: ThemeInfo[] = [
    { id: 'pitwall', name: 'Pit Wall', description: 'Graphite and amber — the default.', swatches: ['#0B0D10', '#1C2129', '#E8EAED', '#F5A524'] },
    { id: 'midnight', name: 'Midnight', description: 'Deep navy with a lime accent.', swatches: ['#070A12', '#1B2742', '#E8ECF4', '#D4FF3A'] },
    { id: 'paddock', name: 'Paddock Light', description: 'Light surfaces, signal red.', swatches: ['#EEF0F3', '#FFFFFF', '#14171C', '#D7261E'] },
]

export const DEFAULT_THEME: ThemeId = 'pitwall'

/** Colours for canvas-drawn charts and the track map, which can't read CSS classes. */
export interface ChartPalette {
    reference: string
    laps: readonly string[]
    axis: string
    grid: string
    ticks: string
    zeroLine: string
    mapTrack: string
    mapZoom: string
    mapStart: string
    markerRing: string
}

export const CHART_PALETTES: Record<ThemeId, ChartPalette> = {
    pitwall: {
        reference: '#A3ACB8', laps: ['#F5A524', '#38BDF8', '#E879F9', '#A3E635'],
        axis: '#858D99', grid: '#1A1E25', ticks: '#20252C', zeroLine: '#3A414C',
        mapTrack: '#2A303A', mapZoom: '#5E6672', mapStart: '#9AA2AD', markerRing: '#0B0D10',
    },
    midnight: {
        reference: '#A9B4C8', laps: ['#D4FF3A', '#38BDF8', '#E879F9', '#FB923C'],
        axis: '#8796B3', grid: '#18223A', ticks: '#1E2942', zeroLine: '#3A4868',
        mapTrack: '#29365A', mapZoom: '#5E6C8C', mapStart: '#9EABC4', markerRing: '#070A12',
    },
    paddock: {
        reference: '#8A93A0', laps: ['#D7261E', '#0284C7', '#9333EA', '#16A34A'],
        axis: '#5F6671', grid: '#ECEEF2', ticks: '#DDE1E7', zeroLine: '#9AA1AC',
        mapTrack: '#DDE1E7', mapZoom: '#9AA1AC', mapStart: '#4F5662', markerRing: '#FFFFFF',
    },
}

const THEME_KEY = 'rays.theme'

function isTheme(v: unknown): v is ThemeId {
    return THEMES.some(t => t.id === v)
}

function loadTheme(): ThemeId {
    try {
        const v = localStorage.getItem(THEME_KEY)
        return isTheme(v) ? v : DEFAULT_THEME
    } catch {
        return DEFAULT_THEME
    }
}

/** Sets the theme on <html>; index.css switches its colour tokens on data-theme. */
export function applyTheme(id: ThemeId): void {
    document.documentElement.dataset.theme = id
}

interface ThemeState {
    theme: ThemeId
    setTheme: (id: ThemeId) => void
}

export const useThemeStore = create<ThemeState>(set => ({
    theme: loadTheme(),
    setTheme: id => {
        try { localStorage.setItem(THEME_KEY, id) } catch { /* storage unavailable */ }
        applyTheme(id)
        set({ theme: id })
    },
}))

export function useChartPalette(): ChartPalette {
    return CHART_PALETTES[useThemeStore(s => s.theme)]
}
