import type { AnalysisResult, CornerInfo, LapAnalysis } from '@shared/analysis'
import { balanceTrace, cornerPhases, fitSteerModel } from '@shared/balance'
import { formatDelta, formatLapTime } from '@shared/format'
import type { SetupEntry } from '@shared/setup'
import clsx from 'clsx'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { matchCorner } from '../../lib/corners'
import { formatDateTime } from '../../lib/format'
import { cellDiffers, SETUP_GROUPS, setupChanges, setupRows, STRATEGY_GROUPS, type SetupRow } from '../../lib/setup'
import EmptyState from '../EmptyState'

/** Badge colours per setup letter (theme tokens, full class names for Tailwind). */
const BADGE = ['bg-accent text-on-accent', 'bg-gain text-canvas', 'bg-best text-canvas', 'bg-loss text-canvas', 'bg-ok text-canvas']
/** Corners slower than this (reference minimum speed) count as slow. */
const SLOW_KMH = 120
/** Track temperatures this close count as the same conditions, °C. */
const TEMP_TOLERANCE = 2

interface SetupGroupInfo {
    letter: string
    sessionId: number
    entries: SetupEntry[] | null
    laps: LapAnalysis[]
    best: LapAnalysis
}

/** Compares the car setups of the compared laps; laps from one session share one setup. */
export default function Setup({ result, colors }: { result: AnalysisResult; colors: string[] }) {
    const [onlyDiff, setOnlyDiff] = useState(true)
    const [cmp, setCmp] = useState(1)

    const groups = useMemo<SetupGroupInfo[]>(() => {
        const bySession = new Map<number, LapAnalysis[]>()
        for (const l of result.laps) bySession.set(l.sessionId, [...(bySession.get(l.sessionId) ?? []), l])
        return [...bySession.entries()].map(([sessionId, laps], k) => ({
            letter: String.fromCharCode(65 + k),
            sessionId,
            entries: result.setups[sessionId] ?? null,
            laps,
            best: laps.reduce((a, l) => ((l.lapTimeMs ?? Infinity) < (a.lapTimeMs ?? Infinity) ? l : a)),
        }))
    }, [result])
    const rows = useMemo(() => setupRows(groups.map(g => g.entries)), [groups])

    if (groups.every(g => !g.entries)) {
        return (
            <EmptyState icon={<SlidersHorizontal size={28} />} title="No setup recorded">
                <p>These recordings contain no car setup. LMU stores it with each recording made from the garage.</p>
            </EmptyState>
        )
    }

    const single = groups.length < 2
    const showAll = !onlyDiff || single
    const other = groups[Math.min(Math.max(1, cmp), groups.length - 1)]
    const cars = new Set(result.laps.map(l => l.car))
    const colorOf = (l: LapAnalysis) => colors[result.laps.indexOf(l)]!

    return (
        <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto px-6 pt-4 pb-5 flex flex-col gap-3">
                {cars.size > 1 && (
                    <p className="rounded-lg bg-warn-bg px-4 py-2.5 text-[13px] text-warn-fg">
                        The compared laps use different cars ({[...cars].map(c => c ?? 'unknown').join(', ')}) — their setups are not directly comparable.
                    </p>
                )}
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, minmax(0, 1fr))` }}>
                    {groups.map((g, k) => (
                        <SetupCard key={g.sessionId} group={g} index={k} changes={k === 0 ? null : setupChanges(rows, k)} colorOf={colorOf} />
                    ))}
                </div>
                <SetupTable groups={groups} rows={rows} showAll={showAll} onlyDiff={onlyDiff} single={single} onToggle={() => setOnlyDiff(v => !v)} />
            </div>

            <aside className="w-[380px] shrink-0 border-l border-line p-4 flex flex-col gap-3 overflow-y-auto">
                {single || !other ? (
                    <section aria-label="Setup comparison" className="rounded-xl border border-edge bg-well px-4 py-3.5 text-xs leading-relaxed text-fg-muted">
                        <span className="label text-fg-2">One setup</span>
                        <p className="mt-2">All compared laps come from one session and share its setup. Add laps from another session to see what a setup change did on track.</p>
                    </section>
                ) : (
                    <>
                        <Effects result={result} groups={groups} other={other} changes={setupChanges(rows, groups.indexOf(other))} onPick={setCmp} />
                        <FairTest a={groups[0]!} b={other} k={groups.indexOf(other)} rows={rows} />
                    </>
                )}
            </aside>
        </div>
    )
}

function Badge({ index, small = false }: { index: number; small?: boolean }) {
    return (
        <span className={clsx('flex shrink-0 items-center justify-center rounded-md font-display font-bold', BADGE[index % BADGE.length],
            small ? 'h-5 w-5 text-xs' : 'h-[26px] w-[26px] text-sm')} style={{ fontStretch: '118%' }}>
            {String.fromCharCode(65 + index)}
        </span>
    )
}

function SetupCard({ group, index, changes, colorOf }: { group: SetupGroupInfo; index: number; changes: number | null; colorOf: (l: LapAnalysis) => string }) {
    const s = group.best
    return (
        <section aria-label={`Setup ${group.letter}`} className={clsx('rounded-xl border bg-well px-4 py-3 flex flex-col gap-1.5', index === 0 ? 'border-edge-strong' : 'border-edge')}>
            <div className="flex items-center gap-2.5">
                <Badge index={index} />
                <span className="text-sm font-semibold text-fg-strong">{s.sessionType ?? 'Session'}</span>
                {index === 0 && <span className="label ml-auto">baseline</span>}
            </div>
            <span className="text-xs text-fg-subtle">{s.recordedAt ? formatDateTime(s.recordedAt) : 'unknown date'}</span>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1">
                {group.laps.map(l => (
                    <span key={l.lapId} className="flex items-center gap-1.5 text-xs text-fg-2">
                        <span className="h-[3px] w-3 rounded-full" style={{ background: colorOf(l) }} />lap {l.lapNumber}
                    </span>
                ))}
            </div>
            <div className="flex items-baseline gap-2.5 pt-1">
                <span className="num text-[15px] font-semibold text-fg-strong">{formatLapTime(s.lapTimeMs)}</span>
                <span className="text-xs text-fg-subtle">best of {group.laps.length} {group.laps.length === 1 ? 'lap' : 'laps'}</span>
            </div>
            <span className={clsx('text-xs', changes === null ? 'text-fg-faint' : changes ? 'text-accent' : 'text-fg-muted')}>
                {!group.entries ? 'No setup in this recording'
                    : changes === null ? 'Setup of the reference lap'
                        : changes ? `${changes} ${changes === 1 ? 'setting differs' : 'settings differ'} from A`
                            : 'Same setup as A'}
            </span>
        </section>
    )
}

// ── Table ────────────────────────────────────────────────────────────────────

function SetupTable({ groups, rows, showAll, onlyDiff, single, onToggle }: {
    groups: SetupGroupInfo[]
    rows: SetupRow[]
    showAll: boolean
    onlyDiff: boolean
    single: boolean
    onToggle: () => void
}) {
    const cols = { gridTemplateColumns: `minmax(0, 1.3fr) repeat(${groups.length}, minmax(0, 1fr))` }
    const visible = rows.filter(r => showAll || r.differs)
    return (
        <section aria-label="Setup comparison" className="rounded-xl border border-edge bg-well">
            <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2.5 min-h-[52px]">
                <span className="label text-fg-2">Setup</span>
                <span className="text-[11px] text-fg-faint">{showAll ? 'all settings this car can change' : 'settings that differ between the setups'}</span>
                {!single && (
                    <button role="switch" aria-checked={onlyDiff} onClick={onToggle}
                        className="ml-auto flex h-8 items-center gap-2.5 rounded-lg border border-edge bg-field pl-3 pr-1 text-xs text-fg-soft">
                        Only differences
                        <span className={clsx('relative h-[22px] w-9 rounded-full transition-colors', onlyDiff ? 'bg-accent' : 'bg-edge-strong')}>
                            <span className={clsx('absolute top-[3px] h-4 w-4 rounded-full transition-all', onlyDiff ? 'left-[17px] bg-on-accent' : 'left-[3px] bg-fg-muted')} />
                        </span>
                    </button>
                )}
            </div>
            <div className="sticky top-0 z-10 grid gap-4 bg-well px-4 pt-2.5 pb-2" style={cols}>
                <span className="label">Setting</span>
                {groups.map((g, k) => (
                    <span key={g.sessionId} className="flex items-center gap-2"><Badge index={k} small /><span className="truncate text-xs text-fg-muted">{g.best.sessionType}</span></span>
                ))}
            </div>
            {visible.length === 0 && <p className="border-t border-edge px-4 py-4 text-xs text-fg-faint">The setups are identical.</p>}
            {SETUP_GROUPS.map(name => {
                const inGroup = visible.filter(r => r.group === name)
                if (!inGroup.length) return null
                const changed = rows.filter(r => r.group === name && r.differs).length
                return (
                    <div key={name}>
                        <div className="flex items-center gap-2.5 border-t border-edge px-4 pt-3.5 pb-1.5">
                            <span className="text-xs font-semibold text-fg-strong">{name}{STRATEGY_GROUPS.has(name) ? ' · strategy, not setup' : ''}</span>
                            {!single && <span className={clsx('text-[11px]', changed ? 'text-accent' : 'text-fg-faint')}>{changed ? `${changed} changed` : 'no changes'}</span>}
                        </div>
                        {inGroup.map(r => (
                            <div key={r.id} className="grid min-h-9 items-center gap-4 border-t border-row px-4 py-1" style={cols}>
                                <span className="flex items-baseline gap-2 text-[13px] text-fg-soft">{r.label}{r.sub && <span className="text-[11px] text-fg-faint">{r.sub}</span>}</span>
                                {r.cells.map((c, k) => {
                                    const changed = k > 0 && cellDiffers(r, k)
                                    return (
                                        <span key={k} className={clsx('flex h-[26px] items-center rounded-md px-2', changed && 'bg-accent/10')}>
                                            <span className={clsx('num truncate text-xs', changed ? 'font-semibold text-fg-strong' : k === 0 ? 'text-fg-soft' : 'text-fg-subtle')}
                                                title={c?.text}>{c?.text || '—'}</span>
                                        </span>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                )
            })}
            <p className="border-t border-edge px-4 pt-2.5 pb-3 text-xs text-fg-faint">
                Values as LMU shows them in the garage, read from each recording. {!single && 'Highlighted: differs from setup A.'} LMU stores the setup once per recording.
            </p>
        </section>
    )
}

// ── What changed on track ────────────────────────────────────────────────────

interface EffectRow {
    label: string
    sub?: string
    a: string
    b: string
    d: string
    tone: 'gain' | 'loss' | 'flat'
    /** Short explanation shown when hovering the difference. */
    hint?: string
}

const TONE = { gain: 'text-gain-fg', loss: 'text-loss-fg', flat: 'text-fg-muted' }
const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)
const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

/** Mean balance per phase over the reference corners. */
function phaseMeans(lap: LapAnalysis, corners: CornerInfo[], model: NonNullable<ReturnType<typeof fitSteerModel>>) {
    const b = balanceTrace(lap, model)
    const ph = corners.map(c => cornerPhases(b, lap.stepM, { ...c, apexM: c.lineApexM }))
    return {
        entry: avg(ph.flatMap(p => (p.entry === null ? [] : [p.entry]))),
        mid: avg(ph.flatMap(p => (p.mid === null ? [] : [p.mid]))),
        exit: avg(ph.flatMap(p => (p.exit === null ? [] : [p.exit]))),
    }
}

function effectRows(ref: LapAnalysis, a: LapAnalysis, b: LapAnalysis, letter: string): EffectRow[] {
    const rows: EffectRow[] = []
    if (a.lapTimeMs !== null && b.lapTimeMs !== null) {
        const d = b.lapTimeMs - a.lapTimeMs
        rows.push({ label: 'Best lap', a: formatLapTime(a.lapTimeMs), b: formatLapTime(b.lapTimeMs), d: formatDelta(d), tone: d > 0 ? 'loss' : 'gain' })
    }
    const top = (l: LapAnalysis) => l.speed.reduce((m, v) => Math.max(m, v), 0)
    const dTop = top(b) - top(a)
    rows.push({ label: 'Top speed', sub: 'km/h', a: top(a).toFixed(0), b: top(b).toFixed(0), d: signed(dTop, 0), tone: Math.abs(dTop) < 1 ? 'flat' : dTop > 0 ? 'gain' : 'loss' })

    for (const slow of [true, false]) {
        const pairs = ref.corners.filter(c => (c.minSpeedKmh < SLOW_KMH) === slow).flatMap(c => {
            const ca = matchCorner(a.corners, c.apexM)
            const cb = matchCorner(b.corners, c.apexM)
            return ca && cb ? [[ca.minSpeedKmh, cb.minSpeedKmh] as const] : []
        })
        if (!pairs.length) continue
        const va = avg(pairs.map(p => p[0]))!
        const vb = avg(pairs.map(p => p[1]))!
        rows.push({
            label: slow ? 'Slow corners' : 'Fast corners', sub: `avg min km/h · ${pairs.length} ${pairs.length === 1 ? 'corner' : 'corners'}`,
            a: va.toFixed(1), b: vb.toFixed(1), d: signed(vb - va, 1), tone: Math.abs(vb - va) < 0.5 ? 'flat' : vb > va ? 'gain' : 'loss',
        })
    }

    const brakeDiffs = ref.corners.flatMap(c => {
        const ca = matchCorner(a.corners, c.apexM)
        const cb = matchCorner(b.corners, c.apexM)
        return ca?.brakeM != null && cb?.brakeM != null ? [cb.brakeM - ca.brakeM] : []
    })
    const dBrake = avg(brakeDiffs)
    if (dBrake !== null) {
        const m = Math.round(dBrake)
        rows.push({ label: 'Brake points', sub: `avg over ${brakeDiffs.length} corners`, a: '—', b: m === 0 ? 'same' : `${Math.abs(m)} m ${m > 0 ? 'later' : 'earlier'}`, d: '', tone: m > 0 ? 'gain' : m < 0 ? 'loss' : 'flat' })
    }

    const model = fitSteerModel(ref)
    if (model) {
        const pa = phaseMeans(a, ref.corners, model)
        const pb = phaseMeans(b, ref.corners, model)
        for (const k of ['entry', 'mid', 'exit'] as const) {
            const va = pa[k]
            const vb = pb[k]
            if (va === null || vb === null) continue
            const d = vb - va
            const alike = Math.abs(d) < 1.5
            rows.push({
                label: `Balance · ${k}`, sub: '% of lock, + = oversteer', a: signed(va, 1), b: signed(vb, 1),
                d: alike ? '≈' : d > 0 ? 'looser' : 'tighter', tone: 'flat',
                hint: alike
                    ? `About the same balance at corner ${k} with ${letter} as with A.`
                    : d > 0
                        ? `Looser: with ${letter} you needed ${Math.abs(d).toFixed(1)} % less steering lock at corner ${k} than with A — the car tends more to oversteer.`
                        : `Tighter: with ${letter} you needed ${Math.abs(d).toFixed(1)} % more steering lock at corner ${k} than with A — the car tends more to understeer.`,
            })
        }
    }
    return rows
}

function Effects({ result, groups, other, changes, onPick }: {
    result: AnalysisResult
    groups: SetupGroupInfo[]
    other: SetupGroupInfo
    changes: number
    onPick: (k: number) => void
}) {
    const a = groups[0]!
    const rows = useMemo(() => effectRows(result.laps[0]!, a.best, other.best, other.letter), [result, a, other])
    const k = groups.indexOf(other)
    return (
        <section aria-label="What changed on track" className="rounded-xl border border-edge bg-well">
            <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5">
                <span className="label text-fg-2">What changed on track</span>
            </div>
            {groups.length > 2 && (
                <div className="flex items-center gap-2 px-4 pb-2.5">
                    <span className="text-xs text-fg-subtle">A vs</span>
                    <div role="tablist" aria-label="Compare setup" className="segmented p-0.5">
                        {groups.slice(1).map((g, i) => (
                            <button key={g.sessionId} role="tab" aria-selected={g === other} onClick={() => onPick(i + 1)}
                                className={clsx('segment h-[26px] px-3 text-xs font-semibold', g === other && 'segment-on')}>{g.letter}</button>
                        ))}
                    </div>
                </div>
            )}
            {changes === 0 && other.entries && (
                <p className="mx-4 mb-3 rounded-lg bg-field px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
                    Same setup as A — lap time differences come from the driving, fuel load or conditions.
                </p>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_62px] gap-2 border-t border-row px-4 py-1.5">
                <span />
                <span className="flex justify-end"><Badge index={0} small /></span>
                <span className="flex justify-end"><Badge index={k} small /></span>
                <span className="label text-right">Δ</span>
            </div>
            {rows.map(r => (
                <div key={r.label} className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_70px_70px_62px] items-center gap-2 border-t border-row px-4 py-1">
                    <span className="flex flex-col"><span className="text-[13px] text-fg-soft">{r.label}</span>{r.sub && <span className="text-[11px] text-fg-faint">{r.sub}</span>}</span>
                    <span className="num text-right text-xs text-fg-2">{r.a}</span>
                    <span className="num text-right text-xs text-fg-strong">{r.b}</span>
                    <span className={clsx('num text-right text-xs', TONE[r.tone], r.hint && 'cursor-help underline decoration-dotted underline-offset-2')} title={r.hint}>{r.d}</span>
                </div>
            ))}
            <p className="border-t border-row px-4 pt-2.5 pb-3 text-[11px] leading-relaxed text-fg-faint">
                Best lap of each setup. Corner speeds are the average minimum speed in the reference lap's corners below or above {SLOW_KMH} km/h; balance as in the Balance tab.
            </p>
        </section>
    )
}

// ── Fair test ────────────────────────────────────────────────────────────────

/** Whether setup A and setup `k` were driven in comparable conditions. */
function FairTest({ a, b, k, rows }: { a: SetupGroupInfo; b: SetupGroupInfo; k: number; rows: SetupRow[] }) {
    const setting = (label: string, sub: string, i: number) => rows.find(r => r.label === label && r.sub === sub)?.cells[i]?.text ?? null
    const ca = a.best.conditions
    const cb = b.best.conditions

    const items: { label: string; value: string; ok: boolean }[] = []
    const fa = setting('Fuel', '', 0)
    const fb = setting('Fuel', '', k)
    if (fa !== null || fb !== null) items.push({ label: 'Fuel load', value: fa === fb ? fa ?? '—' : `${fa ?? '—'} → ${fb ?? '—'}`, ok: fa === fb })
    const ta = setting('Compound', 'front', 0)
    const tb = setting('Compound', 'front', k)
    if (ta !== null || tb !== null) items.push({ label: 'Tyre compound', value: ta === tb ? 'same' : `${ta ?? '—'} → ${tb ?? '—'}`, ok: ta === tb })
    if (ca.trackTempC !== null && cb.trackTempC !== null) {
        const same = Math.abs(cb.trackTempC - ca.trackTempC) <= TEMP_TOLERANCE
        items.push({ label: 'Track temperature', value: `${ca.trackTempC.toFixed(1)} → ${cb.trackTempC.toFixed(1)} °C`, ok: same })
    }
    if (ca.weather || cb.weather) items.push({ label: 'Weather', value: ca.weather === cb.weather ? ca.weather ?? '—' : `${ca.weather ?? '—'} → ${cb.weather ?? '—'}`, ok: ca.weather === cb.weather })
    if (ca.wetnessPct !== null && cb.wetnessPct !== null && (ca.wetnessPct > 0 || cb.wetnessPct > 0)) {
        items.push({ label: 'Track wetness', value: `${ca.wetnessPct.toFixed(0)} → ${cb.wetnessPct.toFixed(0)} %`, ok: Math.abs(cb.wetnessPct - ca.wetnessPct) < 5 })
    }
    if (a.best.car !== b.best.car) items.push({ label: 'Car', value: 'different', ok: false })

    return (
        <section aria-label="Was it a fair test?" className="rounded-xl border border-edge bg-well px-4 pt-3 pb-3.5 flex flex-col gap-2">
            <span className="label text-fg-2">Was it a fair test?</span>
            {items.map(i => (
                <div key={i.label} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5">
                    <span className={clsx('h-2.5 w-2.5 rounded-full', i.ok ? 'bg-ok' : 'bg-warn-fg')} />
                    <span className="text-xs text-fg-soft">{i.label}</span>
                    <span className={clsx('num text-xs', i.ok ? 'text-fg-muted' : 'text-warn-fg')}>{i.value}</span>
                </div>
            ))}
            <p className="border-t border-line pt-2 text-[11px] leading-relaxed text-fg-faint">Setup effects are only clear when fuel, tyres and track conditions are close.</p>
        </section>
    )
}
