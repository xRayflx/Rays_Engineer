import type { AnalysisResult, LapAnalysis } from '@shared/analysis'
import { formatDelta, formatLapTime, formatSectorTime } from '@shared/format'
import clsx from 'clsx'
import { BarChart3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { chronological, lapTimeStats, mean, median, MINI_SECTORS, miniSectorTimes, stdDev, WITHIN_MS, type LapTimeStats } from '../../lib/consistency'
import { cornerLapStats, type CornerLapStats } from '../../lib/corners'
import EmptyState from '../EmptyState'

const fmt = (v: number) => v.toFixed(1)
const sign = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

/** How consistent the compared laps are: lap times, sectors, mini-sectors and corners. */
export default function Consistency({ result }: { result: AnalysisResult }) {
    const laps = result.laps
    const [selId, setSelId] = useState(laps[0]!.lapId)
    const order = useMemo(() => chronological(laps), [laps])
    const stats = useMemo(() => lapTimeStats(laps.flatMap(l => (l.lapTimeMs === null ? [] : [l.lapTimeMs]))), [laps])

    if (laps.length < 2 || !stats) {
        return (
            <EmptyState icon={<BarChart3 size={28} />} title="Compare more laps">
                <p>Consistency needs at least two laps. Add laps from a session to the comparison.</p>
            </EmptyState>
        )
    }

    return (
        <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pt-4 pb-5 flex flex-col gap-3">
                <Kpis stats={stats} bestLap={laps.find(l => l.lapTimeMs === stats.best)!} />
                <LapTimeChart order={order} stats={stats} selId={selId} onPick={setSelId} />
                <SectorPanel laps={laps} order={order} selId={selId} />
                <CornerPanel laps={laps} selId={selId} />
            </div>
            <aside className="w-[340px] shrink-0 border-l border-line p-4 flex flex-col gap-3 overflow-y-auto">
                <LapList order={order} best={stats.best} selId={selId} onPick={setSelId} />
                <Distribution laps={laps} best={stats.best} />
            </aside>
        </div>
    )
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Panel({ label, title, hint, actions, children, className }: {
    label: string
    title: string
    hint?: string
    actions?: React.ReactNode
    children: React.ReactNode
    className?: string
}) {
    return (
        <section aria-label={label} className={clsx('rounded-xl border border-edge bg-well', className)}>
            <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2.5 min-h-[52px]">
                <span className="label text-fg-2">{title}</span>
                {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
                {actions && <div className="ml-auto">{actions}</div>}
            </div>
            {children}
        </section>
    )
}

function Segmented<K extends string>({ label, options, value, onChange }: { label: string; options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
    return (
        <div role="tablist" aria-label={label} className="segmented p-0.5">
            {options.map(o => (
                <button key={o.key} role="tab" aria-selected={o.key === value} onClick={() => onChange(o.key)}
                    className={clsx('segment h-7 text-xs normal-case', o.key === value && 'segment-on')}>{o.label}</button>
            ))}
        </div>
    )
}

/** σ as a number plus a bar against the largest σ in the table; the most scattered rows turn orange. */
function SigmaBar({ value, max, digits, wide = false }: { value: number; max: number; digits: number; wide?: boolean }) {
    const share = max > 0 ? value / max : 0
    return (
        <span className="flex items-center gap-2.5">
            <span className={clsx('num text-right text-[13px] font-semibold text-fg-strong', wide ? 'w-12' : 'w-10')}>{value.toFixed(digits)}</span>
            <span className="flex h-1.5 flex-1 rounded-full bg-row">
                <span className={clsx('h-1.5 rounded-full', share > 0.66 ? 'bg-loss' : 'bg-track')} style={{ width: `${share * 100}%` }} />
            </span>
        </span>
    )
}

interface Dot {
    id: number
    pos: number
    selected: boolean
    best?: boolean
    hollow?: boolean
}

/** One dot per lap on a horizontal strip; pos is 0–100 %. */
function Strip({ dots, center }: { dots: Dot[]; center?: boolean }) {
    const sorted = [...dots].sort((a, b) => Number(a.selected) - Number(b.selected))
    return (
        <span className="relative block h-6">
            <span className="absolute inset-x-0 top-[11px] h-0.5 bg-row" />
            <span className={clsx('absolute top-1 h-4 w-px bg-track', center ? 'left-1/2' : 'left-0')} />
            {sorted.map(d => (
                <span key={d.id} className={clsx('absolute rounded-full',
                    d.selected ? 'top-1.5 -ml-1.5 h-3 w-3 bg-accent ring-2 ring-well'
                        : d.hollow ? 'top-2 -ml-1 h-2 w-2 ring-[1.5px] ring-inset ring-fg-faint'
                            : clsx('top-2 -ml-1 h-2 w-2', d.best ? 'bg-best' : 'bg-fg-faint'))}
                    style={{ left: `${Math.max(0, Math.min(100, d.pos))}%` }} />
            ))}
        </span>
    )
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

function Kpis({ stats, bestLap }: { stats: LapTimeStats; bestLap: LapAnalysis }) {
    const tiles = [
        { label: 'Best lap', value: formatLapTime(stats.best), sub: `lap ${bestLap.lapNumber}`, best: true },
        { label: 'Average', value: formatLapTime(stats.average), sub: `${formatDelta(stats.average - stats.best)} to best` },
        { label: 'Std deviation', value: `${(stats.sd / 1000).toFixed(3)} s`, sub: `σ over ${stats.count} laps` },
        { label: 'Spread', value: `${((stats.worst - stats.best) / 1000).toFixed(3)} s`, sub: 'best to worst' },
        { label: `Within ${WITHIN_MS / 1000} s`, value: `${stats.within} / ${stats.count}`, sub: `${Math.round(stats.within / stats.count * 100)}% of laps` },
    ]
    return (
        <div className="grid grid-cols-5 gap-3">
            {tiles.map(t => (
                <section key={t.label} aria-label={t.label} className="rounded-xl border border-edge bg-well px-4 py-3.5 flex flex-col gap-1.5">
                    <span className="label">{t.label}</span>
                    <span className={clsx('num text-[22px] font-semibold leading-tight', t.best ? 'text-best' : 'text-fg-strong')}>{t.value}</span>
                    <span className="text-xs text-fg-faint">{t.sub}</span>
                </section>
            ))}
        </div>
    )
}

// ── Lap time chart ───────────────────────────────────────────────────────────

function tickLabel(ms: number, step: number): string {
    const m = Math.floor(ms / 60_000)
    const s = (ms % 60_000) / 1000
    const digits = step < 1000 ? 1 : 0
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(digits)}`
}

// Full class names so Tailwind finds them.
const DOT_FILL = { accent: 'fill-accent', best: 'fill-best', muted: 'fill-fg-muted' }
const DOT_STROKE = { accent: 'stroke-accent', best: 'stroke-best', muted: 'stroke-fg-muted' }

function LapTimeChart({ order, stats, selId, onPick }: { order: LapAnalysis[]; stats: LapTimeStats; selId: number; onPick: (id: number) => void }) {
    const W = 1000, PL = 64, PR = 16, PT = 14, PB = 200
    const lo = stats.best - 400
    const hi = stats.worst + 300
    const X = (i: number) => PL + 20 + (order.length > 1 ? i / (order.length - 1) : 0.5) * (W - PL - PR - 40)
    const Y = (ms: number) => PB - (ms - lo) / (hi - lo) * (PB - PT)
    const step = [250, 500, 1000, 2000, 5000].find(s => (hi - lo) / s <= 5) ?? 10_000
    const ticks: number[] = []
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
    const points = order.map((l, i) => ({ l, x: X(i), y: l.lapTimeMs === null ? null : Y(l.lapTimeMs) }))
    const line = points.filter(p => p.y !== null).map((p, k) => `${k ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y!)}`).join('')

    return (
        <Panel label="Lap times" title="Lap times" actions={
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-fg-subtle">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 border-y border-dashed border-track bg-fg/5" />average ± σ</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full ring-[1.5px] ring-inset ring-fg-subtle" />invalid</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-best" />best</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />selected</span>
            </div>
        }>
            <svg viewBox={`0 0 ${W} 226`} className="block h-auto w-full px-2 pb-1 font-mono text-[11px]" role="img" aria-label="Lap time per lap with the average and one standard deviation">
                <rect x={PL} width={W - PL - PR} y={Y(stats.average + stats.sd)} height={Y(stats.average - stats.sd) - Y(stats.average + stats.sd)} className="fill-fg/5" />
                <line x1={PL} x2={W - PR} y1={Y(stats.average + stats.sd)} y2={Y(stats.average + stats.sd)} className="stroke-track" strokeDasharray="4 4" />
                <line x1={PL} x2={W - PR} y1={Y(stats.average - stats.sd)} y2={Y(stats.average - stats.sd)} className="stroke-track" strokeDasharray="4 4" />
                <line x1={PL} x2={W - PR} y1={Y(stats.average)} y2={Y(stats.average)} className="stroke-fg-ghost" />
                {ticks.map(t => <text key={t} x={PL - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" className="fill-fg-faint">{tickLabel(t, step)}</text>)}
                <path d={line} fill="none" className="stroke-track" strokeWidth={1.5} />
                {points.map(({ l, x, y }) => {
                    const sel = l.lapId === selId
                    const best = l.lapTimeMs === stats.best
                    const tone = sel ? 'accent' : best ? 'best' : 'muted'
                    return (
                        <g key={l.lapId} onClick={() => onPick(l.lapId)} className="cursor-pointer">
                            {y !== null && (
                                <circle cx={x} cy={y} r={sel || best ? 6 : 4.5} strokeWidth={2}
                                    className={l.isValid ? `${DOT_FILL[tone]} stroke-well` : `fill-well ${DOT_STROKE[tone]}`} />
                            )}
                            {y !== null && (sel || best) && (
                                <text x={x} y={y - 12} textAnchor="middle" className={clsx('font-semibold', sel ? 'fill-accent' : 'fill-best')}>{formatLapTime(l.lapTimeMs)}</text>
                            )}
                            <text x={x} y={220} textAnchor="middle" className={sel ? 'fill-accent' : 'fill-fg-faint'}>{l.lapNumber}</text>
                        </g>
                    )
                })}
            </svg>
        </Panel>
    )
}

// ── Sectors ──────────────────────────────────────────────────────────────────

type SectorView = 'sectors' | 'mini'

function SectorPanel({ laps, order, selId }: { laps: LapAnalysis[]; order: LapAnalysis[]; selId: number }) {
    const [view, setView] = useState<SectorView>('sectors')
    const minis = useMemo(() => {
        const times = miniSectorTimes(order)
        const n = times[0]?.length ?? 0
        const best = Array.from({ length: n }, (_, j) => Math.min(...times.map(t => t[j]!)))
        const sd = Array.from({ length: n }, (_, j) => stdDev(times.map(t => t[j]!)))
        return { times, best, sd }
    }, [order])

    const sectorBests = [0, 1, 2].map(s => {
        const v = laps.flatMap(l => (l.sectorMs[s] == null ? [] : [l.sectorMs[s]!]))
        return v.length ? Math.min(...v) : null
    })
    const theoSectors = sectorBests.every(v => v !== null) ? sectorBests.reduce((a, v) => a! + v!, 0)! : null
    const theoMini = minis.best.length ? minis.best.reduce((a, v) => a + v, 0) : null
    const bestLap = Math.min(...laps.flatMap(l => (l.lapTimeMs === null ? [] : [l.lapTimeMs])))

    return (
        <Panel label="Sector consistency" title="Sector consistency"
            hint={view === 'sectors' ? 'time per sector, relative to the best of the compared laps' : 'time lost per mini-sector against the best of the compared laps'}
            actions={<Segmented label="Sector split" value={view} onChange={setView} options={[{ key: 'sectors', label: 'Sectors' }, { key: 'mini', label: 'Mini-sectors' }]} />}>
            {view === 'sectors' ? <SectorRows laps={laps} selId={selId} /> : <MiniHeatmap order={order} minis={minis} selId={selId} lapLengthM={(laps[0]!.distM.length - 1) * laps[0]!.stepM} />}
            <div className="flex flex-wrap gap-6 border-t border-row px-4 pt-2.5 pb-3 text-xs text-fg-faint">
                <span>Theoretical best · sectors <span className="num text-best">{formatLapTime(theoSectors)}</span></span>
                <span>mini-sectors <span className="num text-best">{formatLapTime(theoMini)}</span></span>
                <span>best lap <span className="num text-fg-soft">{formatLapTime(bestLap)}</span></span>
            </div>
        </Panel>
    )
}

const SECTOR_COLS = 'grid grid-cols-[64px_84px_84px_150px_minmax(0,1fr)_72px] gap-4'

function SectorRows({ laps, selId }: { laps: LapAnalysis[]; selId: number }) {
    const rows = [0, 1, 2].map(s => {
        const vals = laps.flatMap(l => (l.sectorMs[s] == null ? [] : [{ lap: l, t: l.sectorMs[s]! }]))
        const ts = vals.map(v => v.t)
        const best = ts.length ? Math.min(...ts) : null
        return { s, vals, best, avg: ts.length ? mean(ts) : null, sd: stdDev(ts), spread: best === null ? null : Math.max(...ts) - best }
    })
    const maxSd = Math.max(...rows.map(r => r.sd))
    // Strip scale: the largest spread, rounded up to 0.2 s.
    const stripMax = Math.max(200, Math.ceil(Math.max(...rows.map(r => r.spread ?? 0)) / 200) * 200)
    return (
        <div className="pb-1">
            <div className={clsx(SECTOR_COLS, 'items-end px-4 pt-2.5 pb-1.5')}>
                <span className="label">Sector</span>
                <span className="label text-right">Best</span>
                <span className="label text-right">Average</span>
                <span className="label">σ s</span>
                <span className="num flex justify-between text-[11px] text-fg-faint"><span>best</span><span>+{(stripMax / 1000).toFixed(1)} s</span></span>
                <span className="label text-right">Spread</span>
            </div>
            {rows.map(r => (
                <div key={r.s} className={clsx(SECTOR_COLS, 'h-[46px] items-center border-t border-row px-4')}>
                    <span className="num text-[15px] font-semibold text-fg">S{r.s + 1}</span>
                    <span className="num text-right text-[13px] font-semibold text-best">{formatSectorTime(r.best)}</span>
                    <span className="num text-right text-[13px] text-fg-soft">{formatSectorTime(r.avg)}</span>
                    {r.vals.length > 1 ? <SigmaBar value={r.sd / 1000} max={maxSd / 1000} digits={3} wide /> : <span className="text-fg-faint">—</span>}
                    <Strip dots={r.vals.map(v => ({ id: v.lap.lapId, pos: (v.t - r.best!) / stripMax * 100, selected: v.lap.lapId === selId, best: v.t === r.best }))} />
                    <span className="num text-right text-xs text-fg-muted">{r.spread === null ? '—' : `+${(r.spread / 1000).toFixed(3)}`}</span>
                </div>
            ))}
            {rows.some(r => r.vals.length < laps.length) && (
                <p className="px-4 pt-1.5 pb-1 text-[11px] text-fg-faint">Laps without a valid sector time from LMU are left out of that sector.</p>
            )}
        </div>
    )
}

/** Mini-sector cells reach full colour at this much time lost. */
const HEAT_FULL_MS = 80
const HEAT_COLS = 'grid grid-cols-[60px_minmax(0,1fr)_72px] gap-3'

function MiniHeatmap({ order, minis, selId, lapLengthM }: {
    order: LapAnalysis[]
    minis: { times: number[][]; best: number[]; sd: number[] }
    selId: number
    lapLengthM: number
}) {
    if (!minis.best.length) return <p className="px-4 py-4 text-xs text-fg-faint">The laps are too short to split into mini-sectors.</p>
    const maxSd = Math.max(...minis.sd)
    const grid = { gridTemplateColumns: `repeat(${MINI_SECTORS}, minmax(0, 1fr))` }
    return (
        <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
            <div className={clsx(HEAT_COLS, 'items-end')}>
                <span />
                <span className="num flex justify-between border-b border-edge-strong pb-1 text-[11px] text-fg-subtle">
                    {[0, 0.25, 0.5, 0.75, 1].map(f => <span key={f}>{Math.round(lapLengthM * f)} m</span>)}
                </span>
                <span className="label text-right">Lost</span>
            </div>
            {order.map((l, k) => {
                const sel = l.lapId === selId
                const times = minis.times[k]!
                const lost = times.reduce((a, t, j) => a + t - minis.best[j]!, 0)
                return (
                    <div key={l.lapId} className={clsx(HEAT_COLS, 'h-6 items-center')}>
                        <span className={clsx('text-xs', sel ? 'font-semibold text-accent' : 'text-fg-2')}>Lap {l.lapNumber}</span>
                        <span className={clsx('grid h-5 gap-[3px] rounded', sel && 'ring-2 ring-accent')} style={grid}>
                            {times.map((t, j) => {
                                const d = t - minis.best[j]!
                                const bg = d < 0.5 ? 'rgb(var(--c-best) / 0.85)' : `rgb(var(--c-loss-fg) / ${(0.12 + 0.83 * Math.min(1, d / HEAT_FULL_MS)).toFixed(2)})`
                                return <span key={j} title={`Mini-sector ${j + 1}: +${Math.round(d)} ms`} className="rounded-[3px]" style={{ background: bg }} />
                            })}
                        </span>
                        <span className="num text-right text-xs text-loss-fg">{formatDelta(lost)}</span>
                    </div>
                )
            })}
            <div className={clsx(HEAT_COLS, 'mt-1 h-10 items-end')}>
                <span className="label">σ</span>
                <span className="grid h-9 items-end gap-[3px]" style={grid}>
                    {minis.sd.map((s, j) => (
                        <span key={j} title={`Mini-sector ${j + 1}: σ ${Math.round(s)} ms`}
                            className={clsx('min-h-0.5 rounded-t-sm', s / maxSd > 0.66 ? 'bg-loss' : 'bg-track')} style={{ height: `${maxSd > 0 ? s / maxSd * 100 : 0}%` }} />
                    ))}
                </span>
                <span className="num text-right text-[11px] text-fg-faint">max {Math.round(maxSd)} ms</span>
            </div>
            <div className="flex flex-wrap items-center gap-3.5 pt-2 text-[11px] text-fg-subtle">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px]" style={{ background: 'rgb(var(--c-best) / 0.85)' }} />best of the compared laps</span>
                <span className="flex items-center gap-1.5">
                    <span className="h-3 w-12 rounded-[3px]" style={{ background: 'linear-gradient(90deg, rgb(var(--c-loss-fg) / 0.12), rgb(var(--c-loss-fg) / 0.95))' }} />
                    0 → {HEAT_FULL_MS}+ ms slower
                </span>
                <span>{MINI_SECTORS} mini-sectors of equal length</span>
            </div>
        </div>
    )
}

// ── Corners ──────────────────────────────────────────────────────────────────

type CornerMetric = 'brake' | 'apex' | 'throttle'

const CORNER_METRICS: Record<CornerMetric, { label: string; unit: string; scale: number; digits: number; left: string; right: string; hint: string; get: (s: CornerLapStats) => number | null }> = {
    brake: { label: 'Brake point', unit: 'm', scale: 40, digits: 0, left: '−40 m later', right: '+40 m earlier', hint: 'where each lap starts braking', get: s => s.brakeBeforeM },
    apex: { label: 'Apex speed', unit: 'km/h', scale: 10, digits: 1, left: '−10 km/h', right: '+10 km/h', hint: 'minimum speed in the corner', get: s => s.apexKmh },
    throttle: { label: 'Throttle on', unit: 'm', scale: 50, digits: 0, left: '−50 m earlier', right: '+50 m later', hint: 'first throttle after the apex', get: s => s.throttleAfterM },
}

const CORNER_COLS = 'grid grid-cols-[64px_150px_minmax(0,1fr)_84px] gap-4'

function CornerPanel({ laps, selId }: { laps: LapAnalysis[]; selId: number }) {
    const [metric, setMetric] = useState<CornerMetric>('brake')
    const ref = laps[0]!
    const stats = useMemo(() => ref.corners.map(c => laps.map((l, i) => cornerLapStats(l, c, i === 0))), [laps, ref])
    const M = CORNER_METRICS[metric]
    const rows = ref.corners.map((c, ci) => {
        const vals = laps.flatMap((l, i) => {
            const v = M.get(stats[ci]![i]!)
            return v === null ? [] : [{ lap: l, v }]
        })
        const med = median(vals.map(x => x.v))
        const rel = vals.map(x => x.v - med)
        return { c, vals, med, sd: stdDev(vals.map(x => x.v)), range: rel.length ? Math.max(...rel) - Math.min(...rel) : null }
    })
    const maxSd = Math.max(...rows.map(r => r.sd))

    return (
        <Panel label="Corner consistency" title="Corner consistency" hint={M.hint}
            actions={<Segmented label="Metric" value={metric} onChange={setMetric}
                options={(Object.keys(CORNER_METRICS) as CornerMetric[]).map(k => ({ key: k, label: CORNER_METRICS[k].label }))} />}>
            {ref.corners.length === 0 ? <p className="px-4 py-4 text-xs text-fg-faint">No corners were detected in the reference lap.</p> : (
                <>
                    <div className={clsx(CORNER_COLS, 'items-end px-4 pt-2.5 pb-1.5')}>
                        <span className="label">Corner</span>
                        <span className="label">σ {M.unit}</span>
                        <span className="num flex justify-between text-[11px] text-fg-faint"><span>{M.left}</span><span>median</span><span>{M.right}</span></span>
                        <span className="label text-right">Range</span>
                    </div>
                    {rows.map(r => (
                        <div key={r.c.number} className={clsx(CORNER_COLS, 'h-[46px] items-center border-t border-row px-4')}>
                            <span className="flex items-baseline gap-1.5"><span className="num text-[15px] font-semibold text-fg">T{r.c.number}</span><span className="text-[11px] text-fg-subtle">{r.c.isLeft ? 'L' : 'R'}</span></span>
                            {r.vals.length > 1 ? <SigmaBar value={r.sd} max={maxSd} digits={1} /> : <span className="text-fg-faint">—</span>}
                            <Strip center dots={r.vals.map(x => ({ id: x.lap.lapId, pos: 50 + (x.v - r.med) / M.scale * 50, selected: x.lap.lapId === selId, hollow: !x.lap.isValid }))} />
                            <span className="num text-right text-xs text-fg-muted">{r.range === null ? '—' : `${r.range.toFixed(M.digits)} ${M.unit}`}</span>
                        </div>
                    ))}
                    <p className="border-t border-row px-4 pt-2.5 pb-3 text-xs text-fg-faint">
                        One dot per compared lap, relative to that corner's median. σ is the standard deviation across the compared laps.
                    </p>
                </>
            )}
        </Panel>
    )
}

// ── Side panel ───────────────────────────────────────────────────────────────

function LapList({ order, best, selId, onPick }: { order: LapAnalysis[]; best: number; selId: number; onPick: (id: number) => void }) {
    return (
        <section aria-label="Laps" className="rounded-xl border border-edge bg-well px-2 pt-3 pb-2 flex flex-col gap-0.5">
            <div className="grid grid-cols-[60px_minmax(0,1fr)_64px] gap-2.5 px-2 pb-1.5">
                <span className="label text-fg-2">Lap</span>
                <span className="label">Time</span>
                <span className="label text-right">To best</span>
            </div>
            {order.map(l => {
                const sel = l.lapId === selId
                const isBest = l.lapTimeMs === best
                const d = l.lapTimeMs === null ? null : l.lapTimeMs - best
                return (
                    <button key={l.lapId} aria-pressed={sel} onClick={() => onPick(l.lapId)}
                        className={clsx('grid h-[34px] grid-cols-[60px_minmax(0,1fr)_64px] items-center gap-2.5 rounded-md px-2 text-left transition-colors', sel ? 'bg-selected' : 'hover:bg-hover')}>
                        <span className="flex items-center gap-2 text-xs text-fg-2">
                            <span className={clsx('h-2 w-2 rounded-full', sel ? 'bg-accent' : l.isValid ? 'bg-fg-faint' : 'ring-[1.5px] ring-inset ring-fg-faint')} />
                            Lap {l.lapNumber}
                        </span>
                        <span className="flex items-center gap-2">
                            <span className={clsx('num text-[13px] font-semibold', isBest ? 'text-best' : 'text-fg-strong')}>{formatLapTime(l.lapTimeMs)}</span>
                            {!l.isValid && <span className="chip bg-danger-bg px-1.5 py-0 text-[10px] uppercase tracking-wider text-danger-fg">invalid</span>}
                        </span>
                        <span className={clsx('num text-right text-xs', isBest ? 'text-best' : d !== null && d > WITHIN_MS ? 'text-loss-fg' : 'text-fg-muted')}>
                            {isBest ? 'best' : d === null ? '—' : sign(d / 1000, 3)}
                        </span>
                    </button>
                )
            })}
        </section>
    )
}

const BIN_MS = 200
const BINS = 9

function Distribution({ laps, best }: { laps: LapAnalysis[]; best: number }) {
    const bins = Array<number>(BINS).fill(0)
    for (const l of laps) if (l.lapTimeMs !== null) bins[Math.min(BINS - 1, Math.floor((l.lapTimeMs - best) / BIN_MS))]!++
    const max = Math.max(...bins)
    return (
        <section aria-label="Lap time distribution" className="rounded-xl border border-edge bg-well px-4 py-3 flex flex-col gap-2">
            <div className="flex items-baseline gap-2"><span className="label text-fg-2">Distribution</span><span className="text-[11px] text-fg-faint">laps per {BIN_MS / 1000} s off best</span></div>
            <div className="flex h-[84px] items-end gap-1">
                {bins.map((b, i) => (
                    <span key={i} title={`${b} lap${b === 1 ? '' : 's'}`}
                        className={clsx('min-h-0.5 flex-1 rounded-t-[3px]', i === 0 ? 'bg-best' : i < 3 ? 'bg-fg-faint' : 'bg-track')}
                        style={{ height: `${max ? b / max * 100 : 0}%` }} />
                ))}
            </div>
            <div className="num flex justify-between text-[11px] text-fg-faint">
                <span>+0.0</span><span>+{(BIN_MS * (BINS - 1) / 2000).toFixed(1)}</span><span>+{(BIN_MS * (BINS - 1) / 1000).toFixed(1)} s+</span>
            </div>
        </section>
    )
}
