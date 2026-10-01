import { formatDelta, formatLapTime } from '@shared/format'
import clsx from 'clsx'
import { AlertTriangle, LineChart, Star, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MAX_COMPARE, useAnalysisStore } from '../lib/analysisStore'
import { basketReference, mismatchedLaps } from '../lib/compare'
import { formatDateTime } from '../lib/format'
import { useChartPalette } from '../lib/theme'

/** Laps picked for a comparison, collected across sessions. Shown beside the sessions pages. */
export default function ComparePanel() {
    const basket = useAnalysisStore(s => s.basket)
    const chosenRef = useAnalysisStore(s => s.basketRef)
    const palette = useChartPalette()
    const { removeFromBasket, clearBasket, setBasketRef, select } = useAnalysisStore.getState()
    const navigate = useNavigate()
    if (basket.length === 0) return null

    const refId = basketReference(basket, chosenRef)
    const ref = basket.find(l => l.lapId === refId) ?? null
    const bad = mismatchedLaps(basket)
    const canCompare = basket.length >= 2 && bad.size === 0
    // Same colours the analysis view will use: reference first, then the others in basket order.
    const others = basket.filter(l => l.lapId !== refId)
    const colorOf = (lapId: number) => lapId === refId ? palette.reference : palette.laps[others.findIndex(l => l.lapId === lapId) % palette.laps.length]!

    function compare() {
        if (!canCompare || refId === null) return
        select([refId, ...basket.map(l => l.lapId).filter(id => id !== refId)], refId)
        navigate('/analysis')
    }

    return (
        <aside aria-label="Compare" className="w-80 shrink-0 border-l border-edge bg-panel flex flex-col">
            <div className="px-5 pt-7 pb-4 flex items-baseline gap-2.5">
                <h2 className="font-display text-xl font-semibold text-fg-strong" style={{ fontStretch: '118%' }}>Compare</h2>
                <span className="num text-xs text-fg-subtle">{basket.length} / {MAX_COMPARE + 1} laps</span>
                <button className="ml-auto text-[13px] text-fg-muted hover:text-fg" onClick={clearBasket}>Clear</button>
            </div>
            <ul className="flex-1 overflow-y-auto px-3 flex flex-col gap-2">
                {basket.map(l => {
                    const isRef = l.lapId === refId
                    const wrong = bad.has(l.lapId)
                    return (
                        <li key={l.lapId} className={clsx('flex gap-3 rounded-xl border p-3',
                            wrong ? 'border-danger-fg/60 bg-danger-bg' : 'border-edge bg-raised')}>
                            <span className="w-1 self-stretch rounded-full" style={{ background: colorOf(l.lapId) }} />
                            <div className="min-w-0 flex-1 flex flex-col gap-1">
                                <div className="flex items-baseline gap-2">
                                    <span className={clsx('num text-base font-semibold', l.isValid ? 'text-fg-strong' : 'text-fg-faint line-through')}>{formatLapTime(l.lapTimeMs)}</span>
                                    {isRef
                                        ? <span className="text-xs text-fg-subtle">reference</span>
                                        : ref?.lapTimeMs != null && l.lapTimeMs !== null && (
                                            <span className={clsx('num text-xs', l.lapTimeMs > ref.lapTimeMs ? 'text-loss-fg' : 'text-gain-fg')}>{formatDelta(l.lapTimeMs - ref.lapTimeMs)}</span>
                                        )}
                                </div>
                                <div className={clsx('truncate text-xs', wrong ? 'text-danger-fg' : 'text-fg-soft')} title={l.trackLayout ?? l.track ?? ''}>
                                    {l.trackLayout ?? l.track ?? '—'}
                                </div>
                                <div className="truncate text-xs text-fg-subtle" title={l.car ?? ''}>{l.car ?? '—'}</div>
                                <div className="text-xs text-fg-subtle">
                                    {[l.sessionType, `lap ${l.lapNumber}`, l.recordedAt && formatDateTime(l.recordedAt)].filter(Boolean).join(' · ')}
                                </div>
                            </div>
                            <div className="flex flex-col items-center gap-0.5">
                                <button aria-label={isRef ? 'Reference lap' : 'Use as reference'} title={isRef ? 'Reference lap' : 'Use as reference'} onClick={() => setBasketRef(l.lapId)}
                                    className={clsx('btn-icon', isRef && 'text-accent hover:text-accent')}>
                                    <Star size={15} fill={isRef ? 'currentColor' : 'none'} />
                                </button>
                                <button aria-label="Remove from comparison" title="Remove" className="btn-icon" onClick={() => removeFromBasket(l.lapId)}><X size={14} /></button>
                            </div>
                        </li>
                    )
                })}
                <li className="px-2 pt-1 text-xs leading-relaxed text-fg-subtle">The starred lap is the reference. Tick laps in any session of the same track and layout.</li>
            </ul>
            <div className="p-5 flex flex-col gap-3 border-t border-edge">
                {bad.size > 0 && (
                    <p className="flex gap-1.5 text-xs text-danger-fg">
                        <AlertTriangle size={13} className="shrink-0 mt-px" />
                        Laps on a different track or layout can't be compared. Remove the highlighted laps.
                    </p>
                )}
                {bad.size === 0 && basket.length < 2 && <p className="text-xs text-fg-subtle">Tick at least one more lap — from this or another session of the same track.</p>}
                <button className="btn-primary h-11 w-full" disabled={!canCompare} onClick={compare}>
                    <LineChart size={16} /> Compare {basket.length} laps
                </button>
            </div>
        </aside>
    )
}
