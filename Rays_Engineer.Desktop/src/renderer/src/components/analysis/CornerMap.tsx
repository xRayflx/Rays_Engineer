import type { AnalysisResult, CornerInfo, LapAnalysis } from '@shared/analysis'
import { formatDelta } from '@shared/format'
import clsx from 'clsx'
import { Route } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cornerLapStats, cornerWindow, indexAt, type CornerLapStats } from '../../lib/corners'
import { useChartPalette } from '../../lib/theme'
import EmptyState from '../EmptyState'

/** Track band drawn around every lap's line, in metres; GPS has no track edges. */
const BAND_M = 11
const MAP_W = 1000
const MAP_H = 600
const CHART_W = 600

type Marker = 'brake' | 'apex' | 'throttle'

const SPEED = (l: LapAnalysis) => l.speed
const BRAKE = (l: LapAnalysis) => l.brake
const THROTTLE = (l: LapAnalysis) => l.throttle

interface LapRow {
    lap: LapAnalysis
    color: string
    isRef: boolean
    stats: CornerLapStats
}

/** One corner close up: every lap's line with its brake, apex and throttle-on points, plus speed and pedal traces through it. */
export default function CornerMap({ result, colors }: { result: AnalysisResult; colors: string[] }) {
    const ref = result.laps[0]!
    const [cornerNo, setCornerNo] = useState<number | null>(null)
    const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
    const [markers, setMarkers] = useState<Record<Marker, boolean>>({ brake: true, apex: true, throttle: true })
    const corner = ref.corners.find(c => c.number === cornerNo) ?? ref.corners[0] ?? null

    const rows = useMemo<LapRow[]>(
        () => (corner ? result.laps.map((lap, i) => ({ lap, color: colors[i]!, isRef: i === 0, stats: cornerLapStats(lap, corner, i === 0) })) : []),
        [result, colors, corner],
    )
    const win = useMemo(
        () => (corner ? cornerWindow(corner, rows.map(r => r.stats), (ref.distM.length - 1) * ref.stepM) : null),
        [corner, rows, ref],
    )
    const visible = useMemo(() => rows.filter(r => !hidden.has(r.lap.lapId)), [rows, hidden])

    if (!corner || !win) {
        return (
            <EmptyState icon={<Route size={28} />} title="No corners found">
                <p>No braking zones were detected in the reference lap.</p>
            </EmptyState>
        )
    }

    const toggleLap = (id: number) => setHidden(h => {
        const next = new Set(h)
        if (!next.delete(id)) next.add(id)
        return next
    })

    return (
        <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pt-4 pb-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="label">Corner</span>
                    <div role="tablist" aria-label="Corner" className="segmented flex-wrap">
                        {ref.corners.map(c => (
                            <button key={c.number} role="tab" aria-selected={c === corner} onClick={() => setCornerNo(c.number)}
                                className={clsx('segment flex items-center justify-center gap-1.5 px-3', c === corner && 'segment-on')}>
                                <span className="num font-semibold">T{c.number}</span>
                                <span className="text-[11px] text-fg-subtle">{c.isLeft ? 'L' : 'R'}</span>
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                        {MARKERS.map(m => (
                            <button key={m.key} aria-pressed={markers[m.key]} onClick={() => setMarkers(s => ({ ...s, [m.key]: !s[m.key] }))}
                                className={clsx('flex h-8 items-center gap-2 rounded-full border border-edge-strong px-3 text-xs font-medium transition-colors',
                                    markers[m.key] ? 'bg-selected text-fg-strong' : 'text-fg-subtle hover:text-fg')}>
                                <MarkerIcon kind={m.key} />{m.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {rows.map(r => {
                        const on = !hidden.has(r.lap.lapId)
                        return (
                            <button key={r.lap.lapId} aria-pressed={on} onClick={() => toggleLap(r.lap.lapId)} title={on ? 'Hide this lap' : 'Show this lap'}
                                className={clsx('flex h-8 items-center gap-2 rounded-md px-2.5 text-xs transition-colors hover:bg-hover', on ? 'text-fg-soft' : 'text-fg-ghost')}>
                                <span className={clsx('h-[3px] w-3.5 rounded-full', !on && 'opacity-40')} style={{ background: r.color }} />
                                Lap {r.lap.lapNumber}{r.isRef && <span className="text-fg-subtle">· reference</span>}
                            </button>
                        )
                    })}
                </div>

                <section aria-label="Corner map" className="relative shrink-0 overflow-hidden rounded-xl border border-edge bg-well">
                    <CornerTrack rows={rows} visible={visible} corner={corner} fromM={win.fromM} toM={win.toM} markers={markers} />
                    <div className="pointer-events-none absolute left-4 top-3.5 flex items-baseline gap-2">
                        <span className="num text-[15px] font-semibold text-fg-strong">T{corner.number}</span>
                        <span className="text-xs text-fg-muted">{corner.isLeft ? 'Left' : 'Right'}</span>
                    </div>
                    <p className="pointer-events-none absolute bottom-2.5 right-4 text-[11px] text-fg-faint">GPS lines · arrow: driving direction</p>
                </section>

                <div className="grid grid-cols-2 gap-3">
                    <section aria-label="Speed through the corner" className="rounded-xl border border-edge bg-well px-3.5 pt-3 pb-2">
                        <ChartTitle title="Speed" unit="km/h" />
                        <CornerChart rows={visible} pick={SPEED} corner={corner} fromM={win.fromM} toM={win.toM} height={210} />
                    </section>
                    <section aria-label="Brake and throttle through the corner" className="rounded-xl border border-edge bg-well px-3.5 pt-3 pb-2 flex flex-col gap-1">
                        <ChartTitle title="Brake" unit="%" />
                        <CornerChart rows={visible} pick={BRAKE} corner={corner} fromM={win.fromM} toM={win.toM} height={84} percent showX={false} />
                        <ChartTitle title="Throttle" unit="%" />
                        <CornerChart rows={visible} pick={THROTTLE} corner={corner} fromM={win.fromM} toM={win.toM} height={102} percent />
                    </section>
                </div>
                <p className="text-xs text-fg-faint">Distances are relative to the reference lap's apex, in metres.</p>
            </div>

            <aside className="w-[380px] shrink-0 border-l border-line p-4 flex flex-col gap-3 overflow-y-auto">
                <CornerSummary corner={corner} />
                <ApexSpeeds rows={rows} hidden={hidden} />
                <StatList title="Brake point" hint="before apex · peak pressure" rows={rows} hidden={hidden}
                    value={s => (s.brakeBeforeM === null ? null : `${Math.round(s.brakeBeforeM)} m`)}
                    extra={s => (s.peakBrake === null ? '' : `${Math.round(s.peakBrake * 100)}%`)}
                    delta={(s, r) => (s.brakeBeforeM === null || r.brakeBeforeM === null ? null : s.brakeBeforeM - r.brakeBeforeM)}
                    describe={d => (d > 0 ? `${d} m earlier` : `${-d} m later`)} />
                <StatList title="Throttle on" hint="relative to apex" rows={rows} hidden={hidden}
                    value={s => (s.throttleAfterM === null ? null : `${Math.abs(Math.round(s.throttleAfterM))} m`)}
                    extra={s => (s.throttleAfterM === null ? '' : s.throttleAfterM >= 0 ? 'after' : 'before')}
                    delta={(s, r) => (s.throttleAfterM === null || r.throttleAfterM === null ? null : s.throttleAfterM - r.throttleAfterM)}
                    describe={d => (d > 0 ? `${d} m later` : `${-d} m earlier`)} />
                <ExitAndTime rows={rows} hidden={hidden} />
            </aside>
        </div>
    )
}

const MARKERS: { key: Marker; label: string }[] = [
    { key: 'brake', label: 'Brake point' },
    { key: 'apex', label: 'Apex' },
    { key: 'throttle', label: 'Throttle on' },
]

function MarkerIcon({ kind }: { kind: Marker }) {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
            {kind === 'brake' && <rect x="2" y="2" width="8" height="8" fill="currentColor" />}
            {kind === 'apex' && <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />}
            {kind === 'throttle' && <polygon points="6,1 11,11 1,11" fill="currentColor" />}
        </svg>
    )
}

function ChartTitle({ title, unit }: { title: string; unit: string }) {
    return <div className="flex items-baseline gap-2"><span className="label text-fg-2">{title}</span><span className="text-[11px] text-fg-faint">{unit}</span></div>
}

// ── Map ──────────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toFixed(1)

function CornerTrack({ rows, visible, corner, fromM, toM, markers }: {
    rows: LapRow[]
    visible: LapRow[]
    corner: CornerInfo
    fromM: number
    toM: number
    markers: Record<Marker, boolean>
}) {
    const palette = useChartPalette()
    const geo = useMemo(() => {
        // Bounds over every lap (not just the visible ones) so hiding a lap doesn't rescale the map.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const { lap } of rows) {
            for (let i = indexAt(lap, fromM); i <= indexAt(lap, toM); i++) {
                minX = Math.min(minX, lap.mapX[i]!); maxX = Math.max(maxX, lap.mapX[i]!)
                minY = Math.min(minY, lap.mapY[i]!); maxY = Math.max(maxY, lap.mapY[i]!)
            }
        }
        minX -= BAND_M; maxX += BAND_M; minY -= BAND_M; maxY += BAND_M
        const pad = 48
        const scale = Math.min((MAP_W - 2 * pad) / (maxX - minX || 1), (MAP_H - 2 * pad) / (maxY - minY || 1))
        const ox = (MAP_W - (maxX - minX) * scale) / 2
        const oy = (MAP_H - (maxY - minY) * scale) / 2
        const pt = (lap: LapAnalysis, i: number): [number, number] => [ox + (lap.mapX[i]! - minX) * scale, MAP_H - (oy + (lap.mapY[i]! - minY) * scale)]
        /** Unit vector of the driving direction at an index, in map coordinates. */
        const heading = (lap: LapAnalysis, i: number): [number, number] => {
            const a = pt(lap, Math.max(0, i - 2))
            const b = pt(lap, Math.min(lap.mapX.length - 1, i + 2))
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
        }
        const triangle = (lap: LapAnalysis, i: number, size: number) => {
            const [x, y] = pt(lap, i)
            const [fx, fy] = heading(lap, i)
            const tip = [x + size * fx, y + size * fy]
            const l = [x - 0.6 * size * fx - 0.75 * size * fy, y - 0.6 * size * fy + 0.75 * size * fx]
            const r = [x - 0.6 * size * fx + 0.75 * size * fy, y - 0.6 * size * fy - 0.75 * size * fx]
            return [tip, l, r].map(p => `${fmt(p[0]!)},${fmt(p[1]!)}`).join(' ')
        }
        const lines = rows.map(({ lap }) => {
            let d = ''
            for (let i = indexAt(lap, fromM), first = true; i <= indexAt(lap, toM); i++, first = false) {
                const [x, y] = pt(lap, i)
                d += `${first ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
            }
            return d
        })
        const ref = rows[0]!.lap
        return { scale, pt, triangle, lines, arrow: triangle(ref, Math.min(indexAt(ref, fromM) + 4, ref.mapX.length - 1), 9) }
    }, [rows, fromM, toM])

    const lineOf = (r: LapRow) => geo.lines[rows.indexOf(r)]!
    const band = BAND_M * geo.scale
    const scaleBar = 50 * geo.scale
    const ordered = [...visible].reverse() // reference on top

    return (
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full" role="img"
            aria-label={`Corner ${corner.number}: lines with brake, apex and throttle points`}>
            {geo.lines.map((d, k) => <path key={`o${k}`} d={d} fill="none" className="stroke-edge-strong" strokeWidth={band + 4} strokeLinejoin="round" strokeLinecap="round" />)}
            {geo.lines.map((d, k) => <path key={`b${k}`} d={d} fill="none" className="stroke-raised" strokeWidth={band} strokeLinejoin="round" strokeLinecap="round" />)}
            <polygon points={geo.arrow} fill={palette.mapZoom} />
            {ordered.map(r => <path key={r.lap.lapId} d={lineOf(r)} fill="none" stroke={r.color} strokeWidth={r.isRef ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />)}
            {markers.brake && ordered.map(r => {
                if (r.stats.brakeBeforeM === null) return null
                const [x, y] = geo.pt(r.lap, indexAt(r.lap, corner.lineApexM - r.stats.brakeBeforeM))
                return <rect key={r.lap.lapId} x={x - 5} y={y - 5} width={10} height={10} fill={r.color} stroke={palette.markerRing} strokeWidth={2} />
            })}
            {markers.apex && ordered.map(r => {
                if (r.stats.apexM === null) return null
                const [x, y] = geo.pt(r.lap, indexAt(r.lap, r.stats.apexM))
                return <circle key={r.lap.lapId} cx={x} cy={y} r={6} fill={palette.markerRing} stroke={r.color} strokeWidth={2.5} />
            })}
            {markers.throttle && ordered.map(r => {
                if (r.stats.throttleAfterM === null) return null
                return <polygon key={r.lap.lapId} points={geo.triangle(r.lap, indexAt(r.lap, corner.lineApexM + r.stats.throttleAfterM), 8)}
                    fill={r.color} stroke={palette.markerRing} strokeWidth={2} strokeLinejoin="round" />
            })}
            <g className="stroke-fg-subtle" strokeWidth={2}>
                <line x1={28} x2={28 + scaleBar} y1={572} y2={572} />
                <line x1={28} x2={28} y1={566} y2={578} />
                <line x1={28 + scaleBar} x2={28 + scaleBar} y1={566} y2={578} />
            </g>
            <text x={28 + scaleBar / 2} y={560} textAnchor="middle" className="fill-fg-subtle font-mono text-[12px]">50 m</text>
        </svg>
    )
}

// ── Traces ───────────────────────────────────────────────────────────────────

function niceStep(span: number): number {
    for (const s of [10, 20, 50, 100]) if (span / s <= 5) return s
    return 200
}

/** A small trace over the corner window; x is metres from the reference apex. */
function CornerChart({ rows, pick, corner, fromM, toM, height, percent = false, showX = true }: {
    rows: LapRow[]
    pick: (l: LapAnalysis) => Float32Array
    corner: CornerInfo
    fromM: number
    toM: number
    height: number
    percent?: boolean
    showX?: boolean
}) {
    const PL = 36, PR = 10, PT = 8
    const plotBottom = height - (showX ? 24 : 6)
    const x0 = fromM - corner.lineApexM
    const x1 = toM - corner.lineApexM
    const X = (x: number) => PL + (x - x0) / (x1 - x0 || 1) * (CHART_W - PL - PR)

    const { paths, ticks } = useMemo(() => {
        let lo = Infinity, hi = -Infinity
        const pts = rows.map(r => {
            const out: [number, number][] = []
            const a = pick(r.lap)
            for (let i = indexAt(r.lap, fromM); i <= indexAt(r.lap, toM); i++) {
                const v = percent ? a[i]! * 100 : a[i]!
                lo = Math.min(lo, v); hi = Math.max(hi, v)
                out.push([i * r.lap.stepM - corner.lineApexM, v])
            }
            return out
        })
        let yMin = 0, yMax = 100, step = 100
        if (!percent && Number.isFinite(lo)) {
            step = niceStep(hi - lo)
            yMin = Math.floor(lo / step) * step
            yMax = Math.ceil(hi / step) * step
            if (yMax === yMin) yMax += step
        }
        const Y = (v: number) => plotBottom - (v - yMin) / (yMax - yMin) * (plotBottom - PT)
        const ticks: { y: number; label: string }[] = []
        for (let v = yMin; v <= yMax; v += step) ticks.push({ y: Y(v), label: String(v) })
        const paths = pts.map(p => p.map(([x, v], k) => `${k ? 'L' : 'M'}${fmt(X(x))} ${fmt(Y(v))}`).join(''))
        return { paths, ticks }
        // X depends only on the window, which is in the deps through fromM/toM/corner.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, pick, corner, fromM, toM, percent, plotBottom])

    const xStep = x1 - x0 > 600 ? 100 : 50
    const xTicks: number[] = []
    for (let x = Math.ceil(x0 / xStep) * xStep; x <= x1; x += xStep) xTicks.push(x)

    return (
        <svg viewBox={`0 0 ${CHART_W} ${height}`} className="block h-auto w-full font-mono text-[11px]">
            {ticks.map(t => (
                <g key={t.label}>
                    <line x1={PL} x2={CHART_W - PR} y1={t.y} y2={t.y} className="stroke-row" />
                    <text x={PL - 6} y={t.y} textAnchor="end" dominantBaseline="middle" className="fill-fg-faint">{t.label}</text>
                </g>
            ))}
            <line x1={X(0)} x2={X(0)} y1={PT - 4} y2={plotBottom + 2} className="stroke-track" strokeDasharray="4 4" />
            {[...rows].reverse().map(r => (
                <path key={r.lap.lapId} d={paths[rows.indexOf(r)]} fill="none" stroke={r.color} strokeWidth={r.isRef ? 2 : 1.5} strokeLinejoin="round" />
            ))}
            {showX && xTicks.map(x => (
                <text key={x} x={X(x)} y={height - 6} textAnchor="middle" className={x === 0 ? 'fill-accent' : 'fill-fg-faint'}>
                    {x === 0 ? 'apex' : x > 0 ? `+${x}` : `−${-x}`}
                </text>
            ))}
        </svg>
    )
}

// ── Side panel ───────────────────────────────────────────────────────────────

const tone = (d: number | null, goodWhenPositive: boolean) =>
    d === null || Math.abs(d) < 0.05 ? 'text-fg-faint' : (d > 0) === goodWhenPositive ? 'text-gain-fg' : 'text-loss-fg'

function LapName({ row }: { row: LapRow }) {
    return (
        <span className="flex items-center gap-2 text-xs text-fg-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />Lap {row.lap.lapNumber}
        </span>
    )
}

function Card({ label, title, hint, children }: { label: string; title?: string; hint?: string; children: React.ReactNode }) {
    return (
        <section aria-label={label} className="rounded-xl border border-edge bg-well px-4 pt-3 pb-3.5 flex flex-col gap-2">
            {title && <div className="flex items-baseline gap-2"><span className="label text-fg-2">{title}</span>{hint && <span className="text-[11px] text-fg-faint">{hint}</span>}</div>}
            {children}
        </section>
    )
}

function CornerSummary({ corner }: { corner: CornerInfo }) {
    const stat = (label: string, v: number, strong = false) => (
        <div className="flex flex-col gap-0.5">
            <span className={clsx('text-[10px] font-semibold uppercase tracking-[0.08em]', strong ? 'text-accent' : 'text-fg-subtle')}>{label}</span>
            <span className={clsx('num text-[13px] font-semibold', strong ? 'text-fg-strong' : 'text-fg')}>{Math.round(v)}</span>
        </div>
    )
    return (
        <section aria-label="Corner summary" className="rounded-xl border border-edge bg-well px-4 py-3.5 flex items-center gap-3.5">
            <span className="font-display text-[36px] font-bold leading-none text-fg-strong" style={{ fontStretch: '118%' }}>T{corner.number}</span>
            <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-fg-soft">{corner.isLeft ? 'Left' : 'Right'}</span>
                <span className="num text-[11px] text-fg-subtle">apex at {Math.round(corner.lineApexM)} m</span>
            </div>
            <div className="ml-auto grid grid-cols-3 gap-3 text-right">
                {stat('Entry', corner.entrySpeedKmh)}
                {stat('Apex', corner.minSpeedKmh, true)}
                {stat('Exit', corner.exitSpeedKmh)}
            </div>
        </section>
    )
}

function ApexSpeeds({ rows, hidden }: { rows: LapRow[]; hidden: ReadonlySet<number> }) {
    const ref = rows[0]!.stats.apexKmh
    const speeds = rows.map(r => r.stats.apexKmh).filter((v): v is number => v !== null)
    const lo = Math.min(...speeds) - 4
    const hi = Math.max(...speeds)
    return (
        <Card label="Apex speed" title="Apex speed" hint="minimum km/h">
            {rows.map(r => {
                const v = r.stats.apexKmh
                const d = v !== null && ref !== null ? v - ref : null
                return (
                    <div key={r.lap.lapId} className={clsx('grid grid-cols-[60px_minmax(0,1fr)_48px_44px] items-center gap-2.5', hidden.has(r.lap.lapId) && 'opacity-35')}>
                        <LapName row={r} />
                        <span className="flex h-2 rounded-full bg-row">
                            {v !== null && <span className="h-2 rounded-full" style={{ background: r.color, width: `${hi > lo ? 25 + 75 * (v - lo) / (hi - lo) : 100}%` }} />}
                        </span>
                        <span className="num text-right text-[13px] font-semibold text-fg-strong">{v === null ? '—' : v.toFixed(1)}</span>
                        <span className={clsx('num text-right text-xs', r.isRef ? 'text-fg-faint' : tone(d, true))}>
                            {r.isRef ? 'ref' : d === null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}
                        </span>
                    </div>
                )
            })}
        </Card>
    )
}

function StatList({ title, hint, rows, hidden, value, extra, delta, describe }: {
    title: string
    hint: string
    rows: LapRow[]
    hidden: ReadonlySet<number>
    value: (s: CornerLapStats) => string | null
    extra: (s: CornerLapStats) => string
    /** Difference to the reference; positive = earlier for brakes, later for throttle — both lose time. */
    delta: (s: CornerLapStats, ref: CornerLapStats) => number | null
    describe: (d: number) => string
}) {
    const ref = rows[0]!.stats
    return (
        <Card label={title} title={title} hint={hint}>
            {rows.map(r => {
                const v = value(r.stats)
                const d = r.isRef ? null : delta(r.stats, ref)
                const rounded = d === null ? null : Math.round(d)
                return (
                    <div key={r.lap.lapId} className={clsx('grid grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-2.5', hidden.has(r.lap.lapId) && 'opacity-35')}>
                        <LapName row={r} />
                        <span className="flex items-baseline gap-1.5">
                            <span className="num text-[13px] font-semibold text-fg-strong">{v ?? '—'}</span>
                            {v !== null && <span className="num text-[11px] text-fg-subtle">{extra(r.stats)}</span>}
                        </span>
                        <span className={clsx('num text-right text-xs', rounded === null || rounded === 0 ? 'text-fg-faint' : rounded > 0 ? 'text-loss-fg' : 'text-gain-fg')}>
                            {r.isRef ? 'ref' : rounded === null ? '' : rounded === 0 ? 'same' : describe(rounded)}
                        </span>
                    </div>
                )
            })}
        </Card>
    )
}

function ExitAndTime({ rows, hidden }: { rows: LapRow[]; hidden: ReadonlySet<number> }) {
    const ref = rows[0]!.stats.exitKmh
    return (
        <Card label="Exit speed and corner time">
            <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-baseline gap-2.5">
                <span />
                <span className="label text-fg-2">Exit km/h</span>
                <span className="label text-right text-fg-2">Time</span>
            </div>
            {rows.map(r => {
                const v = r.stats.exitKmh
                const d = v !== null && ref !== null && !r.isRef ? v - ref : null
                const t = r.stats.timeMs
                return (
                    <div key={r.lap.lapId} className={clsx('grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2.5', hidden.has(r.lap.lapId) && 'opacity-35')}>
                        <LapName row={r} />
                        <span className="flex items-baseline gap-2">
                            <span className="num text-[13px] font-semibold text-fg-strong">{v === null ? '—' : v.toFixed(1)}</span>
                            {d !== null && <span className={clsx('num text-xs', tone(d, true))}>{`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}</span>}
                        </span>
                        <span className={clsx('num text-right text-xs', r.isRef ? 'text-fg-faint' : t === null ? 'text-fg-faint' : t > 0 ? 'text-loss-fg' : 'text-gain-fg')}>
                            {r.isRef ? 'ref' : t === null ? '—' : formatDelta(t)}
                        </span>
                    </div>
                )
            })}
            <p className="border-t border-line pt-2 text-[11px] text-fg-faint">Time from the reference brake point to its exit, against the reference.</p>
        </Card>
    )
}
