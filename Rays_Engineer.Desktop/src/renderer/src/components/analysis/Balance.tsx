import type { AnalysisResult, CornerInfo, LapAnalysis } from '@shared/analysis'
import {
    balanceMoments, balanceTrace, classify, cornerPhases, fitSteerModel, NEUTRAL_BAND,
    type BalanceClass, type BalanceMoment, type CornerPhases,
} from '@shared/balance'
import clsx from 'clsx'
import { Activity } from 'lucide-react'
import { useMemo, useState } from 'react'
import { matchCorner } from '../../lib/corners'
import EmptyState from '../EmptyState'

const MAP_W = 640
const MAP_H = 440
const TRACE_W = 1000
/** Map segments are coloured per this many metres. */
const SEGMENT_M = 20
/** At most this many moments are listed per lap, the strongest ones. */
const MAX_MOMENTS = 12
const PHASE_KEYS = ['entry', 'mid', 'exit'] as const

const STROKE: Record<BalanceClass, string> = { under: 'stroke-gain', neutral: 'stroke-track', over: 'stroke-loss' }
const TEXT: Record<BalanceClass, string> = { under: 'text-gain-fg', neutral: 'text-fg-muted', over: 'text-loss-fg' }
const LABEL: Record<BalanceClass, string> = { under: 'Understeer', neutral: 'Neutral', over: 'Oversteer' }

const fmt = (v: number) => v.toFixed(1)
const signed = (v: number, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

interface Moment extends BalanceMoment {
    corner: CornerInfo | null
    phase: string | null
}

/** Where a moment happened: the reference corner around it and the phase within that corner. */
function placeMoment(m: BalanceMoment, corners: CornerInfo[]): Moment {
    const corner = corners.find(c => m.atM >= Math.min(c.entryM, c.brakeM ?? c.entryM) - 30 && m.atM <= c.exitM + 30) ?? null
    const phase = !corner ? null : m.atM < corner.lineApexM - 15 ? 'entry' : m.atM > corner.lineApexM + 15 ? 'exit' : 'mid'
    return { ...m, corner, phase }
}

/** Understeer / oversteer estimated from steering against the path driven — see src/shared/balance.ts. */
export default function Balance({ result, colors }: { result: AnalysisResult; colors: string[] }) {
    const laps = result.laps
    const ref = laps[0]!
    const [lapIdx, setLapIdx] = useState(0)
    const [momentIdx, setMomentIdx] = useState<number | null>(null)

    const model = useMemo(() => fitSteerModel(ref), [ref])
    const traces = useMemo(() => (model ? laps.map(l => balanceTrace(l, model)) : []), [laps, model])
    const phases = useMemo(() => traces.map((b, i) => ref.corners.map(c => cornerPhases(b, laps[i]!.stepM, { ...c, apexM: c.lineApexM }))), [traces, laps, ref])
    const lap = laps[Math.min(lapIdx, laps.length - 1)]!
    const balance = traces[lapIdx]
    const moments = useMemo(() => {
        if (!balance) return []
        const all = balanceMoments(balance, lap.stepM)
        const strongest = [...all].sort((a, b) => Math.abs(b.peak) - Math.abs(a.peak)).slice(0, MAX_MOMENTS)
        return strongest.sort((a, b) => a.atM - b.atM).map(m => placeMoment(m, ref.corners))
    }, [balance, lap, ref])

    if (!model || !balance) {
        return (
            <EmptyState icon={<Activity size={28} />} title="Balance not available">
                <p>The reference lap has too little cornering with a clean GPS line to learn this car's steering.</p>
            </EmptyState>
        )
    }

    const moment = momentIdx === null ? null : moments[momentIdx] ?? null
    const pickLap = (i: number) => { setLapIdx(i); setMomentIdx(null) }

    return (
        <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pt-4 pb-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="label">Lap</span>
                    <div role="tablist" aria-label="Lap" className="segmented flex-wrap">
                        {laps.map((l, i) => (
                            <button key={l.lapId} role="tab" aria-selected={i === lapIdx} onClick={() => pickLap(i)}
                                className={clsx('segment flex items-center justify-center gap-2 normal-case', i === lapIdx && 'segment-on')}>
                                <span className="h-[3px] w-3 rounded-full" style={{ background: colors[i] }} />Lap {l.lapNumber}
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto flex items-center gap-4 text-xs text-fg-muted">
                        <span className="flex items-center gap-2"><span className="h-1 w-3.5 rounded-full bg-gain" />Understeer</span>
                        <span className="flex items-center gap-2"><span className="h-1 w-3.5 rounded-full bg-track" />Neutral</span>
                        <span className="flex items-center gap-2"><span className="h-1 w-3.5 rounded-full bg-loss" />Oversteer</span>
                    </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3">
                    <section aria-label="Balance on the track map" className="relative overflow-hidden rounded-xl border border-edge bg-well">
                        <BalanceMap lap={lap} balance={balance} corners={ref.corners} moment={moment} />
                        <span className="label pointer-events-none absolute left-4 top-3.5 text-fg-2">Lap {lap.lapNumber}</span>
                        <span className="pointer-events-none absolute bottom-2.5 right-4 text-[11px] text-fg-faint">Line width grows with the strength of the slide</span>
                    </section>
                    <div className="flex flex-col gap-3">
                        <Summary lap={lap} balance={balance} corners={ref.corners} moments={moments} />
                        <PhaseAverages phases={phases[lapIdx]!} refPhases={phases[0]!} />
                    </div>
                </div>

                <BalanceOverLap lap={lap} balance={balance} refBalance={lapIdx === 0 ? null : traces[0]!} refLap={ref} corners={ref.corners} moment={moment} />
                <CornerTable laps={laps} lapIdx={lapIdx} phases={phases} />
            </div>

            <aside className="w-[340px] shrink-0 border-l border-line p-4 flex flex-col gap-3 overflow-y-auto">
                <Moments moments={moments} selected={momentIdx} onPick={i => setMomentIdx(i === momentIdx ? null : i)} />
                <Method />
            </aside>
        </div>
    )
}

// ── Map ──────────────────────────────────────────────────────────────────────

function BalanceMap({ lap, balance, corners, moment }: { lap: LapAnalysis; balance: Float32Array; corners: CornerInfo[]; moment: Moment | null }) {
    const geo = useMemo(() => {
        const n = lap.mapX.length
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (let i = 0; i < n; i++) {
            minX = Math.min(minX, lap.mapX[i]!); maxX = Math.max(maxX, lap.mapX[i]!)
            minY = Math.min(minY, lap.mapY[i]!); maxY = Math.max(maxY, lap.mapY[i]!)
        }
        const pad = 46
        const scale = Math.min((MAP_W - 2 * pad) / (maxX - minX || 1), (MAP_H - 2 * pad) / (maxY - minY || 1))
        const ox = (MAP_W - (maxX - minX) * scale) / 2
        const oy = (MAP_H - (maxY - minY) * scale) / 2
        const at = (m: number) => Math.max(0, Math.min(n - 1, Math.round(m / lap.stepM)))
        const pt = (i: number): [number, number] => [ox + (lap.mapX[i]! - minX) * scale, MAP_H - (oy + (lap.mapY[i]! - minY) * scale)]
        const path = (from: number, to: number) => {
            let d = ''
            for (let i = from; i <= to; i++) { const [x, y] = pt(i); d += `${i === from ? 'M' : 'L'}${fmt(x)} ${fmt(y)}` }
            return d
        }
        const per = Math.max(1, Math.round(SEGMENT_M / lap.stepM))
        const segments: { d: string; cls: BalanceClass; width: number }[] = []
        for (let i = 0; i < n - 1; i += per) {
            const to = Math.min(n - 1, i + per)
            let sum = 0, cnt = 0
            for (let j = i; j < to; j++) if (Number.isFinite(balance[j]!)) { sum += balance[j]!; cnt++ }
            if (!cnt) continue
            const v = sum / cnt
            const cls = classify(v)
            segments.push({ d: path(i, to), cls, width: cls === 'neutral' ? 3 : 4 + Math.min(1, Math.abs(v) / 20) * 5 })
        }
        // Corner labels sit on the outside of the corner.
        const labels = corners.map(c => {
            const i = at(c.lineApexM)
            const [x, y] = pt(i)
            const [ax, ay] = pt(Math.max(0, i - 2))
            const [bx, by] = pt(Math.min(n - 1, i + 2))
            const len = Math.hypot(bx - ax, by - ay) || 1
            const out = c.isLeft ? 1 : -1 // right-hand normal for left corners, left-hand for right corners
            return { n: c.number, x: x + out * -(by - ay) / len * 20, y: y + out * (bx - ax) / len * 20 }
        })
        return { outline: path(0, n - 1), segments, labels, start: pt(0), pt, at }
    }, [lap, balance, corners])

    const mark = moment ? geo.pt(geo.at(moment.atM)) : null
    return (
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full" role="img" aria-label={`Lap ${lap.lapNumber} track map coloured by understeer and oversteer`}>
            <path d={geo.outline} fill="none" className="stroke-edge-strong" strokeWidth={14} strokeLinejoin="round" />
            {geo.segments.map((s, k) => <path key={k} d={s.d} fill="none" className={STROKE[s.cls]} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />)}
            <circle cx={geo.start[0]} cy={geo.start[1]} r={5} className="fill-fg stroke-canvas" strokeWidth={2} />
            {geo.labels.map(l => (
                <text key={l.n} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="fill-fg-muted font-mono text-[12px] font-semibold">T{l.n}</text>
            ))}
            {mark && <circle cx={mark[0]} cy={mark[1]} r={13} fill="none" className="stroke-accent" strokeWidth={2.5} />}
        </svg>
    )
}

// ── Summary ──────────────────────────────────────────────────────────────────

function Summary({ lap, balance, corners, moments }: { lap: LapAnalysis; balance: Float32Array; corners: CornerInfo[]; moments: Moment[] }) {
    const share = { under: 0, neutral: 0, over: 0 }
    let total = 0
    for (const c of corners) {
        for (let i = Math.round(c.entryM / lap.stepM); i <= Math.round(c.exitM / lap.stepM) && i < balance.length; i++) {
            if (!Number.isFinite(balance[i]!)) continue
            share[classify(balance[i]!)]++
            total++
        }
    }
    const pct = (v: number) => (total ? Math.round(v / total * 100) : 0)
    const parts: { cls: BalanceClass; value: number }[] = [
        { cls: 'under', value: pct(share.under) }, { cls: 'neutral', value: pct(share.neutral) }, { cls: 'over', value: pct(share.over) },
    ]
    return (
        <section aria-label="Cornering balance" className="rounded-xl border border-edge bg-well px-4 py-3.5 flex flex-col gap-3">
            <div className="flex items-baseline gap-2"><span className="label text-fg-2">Cornering balance</span><span className="text-[11px] text-fg-faint">share of distance in corners</span></div>
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
                {parts.map(p => <span key={p.cls} className={p.cls === 'under' ? 'bg-gain' : p.cls === 'over' ? 'bg-loss' : 'bg-track'} style={{ width: `${p.value}%` }} />)}
            </div>
            <div className="grid grid-cols-3 gap-3">
                {parts.map(p => (
                    <div key={p.cls} className="flex flex-col gap-0.5">
                        <span className={clsx('num text-xl font-semibold', p.cls === 'neutral' ? 'text-fg-soft' : TEXT[p.cls])}>{p.value}%</span>
                        <span className="text-xs text-fg-subtle">{LABEL[p.cls].toLowerCase()}</span>
                    </div>
                ))}
            </div>
            <div className="flex gap-5 border-t border-line pt-2.5 text-xs text-fg-subtle">
                <span><span className="num font-semibold text-loss-fg">{moments.filter(m => m.kind === 'over').length}</span> oversteer moments</span>
                <span><span className="num font-semibold text-gain-fg">{moments.filter(m => m.kind === 'under').length}</span> understeer moments</span>
            </div>
        </section>
    )
}

/** Bars run from the centre: left = understeer, right = oversteer; full width at this many % of lock. */
const PHASE_SCALE = 15

function PhaseAverages({ phases, refPhases }: { phases: CornerPhases[]; refPhases: CornerPhases[] }) {
    const avg = (list: CornerPhases[], k: typeof PHASE_KEYS[number]) => {
        const v = list.map(p => p[k]).filter((x): x is number => x !== null)
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
    }
    return (
        <section aria-label="Balance by corner phase" className="flex-1 rounded-xl border border-edge bg-well px-4 py-3.5 flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2"><span className="label text-fg-2">By phase</span><span className="text-[11px] text-fg-faint">average over all corners</span></div>
            <div className="flex justify-between text-[11px] text-fg-faint"><span className="pl-16">← understeer</span><span className="pr-14">oversteer →</span></div>
            {PHASE_KEYS.map(k => {
                const v = avg(phases, k)
                const r = avg(refPhases, k)
                const w = Math.min(50, Math.abs(v) / PHASE_SCALE * 50)
                return (
                    <div key={k} className="grid grid-cols-[52px_minmax(0,1fr)_44px] items-center gap-3">
                        <span className="text-[13px] capitalize text-fg-soft">{k}</span>
                        <span className="relative h-[18px] rounded bg-field">
                            <span className="absolute inset-y-0 left-1/2 w-px bg-track" />
                            <span className={clsx('absolute top-[3px] h-3 rounded-[3px]', v >= 0 ? 'bg-loss' : 'bg-gain')} style={{ left: `${v >= 0 ? 50 : 50 - w}%`, width: `${w}%` }} />
                            <span className="absolute top-[3px] h-3 w-0.5 bg-fg-2" style={{ left: `${50 + Math.max(-50, Math.min(50, r / PHASE_SCALE * 50))}%` }} />
                        </span>
                        <span className={clsx('num text-right text-xs', TEXT[classify(v)])}>{signed(v, 1)}</span>
                    </div>
                )
            })}
            <span className="flex items-center gap-2 text-[11px] text-fg-faint"><span className="h-3 w-0.5 bg-fg-2" />reference lap</span>
        </section>
    )
}

// ── Balance over the lap ─────────────────────────────────────────────────────

/** The trace is clipped at ±this many % of lock. */
const TRACE_CLIP = 30

function BalanceOverLap({ lap, balance, refBalance, refLap, corners, moment }: {
    lap: LapAnalysis
    balance: Float32Array
    refBalance: Float32Array | null
    refLap: LapAnalysis
    corners: CornerInfo[]
    moment: Moment | null
}) {
    const PL = 40, PR = 10, Y0 = 90
    const lengthM = (refLap.distM.length - 1) * refLap.stepM
    const X = (m: number) => PL + m / lengthM * (TRACE_W - PL - PR)
    const Y = (v: number) => Y0 - Math.max(-TRACE_CLIP, Math.min(TRACE_CLIP, v)) / TRACE_CLIP * 76
    const paths = useMemo(() => {
        const area = (b: Float32Array, step: number, pick: (v: number) => number) => {
            let d = `M${fmt(X(0))} ${Y0}`
            for (let i = 0; i < b.length; i++) d += `L${fmt(X(i * step))} ${fmt(Y(Number.isFinite(b[i]!) ? pick(b[i]!) : 0))}`
            return `${d}L${fmt(X((b.length - 1) * step))} ${Y0}Z`
        }
        const line = (b: Float32Array, step: number) => {
            let d = ''
            let pen = false
            for (let i = 0; i < b.length; i++) {
                if (!Number.isFinite(b[i]!)) { pen = false; continue }
                d += `${pen ? 'L' : 'M'}${fmt(X(i * step))} ${fmt(Y(b[i]!))}`
                pen = true
            }
            return d
        }
        return {
            over: area(balance, lap.stepM, v => Math.max(0, v)),
            under: area(balance, lap.stepM, v => Math.min(0, v)),
            ref: refBalance ? line(refBalance, refLap.stepM) : null,
        }
        // X and Y only depend on the lap length, which comes with refLap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [balance, refBalance, lap, refLap])
    const ticks: number[] = []
    for (let m = 0; m <= lengthM; m += 1000) ticks.push(m)

    return (
        <section aria-label="Balance over the lap" className="rounded-xl border border-edge bg-well px-3.5 pt-3 pb-2 flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
                <span className="label text-fg-2">Balance over the lap</span>
                <span className="text-[11px] text-fg-faint">steering beyond (−) or short of (+) what the car usually needs here, % of lock</span>
            </div>
            <svg viewBox={`0 0 ${TRACE_W} 190`} className="block h-auto w-full font-mono text-[11px]">
                {corners.map(c => (
                    <g key={c.number}>
                        <rect x={X(c.entryM)} y={14} width={Math.max(1, X(c.exitM) - X(c.entryM))} height={152} className="fill-fg/[0.03]" />
                        <text x={X(c.lineApexM)} y={10} textAnchor="middle" className="fill-fg-faint">T{c.number}</text>
                    </g>
                ))}
                {[20, -20].map(v => (
                    <g key={v}>
                        <line x1={PL} x2={TRACE_W - PR} y1={Y(v)} y2={Y(v)} className="stroke-row" />
                        <text x={PL - 6} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="fill-fg-faint">{signed(v)}</text>
                    </g>
                ))}
                <text x={PL - 6} y={Y0} textAnchor="end" dominantBaseline="middle" className="fill-fg-faint">0</text>
                <path d={paths.over} className="fill-loss/75" />
                <path d={paths.under} className="fill-gain/75" />
                {paths.ref && <path d={paths.ref} fill="none" className="stroke-fg-2" strokeWidth={1.25} strokeDasharray="3 3" />}
                <line x1={PL} x2={TRACE_W - PR} y1={Y0} y2={Y0} className="stroke-track" />
                {moment && <line x1={X(moment.atM)} x2={X(moment.atM)} y1={14} y2={166} className="stroke-accent" strokeWidth={1.5} />}
                {ticks.map(m => <text key={m} x={X(m)} y={184} textAnchor="middle" className="fill-fg-faint">{m === 0 ? '0 m' : `${m / 1000} km`}</text>)}
            </svg>
            <div className="flex gap-4 text-[11px] text-fg-faint">
                {refBalance && <span className="flex items-center gap-1.5"><span className="w-3.5 border-t-[1.5px] border-dashed border-fg-2" />reference lap</span>}
                <span>Shaded bands: corners of the reference lap</span>
            </div>
        </section>
    )
}

// ── Per corner ───────────────────────────────────────────────────────────────

const CORNER_COLS = 'grid grid-cols-[64px_repeat(3,minmax(0,1fr))_88px] gap-3'
const CELL_BG: Record<BalanceClass, string> = { under: 'bg-gain/10', neutral: 'bg-field border border-line', over: 'bg-loss/10' }

function CornerTable({ laps, lapIdx, phases }: { laps: LapAnalysis[]; lapIdx: number; phases: CornerPhases[][] }) {
    const ref = laps[0]!
    const lap = laps[lapIdx]!
    return (
        <section aria-label="Balance per corner" className="rounded-xl border border-edge bg-well">
            <div className="flex items-baseline gap-2 border-b border-edge px-4 py-3">
                <span className="label text-fg-2">Per corner</span>
                <span className="text-[11px] text-fg-faint">
                    {lapIdx === 0 ? `reference lap · neutral within ±${NEUTRAL_BAND} % of lock` : `lap ${lap.lapNumber} against the reference: more lock = more understeer, less lock = more oversteer · differences under ${NEUTRAL_BAND} % count as alike`}
                </span>
            </div>
            {ref.corners.length === 0 ? <p className="px-4 py-4 text-xs text-fg-faint">No corners were detected in the reference lap.</p> : (
                <>
                    <div className={clsx(CORNER_COLS, 'px-4 pt-2.5 pb-1.5')}>
                        <span className="label">Corner</span>
                        <span className="label">Entry</span>
                        <span className="label">Mid</span>
                        <span className="label">Exit</span>
                        <span className="label text-right">Min km/h</span>
                    </div>
                    {ref.corners.map((c, ci) => {
                        const minKmh = lapIdx === 0 ? c.minSpeedKmh : matchCorner(lap.corners, c.apexM)?.minSpeedKmh ?? null
                        return (
                            <div key={c.number} className={clsx(CORNER_COLS, 'min-h-[50px] items-center border-t border-row px-4 py-1.5')}>
                                <span className="flex items-baseline gap-1.5"><span className="num text-[15px] font-semibold text-fg">T{c.number}</span><span className="text-[11px] text-fg-subtle">{c.isLeft ? 'L' : 'R'}</span></span>
                                {PHASE_KEYS.map(k => <PhaseCell key={k} value={phases[lapIdx]![ci]![k]} refValue={lapIdx === 0 ? undefined : phases[0]![ci]![k]} />)}
                                <span className="num text-right text-[13px] text-fg-soft">{minKmh === null ? '—' : Math.round(minKmh)}</span>
                            </div>
                        )
                    })}
                </>
            )}
        </section>
    )
}

function PhaseCell({ value, refValue }: { value: number | null; refValue: number | null | undefined }) {
    if (value === null) return <span className="flex h-9 items-center rounded-md bg-field px-2.5 text-xs text-fg-faint">—</span>
    const cls = classify(value)
    const d = refValue == null ? null : value - refValue
    return (
        <span className={clsx('flex h-9 items-center justify-between gap-2 rounded-md px-2.5', CELL_BG[cls])}>
            <span className="flex flex-col">
                <span className={clsx('text-xs font-semibold', TEXT[cls])}>{LABEL[cls]}</span>
                <span className="text-[10px] text-fg-subtle">
                    {refValue === undefined ? 'reference'
                        : d === null ? '—'
                            : Math.abs(d) < NEUTRAL_BAND ? 'like reference'
                                : `${Math.round(Math.abs(d))}% ${d > 0 ? 'less' : 'more'} lock than ref`}
                </span>
            </span>
            {cls !== 'neutral' && <span className={clsx('num text-xs', TEXT[cls])}>{signed(value)}%</span>}
        </span>
    )
}

// ── Side panel ───────────────────────────────────────────────────────────────

function Moments({ moments, selected, onPick }: { moments: Moment[]; selected: number | null; onPick: (i: number) => void }) {
    return (
        <section aria-label="Moments" className="rounded-xl border border-edge bg-well px-2 pt-3 pb-2 flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2 px-2 pb-2"><span className="label text-fg-2">Moments</span><span className="text-[11px] text-fg-faint">click to show on map</span></div>
            {moments.length === 0 && <p className="px-2 pb-2 text-xs text-fg-faint">No clear slides on this lap.</p>}
            {moments.map((m, i) => (
                <button key={`${m.kind}${m.atM}`} aria-pressed={i === selected} onClick={() => onPick(i)}
                    className={clsx('grid min-h-12 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors', i === selected ? 'bg-selected' : 'hover:bg-hover')}>
                    <span className={clsx('h-2 w-2 rounded-full', m.kind === 'over' ? 'bg-loss' : 'bg-gain')} />
                    <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-fg">
                            {m.kind === 'over' ? 'Oversteer' : 'Understeer'}{m.corner ? ` · T${m.corner.number} ${m.phase}` : ''}
                        </span>
                        <span className="text-xs text-fg-subtle">
                            {m.kind === 'over'
                                ? `${Math.round(m.peak)}% less lock than usual`
                                : `${Math.round(-m.peak)}% more lock than usual`}
                            {' · '}{Math.round(m.toM - m.fromM)} m
                        </span>
                    </span>
                    <span className="num text-[11px] text-fg-faint">{Math.round(m.atM).toLocaleString('en-US')} m</span>
                </button>
            ))}
        </section>
    )
}

function Method() {
    return (
        <section aria-label="How balance is measured" className="rounded-xl border border-edge bg-well px-4 pt-3 pb-3.5 flex flex-col gap-2 text-xs leading-relaxed text-fg-muted">
            <span className="label text-fg-2">How it's measured</span>
            <p>LMU records no yaw rate or tyre slip. Balance is estimated from the steering you used against the steering this car usually needs for the line you drove — the curvature of the GPS path at that speed, learnt from the reference lap.</p>
            <p><span className="text-gain-fg">More lock</span> than usual means the front is sliding. <span className="text-loss-fg">Less, or opposite lock</span>, means the rear is stepping out.</p>
            <p className="text-fg-faint">Within ±{NEUTRAL_BAND} % counts as neutral. Kerbs and an imprecise GPS line can show up as short spikes.</p>
        </section>
    )
}
