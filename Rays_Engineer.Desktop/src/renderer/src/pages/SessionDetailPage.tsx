import { formatDelta, formatLapTime, formatSectorTime } from '@shared/format'
import type { LapRow } from '@shared/types'
import clsx from 'clsx'
import { ArrowLeft, Share, Trash2 } from 'lucide-react'
import NotesTags from '../components/NotesTags'
import { CarClassChip, SessionTypeChip } from '../components/ui'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MAX_COMPARE, useAnalysisStore } from '../lib/analysisStore'
import { sessionTypeLabel, type CompareLap } from '../lib/compare'
import { formatDateTime } from '../lib/format'
import { callWorker, onWorkerEvent } from '../lib/worker'

type Detail = Awaited<ReturnType<typeof callWorker<'getSession'>>>
type SectorKey = 'sector1Ms' | 'sector2Ms' | 'sector3Ms'
const SECTORS: SectorKey[] = ['sector1Ms', 'sector2Ms', 'sector3Ms']

const COLS = 'grid grid-cols-[32px_40px_100px_112px_repeat(3,72px)_140px_minmax(0,1fr)_40px] gap-3 items-center px-4'

export default function SessionDetailPage() {
    const id = Number(useParams().id)
    const [detail, setDetail] = useState<Detail | null>(null)
    const [error, setError] = useState<string | null>(null)
    const basket = useAnalysisStore(s => s.basket)
    const [message, setMessage] = useState<string | null>(null)
    const navigate = useNavigate()

    const load = useCallback(() => {
        callWorker('getSession', { id }).then(setDetail).catch(e => setError(e instanceof Error ? e.message : String(e)))
    }, [id])
    useEffect(() => {
        load()
        return onWorkerEvent('sessions-changed', load)
    }, [load])

    if (error) return <p className="p-6 text-sm text-danger-fg">{error}</p>
    if (!detail) return null
    const { session: s, laps, reference, note: sessionNote, allTags } = detail
    const typeLabel = sessionTypeLabel(s)
    const baseName = [s.trackLayout ?? s.track, typeLabel, s.recordedAt?.slice(0, 10)].filter(Boolean).join(' ')

    async function exportSession() {
        const target = await window.api.dialog.savePackage(baseName, 'rses')
        if (!target) return
        setMessage('Exporting…')
        try { await callWorker('exportSession', { sessionId: s.id, targetPath: target }); setMessage(`Saved ${target}`) }
        catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    }

    async function remove() {
        try {
            if (await window.api.sessions.delete(s.id)) navigate('/sessions')
        } catch (e) {
            setMessage(e instanceof Error ? e.message : String(e))
        }
    }

    async function exportLap(lap: LapRow) {
        const target = await window.api.dialog.savePackage(`${baseName} lap ${lap.lapNumber} ${formatLapTime(lap.lapTimeMs).replace(/[:.]/g, '-')}`, 'rlap')
        if (!target) return
        setMessage('Exporting…')
        try { await callWorker('exportLap', { lapId: lap.id, targetPath: target }); setMessage(`Saved ${target}`) }
        catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    }

    const complete = laps.filter(l => l.kind === 'lap')
    const valid = complete.filter(l => l.isValid && l.lapTimeMs !== null)
    const best = valid.length ? Math.min(...valid.map(l => l.lapTimeMs!)) : null
    const bestLap = valid.find(l => l.lapTimeMs === best) ?? null
    const bestSector = (k: SectorKey) => {
        const v = complete.map(l => l[k]).filter((x): x is number => x !== null)
        return v.length ? Math.min(...v) : null
    }
    const bests: Record<SectorKey, number | null> = { sector1Ms: bestSector('sector1Ms'), sector2Ms: bestSector('sector2Ms'), sector3Ms: bestSector('sector3Ms') }
    const sectorSum = SECTORS.every(k => bests[k] !== null) ? SECTORS.reduce((a, k) => a + bests[k]!, 0) : null

    function compare(lapIds: number[]) {
        // The reference lap is always part of the comparison (first, in grey).
        const refId = reference?.lapId ?? null
        const ids = refId !== null && !lapIds.includes(refId) ? [refId, ...lapIds] : lapIds
        useAnalysisStore.getState().select(ids.slice(0, MAX_COMPARE + 1), refId ?? ids[0]!)
        navigate('/analysis')
    }

    const picked = new Set(basket.map(l => l.lapId))
    const basketFull = basket.length >= MAX_COMPARE + 1
    function togglePick(l: LapRow) {
        const lap: CompareLap = {
            lapId: l.id, sessionId: s.id, track: s.track, trackLayout: s.trackLayout, car: s.car, lapNumber: l.lapNumber,
            lapTimeMs: l.lapTimeMs, isValid: l.isValid, sessionType: typeLabel, recordedAt: s.recordedAt,
        }
        useAnalysisStore.getState().toggleBasket(lap)
    }

    return (
        <div className="px-10 pt-7 pb-12 flex flex-col gap-6">
            <Link to="/sessions" className="inline-flex items-center gap-1.5 self-start text-[13px] text-fg-muted hover:text-fg">
                <ArrowLeft size={14} /> Sessions
            </Link>

            <header className="-mt-2 flex items-end gap-6">
                <div className="flex min-w-0 flex-col gap-2.5">
                    <h1 className="page-title text-[40px]">{s.trackLayout ?? s.track}</h1>
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
                        <SessionTypeChip type={typeLabel} />
                        <CarClassChip carClass={s.carClass} />
                        {[s.car, s.weather, s.recordedAt && formatDateTime(s.recordedAt)].filter(Boolean).map((t, i) => (
                            <span key={i} className="flex items-center gap-2">{i > 0 && <span className="text-fg-ghost">·</span>}{t}</span>
                        ))}
                    </div>
                </div>
                <div className="ml-auto flex gap-2">
                    <button className="btn-ghost w-10 px-0 hover:text-danger-fg" onClick={remove} aria-label="Delete session" title="Delete session">
                        <Trash2 size={16} />
                    </button>
                    <button className="btn-ghost" onClick={exportSession} title="Export the whole session as .rses">
                        <Share size={16} /> Export .rses
                    </button>
                </div>
            </header>
            {message && <p className="-mt-3 text-xs text-fg-muted break-all">{message}</p>}

            <section aria-label="Summary" className="grid grid-cols-4 gap-3">
                <Stat label="Best lap" value={formatLapTime(best)} accent sub={bestLap ? `Lap ${bestLap.lapNumber}` : 'No valid lap'} />
                <Stat label="Best sectors combined" value={formatLapTime(sectorSum)} best
                    sub={sectorSum !== null && best !== null ? `${formatDelta(sectorSum - best)} vs best lap` : '—'} />
                <Stat label="Laps" value={String(complete.length)} sub={`${valid.length} valid`} />
                <Stat label="Reference" value={reference ? formatLapTime(reference.lapTimeMs) : '—'} sub="Best valid lap for track + car" />
            </section>

            {best !== null && <LapTimeStrip laps={laps} best={best} picked={picked} />}

            <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4">
                <section aria-label="Session notes and tags" className="card flex flex-col gap-3">
                    <NotesTags sessionId={s.id} note={sessionNote} tags={s.tags} allTags={allTags} />
                </section>
                <section aria-label="Sector bests" className="card flex flex-col gap-2.5">
                    <h2 className="section-title">Sector bests</h2>
                    {SECTORS.map((k, i) => {
                        const lap = complete.find(l => l[k] !== null && l[k] === bests[k])
                        return (
                            <div key={k} className="flex items-baseline gap-3">
                                <span className="label w-7">S{i + 1}</span>
                                <span className="num text-base font-semibold text-best">{formatSectorTime(bests[k])}</span>
                                {lap && <span className="ml-auto text-xs text-fg-subtle">lap {lap.lapNumber}</span>}
                            </div>
                        )
                    })}
                </section>
            </div>

            <p className="text-xs text-fg-subtle">Click a lap time to compare it with the reference, or tick laps — also from other sessions of the same track — and compare them in the panel on the right.</p>

            <section aria-label="Laps" className="-mt-2 overflow-hidden rounded-xl border border-edge bg-well">
                <div className={clsx(COLS, 'h-11 border-b border-edge')}>
                    <span /><span className="label">Lap</span><span className="label text-right">Time</span><span className="label">Δ Best</span>
                    <span className="label text-right">S1</span><span className="label text-right">S2</span><span className="label text-right">S3</span>
                    <span className="label pl-3">Info</span><span className="label">Notes</span><span />
                </div>
                {laps.map(l => {
                    const isBest = l.kind === 'lap' && l.isValid && l.lapTimeMs === best
                    const delta = l.isValid && best !== null && l.lapTimeMs !== null && !isBest ? l.lapTimeMs - best : null
                    return (
                        <div key={l.id} className={clsx(COLS, 'group h-11 border-t border-row hover:bg-hover', l.kind === 'partial' && 'text-fg-faint')}>
                            <span className="flex">
                                {l.kind === 'lap' && (
                                    <input type="checkbox" className="h-4 w-4 accent-accent" aria-label={`Add lap ${l.lapNumber} to comparison`}
                                        title={basketFull && !picked.has(l.id) ? `At most ${MAX_COMPARE + 1} laps` : 'Add to comparison'}
                                        checked={picked.has(l.id)} disabled={basketFull && !picked.has(l.id)} onChange={() => togglePick(l)} />
                                )}
                            </span>
                            <span className="num text-fg-subtle">{l.lapNumber}</span>
                            <span className={clsx('num text-right', isBest ? 'font-semibold text-accent' : l.isValid ? 'text-fg-strong' : 'text-fg-faint line-through')}>
                                {l.kind === 'lap' ? (
                                    <button className="hover:underline underline-offset-4" title="Compare with reference" onClick={() => compare([l.id])}>
                                        {formatLapTime(l.lapTimeMs)}
                                    </button>
                                ) : '—'}
                            </span>
                            <span className="flex items-center gap-2">
                                {delta !== null && <>
                                    <span className="h-1.5 rounded-full bg-track" style={{ width: Math.max(3, Math.min(56, Math.round(delta / 1500 * 56))) }} />
                                    <span className="num text-xs text-fg-muted">{formatDelta(delta)}</span>
                                </>}
                            </span>
                            {SECTORS.map(k => (
                                <span key={k} className={clsx('num text-right', l[k] !== null && l[k] === bests[k] ? 'font-semibold text-best' : 'text-fg-2')}>
                                    {l.kind === 'lap' ? formatSectorTime(l[k]) : ''}
                                </span>
                            ))}
                            <span className="truncate pl-3 text-xs text-fg-subtle">{info(l)}</span>
                            <LapNote lap={l} />
                            <span className="flex justify-end">
                                {l.kind === 'lap' && (
                                    <button aria-label={`Export lap ${l.lapNumber} as .rlap`} title="Export lap as .rlap" onClick={() => exportLap(l)} className="btn-icon">
                                        <Share size={14} />
                                    </button>
                                )}
                            </span>
                        </div>
                    )
                })}
            </section>
        </div>
    )
}

/** One bar per lap, taller = slower; the best lap in the accent colour, invalid laps hatched. */
function LapTimeStrip({ laps, best, picked }: { laps: LapRow[]; best: number; picked: Set<number> }) {
    const timed = laps.filter(l => l.kind === 'lap' && l.lapTimeMs !== null)
    const slowest = Math.max(...timed.filter(l => l.isValid).map(l => l.lapTimeMs!))
    const lo = best - 300
    const hi = Math.max(best + 1000, Math.min(slowest, best + 3000))
    return (
        <section aria-label="Lap times" className="rounded-xl border border-edge bg-well px-5 pt-5 pb-3.5 flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
                <h2 className="section-title">Lap times</h2>
                <span className="text-xs text-fg-subtle">Shorter is faster · hatched = invalid</span>
            </div>
            <div className="flex h-[132px] items-end gap-1.5 border-b border-edge">
                {laps.map(l => {
                    if (l.kind !== 'lap' || l.lapTimeMs === null) {
                        return <div key={l.id} className="flex h-full flex-1 items-end justify-center"><div className="h-1 w-full max-w-10 rounded-sm bg-edge" title={`Lap ${l.lapNumber} — incomplete`} /></div>
                    }
                    const isBest = l.isValid && l.lapTimeMs === best
                    const h = Math.round(20 + Math.max(0, Math.min(1, (l.lapTimeMs - lo) / (hi - lo))) * 90)
                    return (
                        <div key={l.id} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Lap ${l.lapNumber} · ${formatLapTime(l.lapTimeMs)}`}>
                            <span className={clsx('num text-[10px]', isBest ? 'text-accent' : 'text-fg-subtle')}>
                                {!l.isValid ? 'inv' : isBest ? formatLapTime(l.lapTimeMs).slice(2) : `+${((l.lapTimeMs - best) / 1000).toFixed(1)}`}
                            </span>
                            <div className={clsx('w-full max-w-10 rounded-t', isBest ? 'bg-accent' : l.isValid ? (picked.has(l.id) ? 'bg-fg-ghost' : 'bg-track') : '')}
                                style={{ height: h, ...(l.isValid ? {} : { background: 'repeating-linear-gradient(135deg, rgb(var(--c-edge-strong)) 0 4px, rgb(var(--c-hover)) 4px 8px)' }) }} />
                        </div>
                    )
                })}
            </div>
            <div className="flex gap-1.5">
                {laps.map(l => <span key={l.id} className="num flex-1 text-center text-[11px] text-fg-faint">{l.lapNumber}</span>)}
            </div>
        </section>
    )
}

/** Generated facts about a lap (validity, pit, partial) — not editable, unlike the user's notes. */
function info(l: LapRow): string {
    if (l.kind === 'partial') return l.inPits ? 'Out / in lap' : 'Incomplete'
    const parts: string[] = []
    if (!l.isValid) parts.push('Invalid')
    if (l.inPits) parts.push('Pit')
    return parts.join(' · ')
}

/** The user's own note on a lap: inline, saved on blur or Enter, Escape reverts. */
function LapNote({ lap }: { lap: LapRow }) {
    const [saved, setSaved] = useState(lap.note)
    const [text, setText] = useState(lap.note)
    useEffect(() => { setSaved(lap.note); setText(lap.note) }, [lap.id, lap.note])

    async function save() {
        const body = text.trim()
        if (body === saved) return
        try {
            await callWorker('setLapNote', { lapId: lap.id, body })
            setSaved(body)
        } catch {
            setText(saved)
        }
    }

    return (
        <input value={text} onChange={e => setText(e.target.value)} onBlur={() => void save()} maxLength={2000}
            onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { setText(saved); setTimeout(() => (e.target as HTMLInputElement).blur()) }
            }}
            aria-label={`Note for lap ${lap.lapNumber}`} placeholder="+ note" title={text || 'Add a note to this lap'}
            className="h-[30px] w-full truncate rounded-md border border-transparent bg-transparent px-2 text-xs text-fg-soft placeholder:text-fg-faint placeholder:opacity-0 group-hover:placeholder:opacity-100 focus:placeholder:opacity-100 focus:border-edge-strong focus:bg-field focus:outline-none" />
    )
}

function Stat({ label, value, sub, accent, best }: { label: string; value: string; sub: string; accent?: boolean; best?: boolean }) {
    return (
        <div className="rounded-xl border border-edge bg-card px-5 py-4 flex flex-col gap-1.5">
            <span className="label">{label}</span>
            <span className={clsx('num text-[28px] font-semibold leading-tight', accent ? 'text-accent' : best ? 'text-best' : 'text-fg-strong')}>{value}</span>
            <span className="text-xs text-fg-subtle">{sub}</span>
        </div>
    )
}
