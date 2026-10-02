import type { AnalysisResult, ChannelOption, CornerInfo, LapAnalysis, LapConditions } from '@shared/analysis'
import { formatDelta, formatLapTime } from '@shared/format'
import clsx from 'clsx'
import { LineChart, Loader2, Plus, X, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CornerMap from '../components/analysis/CornerMap'
import TraceChart, { type TraceSeries } from '../components/analysis/TraceChart'
import TrackMap from '../components/analysis/TrackMap'
import EmptyState from '../components/EmptyState'
import { WHEELS, useAnalysisStore, type ExtraChart } from '../lib/analysisStore'
import { channelLimit, channelUses, freeWheel } from '../lib/compare'
import { deltaAt, matchCorner } from '../lib/corners'
import { formatDateTime } from '../lib/format'
import { useChartPalette } from '../lib/theme'
import { callWorker } from '../lib/worker'

type Tab = 'traces' | 'corners' | 'corner map'

export default function AnalysisPage() {
    const lapIds = useAnalysisStore(s => s.lapIds)
    const referenceLapId = useAnalysisStore(s => s.referenceLapId)
    const extraCharts = useAnalysisStore(s => s.extraCharts)
    const extraNames = useMemo(() => [...new Set(extraCharts.map(e => e.channel))].sort().join('|'), [extraCharts])
    const palette = useChartPalette()
    const [result, setResult] = useState<AnalysisResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [tab, setTab] = useState<Tab>('traces')

    useEffect(() => {
        if (lapIds.length === 0) return
        let cancelled = false
        setError(null)
        callWorker('analyseLaps', { lapIds, referenceLapId, extraChannels: extraNames ? extraNames.split('|') : [] })
            .then(r => { if (!cancelled) setResult(r) })
            .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
        return () => { cancelled = true }
    }, [lapIds, referenceLapId, extraNames])

    // A new selection starts empty; adding a channel keeps the old charts until the new data arrives.
    useEffect(() => { setResult(null) }, [lapIds, referenceLapId])

    const colors = useMemo(
        () => (result?.laps ?? []).map((_, i) => (i === 0 ? palette.reference : palette.laps[(i - 1) % palette.laps.length]!)),
        [result, palette],
    )

    if (lapIds.length === 0) {
        return (
            <EmptyState icon={<LineChart size={28} />} title="Nothing to analyse">
                <p>Open a <Link to="/sessions" className="text-accent hover:text-accent-hover">session</Link> and click a lap time — it is compared against your reference lap.</p>
            </EmptyState>
        )
    }
    if (error) return <p className="p-6 text-sm text-danger-fg">{error}</p>
    if (!result) return <div className="h-full flex items-center justify-center text-fg-subtle"><Loader2 className="animate-spin" size={20} /></div>

    function showCorner(c: CornerInfo) {
        useAnalysisStore.getState().setZoom({ min: Math.max(0, (c.brakeM ?? c.entryM) - 150), max: c.exitM + 150 })
        setTab('traces')
    }

    return (
        <div className="h-full flex flex-col">
            <header className="px-7 pt-5 pb-4 border-b border-line flex flex-col gap-3.5">
                <div className="flex items-center gap-3.5">
                    <h1 className="page-title text-[28px]">{result.laps[0]!.track}</h1>
                    <span className="text-[13px] text-fg-muted">{result.laps[0]!.car}</span>
                    <div role="tablist" aria-label="Analysis view" className="segmented ml-auto">
                        {(['traces', 'corners', 'corner map'] as const).map(t => (
                            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('segment', tab === t && 'segment-on')}>
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {result.laps.map((l, i) => <LapChip key={l.lapId} lap={l} color={colors[i]!} isRef={i === 0} refTime={result.laps[0]!.lapTimeMs} />)}
                </div>
            </header>
            {tab === 'traces' && <Traces result={result} colors={colors} />}
            {tab === 'corners' && <Corners result={result} colors={colors} onPick={showCorner} />}
            {tab === 'corner map' && <CornerMap result={result} colors={colors} />}
        </div>
    )
}

function LapChip({ lap, color, isRef, refTime }: { lap: LapAnalysis; color: string; isRef: boolean; refTime: number | null }) {
    const delta = !isRef && refTime !== null && lap.lapTimeMs !== null ? lap.lapTimeMs - refTime : null
    return (
        <span className="flex h-10 items-center gap-2.5 rounded-lg border border-edge bg-field pl-2.5 pr-3.5 text-xs">
            <span className="h-[3px] w-4 rounded-full" style={{ background: color }} />
            <span className="num text-sm font-semibold text-fg-strong">{formatLapTime(lap.lapTimeMs)}</span>
            {isRef
                ? <span className="text-fg-subtle">reference</span>
                : delta !== null && <span className={clsx('num', delta > 0 ? 'text-loss-fg' : 'text-gain-fg')}>{formatDelta(delta)}</span>}
            <span className="text-fg-subtle">
                {lap.sessionType} · lap {lap.lapNumber}{lap.recordedAt ? ` · ${formatDateTime(lap.recordedAt)}` : ''}
            </span>
        </span>
    )
}

// ── Traces ───────────────────────────────────────────────────────────────────

const pct = (v: number) => `${Math.round(v)}`

/** Value of a chart at a grid index, for the readout's fifth column. */
interface Reader {
    label: string
    get: (l: LapAnalysis, i: number) => number | null
    format: (v: number) => string
}

const at = (arr: Float32Array | null | undefined, i: number) => (arr && i >= 0 && i < arr.length ? arr[i]! : null)

function formatAuto(v: number): string {
    const a = Math.abs(v)
    return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)
}

function Traces({ result, colors }: { result: AnalysisResult; colors: string[] }) {
    const extraCharts = useAnalysisStore(s => s.extraCharts)
    const setExtraCharts = useAnalysisStore(s => s.setExtraCharts)
    const zoom = useAnalysisStore(s => s.zoom)
    const charts = useMemo(() => {
        const laps = result.laps
        const longest = laps.reduce((a, l) => (l.distM.length > a.distM.length ? l : a), laps[0]!)
        const x = Array.from(longest.distM)
        const pad = (arr: Float32Array | null, scale = 1) => x.map((_, i) => (arr && i < arr.length ? arr[i]! * scale : null))
        const series = (pick: (l: LapAnalysis) => Float32Array, scale = 1): TraceSeries[] =>
            laps.map((l, i) => ({ label: `${l.lapNumber}`, color: colors[i]!, values: pad(pick(l), scale), width: i === 0 ? 1.5 : 1.25 }))
        const delta: TraceSeries[] = laps.slice(1).map((l, i) => ({ label: `${l.lapNumber}`, color: colors[i + 1]!, values: pad(l.deltaMs, 0.001), width: 1.5 }))
        const extra = extraCharts.map(e => {
            const info = result.channels.find(c => c.name === e.channel)
            const pick = (l: LapAnalysis) => l.extra[e.channel]?.[e.wheel] ?? l.extra[e.channel]?.[0] ?? null
            return {
                ...e,
                info,
                label: `${e.channel}${info?.wheels ? ` ${WHEELS[e.wheel]}` : ''}`,
                pick,
                series: laps.map((l, i) => ({ label: `${l.lapNumber}`, color: colors[i]!, width: i === 0 ? 1.5 : 1.25, values: pad(pick(l)) })),
            }
        })
        return {
            x,
            extra,
            delta,
            speed: series(l => l.speed),
            throttle: series(l => l.throttle, 100),
            brake: series(l => l.brake, 100),
            steer: series(l => l.steer),
            gear: series(l => l.gear),
        }
    }, [result, colors, extraCharts])

    // Speed, throttle, brake and delta are fixed readout columns; any other chart can be the fifth.
    const readers = useMemo(() => {
        const r: Record<string, Reader> = {
            steer: { label: 'Steer', get: (l, i) => at(l.steer, i), format: v => v.toFixed(0) },
            gear: { label: 'Gear', get: (l, i) => at(l.gear, i), format: v => v.toFixed(0) },
        }
        charts.extra.forEach((e, k) => { r[`extra:${k}`] = { label: e.label, get: (l, i) => at(e.pick(l), i), format: formatAuto } })
        return r
    }, [charts])

    const mapLaps = useMemo(() => result.laps.map((l, i) => ({ color: colors[i]!, x: l.mapX, y: l.mapY })), [result, colors])
    const r100: [number, number] = useMemo(() => [0, 100], [])
    const rSteer: [number, number] = useMemo(() => [-100, 100], [])

    function addChannel(c: ChannelOption) {
        if (channelUses(extraCharts, c.name) >= channelLimit(c)) return
        setExtraCharts([...extraCharts, { channel: c.name, wheel: freeWheel(extraCharts, c.name) }])
    }

    return (
        <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pb-5 space-y-2">
                <div className="sticky top-0 z-20 h-10 flex items-center justify-end bg-canvas/90">
                    {zoom && (
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => useAnalysisStore.getState().setZoom(null)} title="Show the whole lap (same as double-clicking a chart)">
                            <ZoomOut size={14} /> Whole lap
                            <span className="num text-fg-subtle">{Math.round(zoom.min)}–{Math.round(zoom.max)} m</span>
                        </button>
                    )}
                </div>
                {charts.delta.length > 0 && <TraceChart title="Delta (s)" readKey="delta" x={charts.x} series={charts.delta} height={110} zeroLine formatY={v => v.toFixed(1)} />}
                <TraceChart title="Speed (km/h)" readKey="speed" x={charts.x} series={charts.speed} height={170} />
                <TraceChart title="Throttle (%)" readKey="throttle" x={charts.x} series={charts.throttle} height={90} yRange={r100} formatY={pct} />
                <TraceChart title="Brake (%)" readKey="brake" x={charts.x} series={charts.brake} height={90} yRange={r100} formatY={pct} />
                <TraceChart title="Steering (%)" readKey="steer" x={charts.x} series={charts.steer} height={100} yRange={rSteer} zeroLine formatY={pct} />
                <TraceChart title="Gear" readKey="gear" x={charts.x} series={charts.gear} height={charts.extra.length ? 80 : 104} stepped showX={charts.extra.length === 0} />
                {charts.extra.map((e, k) => {
                    const takenWheels = new Set(charts.extra.filter((o, j) => j !== k && o.channel === e.channel).map(o => o.wheel))
                    return (
                        <div key={`${e.channel}#${k}`} className="relative">
                            <div className="absolute right-1 -top-1 z-10 flex items-center gap-0.5 text-[11px]">
                                {e.info?.wheels && WHEELS.map((w, wi) => (
                                    <button key={w} disabled={takenWheels.has(wi)} title={takenWheels.has(wi) ? `${w} is already shown` : undefined}
                                        aria-pressed={e.wheel === wi}
                                        onClick={() => setExtraCharts(extraCharts.map((x, j) => (j === k ? { ...x, wheel: wi } : x)))}
                                        className={clsx('h-6 min-w-7 rounded px-1.5 font-semibold disabled:cursor-not-allowed disabled:text-fg-ghost/50',
                                            e.wheel === wi ? 'bg-selected text-fg-strong' : 'text-fg-subtle hover:text-fg')}>{w}</button>
                                ))}
                                <button aria-label="Remove chart" title="Remove chart" className="ml-1 flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-active hover:text-fg"
                                    onClick={() => setExtraCharts(extraCharts.filter((_, j) => j !== k))}><X size={12} /></button>
                            </div>
                            <TraceChart title={`${e.channel}${e.info?.wheels ? ` · ${WHEELS[e.wheel]}` : ''}${e.info?.unit ? ` (${e.info.unit})` : ''}`} readKey={`extra:${k}`}
                                x={charts.x} series={e.series} height={k === charts.extra.length - 1 ? 114 : 90} showX={k === charts.extra.length - 1} />
                        </div>
                    )
                })}
                <div className="flex items-center gap-3 px-1 pt-2">
                    <ChannelPicker channels={result.channels} charts={extraCharts} onPick={addChannel} />
                    <p className="text-xs text-fg-faint">Distance from the finish line · drag to zoom · double-click or “Whole lap” to reset</p>
                </div>
            </div>
            <aside className="w-[340px] shrink-0 border-l border-line p-4 flex flex-col gap-3.5 overflow-y-auto">
                <section aria-label="Track map" className="h-64 shrink-0 rounded-xl border border-edge bg-well p-2"><TrackMap laps={mapLaps} stepM={result.laps[0]!.stepM} /></section>
                <Readout result={result} colors={colors} readers={readers} />
                <Conditions laps={result.laps} colors={colors} />
            </aside>
        </div>
    )
}

const CORE_CHANNELS = new Set(['Ground Speed', 'Throttle Pos', 'Brake Pos', 'Steering Pos', 'Lap Dist', 'GPS Latitude', 'GPS Longitude', 'GPS Time'])

/** Adds any recorded channel (tyres, brakes, fuel, suspension, …) as an extra synced chart — once, or once per wheel. */
function ChannelPicker({ channels, charts, onPick }: { channels: ChannelOption[]; charts: ExtraChart[]; onPick: (c: ChannelOption) => void }) {
    const [open, setOpen] = useState(false)
    const box = useRef<HTMLDivElement>(null)
    const options = channels.filter(c => !CORE_CHANNELS.has(c.name))

    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('mousedown', onDown)
            window.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={box} className="relative">
            <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="btn-ghost h-9 px-3 text-[13px]">
                <Plus size={14} /> Channel
            </button>
            {open && (
                <ul className="absolute bottom-full left-0 mb-1.5 z-30 w-80 max-h-80 overflow-y-auto rounded-xl border border-edge-strong bg-raised p-1.5 shadow-xl">
                    {options.map(c => {
                        const used = channelUses(charts, c.name)
                        const full = used >= channelLimit(c)
                        return (
                            <li key={c.name}>
                                <button disabled={full} onClick={() => { onPick(c); setOpen(false) }}
                                    className="flex h-[34px] w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-fg-soft hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-ghost disabled:hover:bg-transparent">
                                    <span className="truncate">{c.name}</span>
                                    {c.unit && <span className="text-fg-faint">{c.unit}</span>}
                                    <span className="num ml-auto whitespace-nowrap text-[11px] text-fg-faint">{c.wheels ? `${used}/4 wheels` : full ? 'added' : ''}</span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

function Readout({ result, colors, readers }: { result: AnalysisResult; colors: string[]; readers: Record<string, Reader> }) {
    const cursorM = useAnalysisStore(s => s.cursorM)
    const hoverChart = useAnalysisStore(s => s.hoverChart)
    const extra = hoverChart ? readers[hoverChart] : undefined
    const i = cursorM == null ? -1 : Math.round(cursorM / result.laps[0]!.stepM)
    const val = (v: number | null, f: (v: number) => string) => (v === null ? '—' : f(v))
    return (
        <section aria-label="Values at cursor" className="rounded-xl border border-edge bg-well px-3.5 py-3 flex flex-col gap-2 text-xs">
            <div className="flex items-baseline gap-2">
                <span className="label text-fg-2">At cursor</span>
                <span className="num text-fg">{cursorM == null ? '' : `${Math.round(cursorM)} m`}</span>
                {extra && <span className="ml-auto truncate text-[11px] text-fg-muted" title={extra.label}>⑤ {extra.label}</span>}
            </div>
            {cursorM == null && <p className="text-fg-faint">Hover a chart to read values.</p>}
            <table className="w-full table-fixed">
                <thead>
                    <tr className="text-right">
                        <th className="w-4" />
                        <th className="label font-semibold">km/h</th>
                        <th className="label font-semibold">Thr</th>
                        <th className="label font-semibold">Brk</th>
                        <th className="label font-semibold">Δ</th>
                        {extra && <th className="label font-semibold pl-2" title={extra.label}>⑤</th>}
                    </tr>
                </thead>
                <tbody>
                    {result.laps.map((l, k) => {
                        const d = l.deltaMs ? at(l.deltaMs, i) : null
                        return (
                            <tr key={l.lapId} className="num text-right text-fg-2">
                                <td className="py-0.5 text-left"><span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[k] }} /></td>
                                <td className="text-fg">{val(at(l.speed, i), v => v.toFixed(0))}</td>
                                <td>{val(at(l.throttle, i), v => (v * 100).toFixed(0))}</td>
                                <td>{val(at(l.brake, i), v => (v * 100).toFixed(0))}</td>
                                <td className={clsx(d === null ? 'text-fg-faint' : d > 0 ? 'text-loss-fg' : 'text-gain-fg')}>{l.deltaMs ? val(d, v => formatDelta(v)) : ''}</td>
                                {extra && <td>{val(extra.get(l, i), extra.format)}</td>}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </section>
    )
}

interface ConditionRow {
    label: string
    get: (c: LapConditions) => number | string | null
    format: (v: number) => string
    /** Differences up to this are not highlighted (minutes for the time of day). */
    tolerance: number
}

const CONDITION_ROWS: ConditionRow[] = [
    { label: 'Time', get: c => c.timeOfDay, format: String, tolerance: 15 },
    { label: 'Track', get: c => c.trackTempC, format: v => `${v.toFixed(1)}°`, tolerance: 1 },
    { label: 'Air', get: c => c.airTempC, format: v => `${v.toFixed(1)}°`, tolerance: 1 },
    { label: 'Wet', get: c => c.wetnessPct, format: v => `${v.toFixed(0)}%`, tolerance: 2 },
    { label: 'Wind', get: c => c.windKmh, format: v => v.toFixed(0), tolerance: 3 },
]

/** "HH:MM" → minutes, so times of day compare numerically. */
const minutes = (v: number | string) => (typeof v === 'string' && /^\d\d:\d\d$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : v)

function differs(a: number | string | null, b: number | string | null, tolerance: number): boolean {
    if (a === null || b === null) return false
    const x = minutes(a)
    const y = minutes(b)
    if (typeof x !== 'number' || typeof y !== 'number') return x !== y
    const d = Math.abs(x - y)
    return (typeof a === 'string' ? Math.min(d, 1440 - d) : d) > tolerance
}

const HIGHLIGHT = 'rounded bg-warn-bg px-1 text-warn-fg'

/** In-game conditions per lap; values that differ noticeably from the reference are highlighted. */
function Conditions({ laps, colors }: { laps: LapAnalysis[]; colors: string[] }) {
    const ref = laps[0]!.conditions
    return (
        <section aria-label="Conditions" className="mt-auto shrink-0 rounded-xl border border-edge bg-well px-3.5 py-3 flex flex-col gap-2 text-xs">
            <div className="flex items-baseline gap-2"><span className="label text-fg-2">Conditions</span><span className="text-[11px] text-fg-faint">in-game · °C · km/h</span></div>
            <table className="w-full table-fixed">
                <thead>
                    <tr>
                        <th className="w-12" />
                        {laps.map((l, k) => <th key={l.lapId} className="text-right"><span className="inline-block w-2 h-2 rounded-full" style={{ background: colors[k] }} /></th>)}
                    </tr>
                </thead>
                <tbody>
                    {CONDITION_ROWS.map(r => (
                        <tr key={r.label} className="text-right">
                            <td className="py-0.5 text-left text-fg-subtle">{r.label}</td>
                            {laps.map((l, k) => {
                                const v = r.get(l.conditions)
                                return (
                                    <td key={l.lapId} className="num">
                                        <span className={clsx(k > 0 && differs(v, r.get(ref), r.tolerance) ? HIGHLIGHT : 'text-fg-soft')}>
                                            {v === null ? '—' : typeof v === 'number' ? r.format(v) : v}
                                        </span>
                                    </td>
                                )
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <ul className="space-y-1 border-t border-line pt-2">
                {laps.map((l, k) => (
                    <li key={l.lapId} className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: colors[k] }} />
                        <span className={clsx('truncate', k > 0 && differs(l.conditions.weather, ref.weather, 0) ? HIGHLIGHT : 'text-fg-soft')}
                            title={l.conditions.weather ?? undefined}>
                            {l.conditions.weather ?? '—'}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="flex items-center gap-1.5 text-[11px] text-fg-faint"><span className="h-2 w-2 rounded-sm bg-warn-bg ring-1 ring-warn-fg" />Differs noticeably from the reference</p>
        </section>
    )
}

// ── Corners ──────────────────────────────────────────────────────────────────

/** Full bar width (each side of the centre line) in ms of time gained or lost in one corner. */
const BAR_SCALE_MS = 250

function Corners({ result, colors, onPick }: { result: AnalysisResult; colors: string[]; onPick: (c: CornerInfo) => void }) {
    const ref = result.laps[0]!
    const others = result.laps.slice(1)
    const cols = { gridTemplateColumns: `76px 72px 84px 84px 92px repeat(${Math.max(1, others.length)}, minmax(0, 1fr))` }
    return (
        <div className="flex-1 overflow-auto px-7 py-5 flex flex-col gap-3.5">
            <section aria-label="Corners" className="overflow-hidden rounded-xl border border-edge bg-well">
                <div className="grid items-end gap-4 border-b border-edge px-5 pt-3.5 pb-2.5" style={cols}>
                    <span className="label">Corner</span>
                    <span className="label text-right">Apex</span>
                    <span className="label text-right">Min km/h</span>
                    <span className="label text-right">Exit km/h</span>
                    <span className="label text-right">Brake at</span>
                    {others.map((l, i) => (
                        <span key={l.lapId} className="flex items-center gap-2">
                            <span className="h-[3px] w-3.5 rounded-full" style={{ background: colors[i + 1] }} />
                            <span className="label text-fg-soft">Lap {l.lapNumber}</span>
                            <span className="label ml-auto">min · time</span>
                        </span>
                    ))}
                </div>
                {ref.corners.map(c => (
                    <button key={c.number} type="button" title="Show in traces" onClick={() => onPick(c)}
                        className="grid h-[52px] w-full items-center gap-4 border-t border-row px-5 text-left hover:bg-hover" style={cols}>
                        <span className="flex items-baseline gap-1.5"><span className="num text-[15px] font-semibold text-fg">T{c.number}</span><span className="text-[11px] text-fg-subtle">{c.isLeft ? 'L' : 'R'}</span></span>
                        <span className="num text-right text-fg-muted">{Math.round(c.apexM)} m</span>
                        <span className="num text-right text-fg-strong">{c.minSpeedKmh.toFixed(0)}</span>
                        <span className="num text-right text-fg-2">{c.exitSpeedKmh.toFixed(0)}</span>
                        <span className="num text-right text-fg-muted">{c.brakeM !== null ? `${Math.round(c.brakeM)} m` : '—'}</span>
                        {others.map(l => {
                            const m = matchCorner(l.corners, c.apexM)
                            if (!m) return <span key={l.lapId} className="text-fg-faint">—</span>
                            const dIn = deltaAt(l, Math.min(c.entryM, c.brakeM ?? c.entryM))
                            const dOut = deltaAt(l, c.exitM)
                            const lost = dIn !== null && dOut !== null ? dOut - dIn : null
                            const dMin = m.minSpeedKmh - c.minSpeedKmh
                            const w = lost === null ? 0 : Math.min(50, Math.abs(lost) / BAR_SCALE_MS * 50)
                            return (
                                <span key={l.lapId} className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2.5">
                                    <span className={clsx('num text-right text-xs', Math.round(dMin) === 0 ? 'text-fg-faint' : dMin > 0 ? 'text-gain-fg' : 'text-loss-fg')}>
                                        {dMin >= 0 ? '+' : '−'}{Math.abs(dMin).toFixed(0)}
                                    </span>
                                    <span className="relative h-3.5">
                                        <span className="absolute inset-y-0 left-1/2 w-px bg-edge-strong" />
                                        {lost !== null && (
                                            <span className={clsx('absolute top-[3px] h-2 rounded-sm', lost > 0 ? 'left-1/2 bg-loss' : 'right-1/2 bg-gain')} style={{ width: `${w}%` }} />
                                        )}
                                    </span>
                                    <span className={clsx('num text-right text-xs', lost === null ? 'text-fg-faint' : lost > 0 ? 'text-loss-fg' : 'text-gain-fg')}>
                                        {lost === null ? '—' : formatDelta(lost)}
                                    </span>
                                </span>
                            )
                        })}
                    </button>
                ))}
            </section>
            <p className="max-w-3xl text-xs leading-relaxed text-fg-subtle">
                Corners are detected from the speed trace of the reference lap. Per compared lap: minimum-speed difference (km/h) and
                time gained or lost from braking to corner exit — bars to the right lose time, to the left gain. Click a corner to open the traces zoomed to it.
            </p>
        </div>
    )
}
