import { create } from 'zustand'
import type { CompareLap, ExtraChart } from './compare'

export type { ExtraChart } from './compare'

export const MAX_COMPARE = 4
export const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const

const EXTRA_KEY = 'rays.analysis.extraCharts'

function loadExtra(): ExtraChart[] {
    try {
        const v = JSON.parse(localStorage.getItem(EXTRA_KEY) ?? '[]') as ExtraChart[]
        return Array.isArray(v) ? v.filter(e => typeof e.channel === 'string' && typeof e.wheel === 'number') : []
    } catch {
        return []
    }
}

function saveExtra(v: ExtraChart[]): void {
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(v)) } catch { /* storage unavailable */ }
}

interface AnalysisState {
    /** Laps to compare; the reference is analysed first and drawn in grey. */
    lapIds: number[]
    referenceLapId: number | null
    /** Distance under the cursor (m), shared by charts, map and readout. */
    cursorM: number | null
    /** Last chart the mouse entered; the readout shows its value as an extra column. */
    hoverChart: string | null
    /** Visible distance range (m), null = whole lap. */
    zoom: { min: number; max: number } | null
    /** Additional channel charts below the standard traces (remembered per user). */
    extraCharts: ExtraChart[]
    /** Laps collected for a comparison, possibly from several sessions (reference + MAX_COMPARE). */
    basket: CompareLap[]
    /** Reference picked in the basket; null = fastest lap. */
    basketRef: number | null
    setExtraCharts: (v: ExtraChart[]) => void
    select: (lapIds: number[], referenceLapId: number | null) => void
    setCursor: (m: number | null) => void
    setHoverChart: (key: string | null) => void
    setZoom: (z: { min: number; max: number } | null) => void
    toggleBasket: (lap: CompareLap) => void
    removeFromBasket: (lapId: number) => void
    clearBasket: () => void
    setBasketRef: (lapId: number | null) => void
}

export const useAnalysisStore = create<AnalysisState>(set => ({
    lapIds: [],
    referenceLapId: null,
    cursorM: null,
    hoverChart: null,
    zoom: null,
    extraCharts: loadExtra(),
    basket: [],
    basketRef: null,
    setExtraCharts: v => { saveExtra(v); set({ extraCharts: v }) },
    select: (lapIds, referenceLapId) => set({ lapIds, referenceLapId, cursorM: null, hoverChart: null, zoom: null }),
    setCursor: m => set({ cursorM: m }),
    setHoverChart: key => set({ hoverChart: key }),
    setZoom: z => set({ zoom: z }),
    toggleBasket: lap => set(s => (s.basket.some(l => l.lapId === lap.lapId)
        ? { basket: s.basket.filter(l => l.lapId !== lap.lapId) }
        : s.basket.length < MAX_COMPARE + 1 ? { basket: [...s.basket, lap] } : {})),
    removeFromBasket: lapId => set(s => ({ basket: s.basket.filter(l => l.lapId !== lapId) })),
    clearBasket: () => set({ basket: [], basketRef: null }),
    setBasketRef: lapId => set({ basketRef: lapId }),
}))
