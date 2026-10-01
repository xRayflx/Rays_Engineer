import type { IndexStatus, SessionRow } from '@shared/types'
import { formatLapTime } from '@shared/format'
import clsx from 'clsx'
import { Archive, ChevronDown, ChevronRight, ChevronUp, Download, FolderOpen, FolderSearch, Loader2, Search, Trash2 } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AutoRecordCard from '../components/AutoRecordCard'
import EmptyState from '../components/EmptyState'
import { CarClassChip, SessionTypeChip, Tag } from '../components/ui'
import { DEFAULT_SORT, nextSort, recordedMs, sessionTypeLabel, sortSessions, type SessionSort, type SortKey } from '../lib/compare'
import { formatDateTime } from '../lib/format'
import { describeImport, importPaths } from '../lib/importFiles'
import { useWorkerQuery } from '../lib/useWorker'

const COLS = 'grid grid-cols-[84px_minmax(0,1.5fr)_112px_minmax(0,1.2fr)_44px_96px_minmax(0,1.4fr)_minmax(0,0.8fr)_56px] gap-4 items-center px-5'

export default function SessionsPage() {
    const { data: status } = useWorkerQuery('getIndexStatus', ['status-changed'])
    const { data: sessions } = useWorkerQuery('listSessions', ['sessions-changed'])
    const [showAll, setShowAll] = useState(false)
    const [filter, setFilter] = useState('')
    const [type, setType] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [sort, setSortState] = useState<SessionSort>(loadSort)
    const setSort = (key: SortKey) => setSortState(cur => { const next = nextSort(cur, key); saveSort(next); return next })

    async function importDialog() {
        const paths = await window.api.dialog.pickImport()
        if (!paths.length) return
        setMessage('Importing…')
        try {
            const r = await importPaths(paths)
            setMessage(r ? describeImport(r) : null)
        } catch (e) {
            setMessage(e instanceof Error ? e.message : String(e))
        }
    }

    if (!status || !sessions) return null
    if (sessions.length === 0) return <NoSessions status={status} onImport={importDialog} />

    // Garage/pit-lane snippets and empty files have no complete lap — hidden unless asked for.
    const hasLaps = (s: SessionRow) => s.status !== 'parsed' ? s.status === 'unparsed' : (s.lapCount ?? 0) > 0
    const needle = filter.trim().toLowerCase()
    const matches = (s: SessionRow) => (!type || sessionTypeLabel(s) === type) && (!needle || [s.trackLayout, s.track, s.car, sessionTypeLabel(s), s.driver, s.note, ...s.tags]
        .some(v => v?.toLowerCase().includes(needle)))
    const shown = sessions.filter(matches)
    const visible = sortSessions(showAll ? shown : shown.filter(hasLaps), sort)
    const hidden = shown.length - shown.filter(hasLaps).length
    const types = [...new Set(sessions.map(sessionTypeLabel).filter((t): t is string => !!t))].sort()
    const trackCount = new Set(sessions.map(s => s.trackLayout ?? s.track).filter(Boolean)).size
    // Newest-first lists read best grouped by day; any other sort is one flat list.
    const groups = sort.key === 'recorded' ? groupByDay(visible) : [{ key: 'all', label: null, date: null, rows: visible }]

    return (
        <div className="px-10 pt-8 pb-12 flex flex-col gap-6">
            <AutoRecordCard compact />
            <header className="flex items-end gap-6">
                <div className="flex flex-col gap-2">
                    <h1 className="page-title">Sessions</h1>
                    <p className="text-[13px] text-fg-muted">
                        {sessions.length} recording{sessions.length === 1 ? '' : 's'} · {trackCount} track{trackCount === 1 ? '' : 's'}
                    </p>
                </div>
                <PendingHint count={status.pendingFiles} />
                <button className="btn-ghost ml-auto" onClick={importDialog} title="Import .rses, .rlap or .duckdb — or drop files on the window">
                    <Download size={16} /> Import
                </button>
            </header>

            <div className="flex flex-wrap items-center gap-3">
                <label className="relative flex w-80 items-center">
                    <Search size={16} className="pointer-events-none absolute left-3 text-fg-faint" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter track, car, tag, note…"
                        aria-label="Filter sessions" className="field w-full pl-9" />
                </label>
                {types.length > 1 && (
                    <div role="group" aria-label="Session type" className="segmented">
                        {[null, ...types].map(t => (
                            <button key={t ?? 'all'} className={clsx('segment', type === t && 'segment-on')} aria-pressed={type === t} onClick={() => setType(t)}>
                                {t ?? 'All'}
                            </button>
                        ))}
                    </div>
                )}
                {message && <p className="text-xs text-fg-muted">{message}</p>}
            </div>

            <section aria-label="Recordings" className="overflow-hidden rounded-xl border border-edge bg-well">
                <div role="row" className={clsx(COLS, 'h-11 border-b border-edge')}>
                    <SortHeader k="recorded" sort={sort} onSort={setSort}>Time</SortHeader>
                    <SortHeader k="track" sort={sort} onSort={setSort}>Track</SortHeader>
                    <SortHeader k="session" sort={sort} onSort={setSort}>Session</SortHeader>
                    <SortHeader k="car" sort={sort} onSort={setSort}>Car</SortHeader>
                    <SortHeader k="laps" sort={sort} onSort={setSort} right>Laps</SortHeader>
                    <SortHeader k="best" sort={sort} onSort={setSort} right>Best</SortHeader>
                    <span className="label">Tags &amp; notes</span>
                    <SortHeader k="driver" sort={sort} onSort={setSort}>Imported from</SortHeader>
                    <span />
                </div>
                {groups.map(g => (
                    <Fragment key={g.key}>
                        {g.label && (
                            <div className="flex items-baseline gap-2.5 px-5 pt-[18px] pb-2">
                                <span className="section-title">{g.label}</span>
                                <span className="text-xs text-fg-subtle">{g.date}</span>
                            </div>
                        )}
                        {g.rows.map(s => <Row key={s.id} s={s} grouped={!!g.label} />)}
                    </Fragment>
                ))}
                {visible.length === 0 && <p className="px-5 py-6 text-sm text-fg-subtle">No sessions match the filter.</p>}
                {hidden > 0 && (
                    <div className="border-t border-row px-5 py-3.5">
                        <button className="text-[13px] text-fg-muted hover:text-fg" onClick={() => setShowAll(v => !v)}>
                            {showAll ? 'Hide recordings without laps' : `Show ${hidden} recording${hidden === 1 ? '' : 's'} without laps`}
                        </button>
                    </div>
                )}
            </section>
        </div>
    )
}

function Row({ s, grouped }: { s: SessionRow; grouped: boolean }) {
    const navigate = useNavigate()
    const unavailable = s.fileMissing && !s.archivedPath
    const open = s.status === 'parsed' && !unavailable && (s.lapCount ?? 0) > 0
    const ms = recordedMs(s)
    return (
        <div
            role="row"
            className={clsx(COLS, 'min-h-16 border-t border-row py-2', unavailable && 'opacity-40', open && 'cursor-pointer hover:bg-hover')}
            onClick={open ? () => navigate(`/sessions/${s.id}`) : undefined}
            title={s.filePath}
        >
            {/* Within a day group the time is enough; ungrouped (sorted by another column) the date goes on top. */}
            <span className="num flex flex-col whitespace-nowrap text-[13px] leading-tight text-fg-muted" title={formatDateTime(ms)}>
                {!grouped && <span className="text-fg-soft">{new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
                <span className={clsx(!grouped && 'text-xs text-fg-subtle')}>{new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
            {s.status === 'parsed' ? (
                <>
                    <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold text-fg">{s.track ?? s.trackLayout ?? '—'}</span>
                        {s.trackLayout && s.trackLayout !== s.track && <span className="truncate text-xs text-fg-subtle">{s.trackLayout}</span>}
                    </span>
                    <span><SessionTypeChip type={sessionTypeLabel(s)} /></span>
                    <span className="flex min-w-0 items-center gap-2" title={s.car ?? undefined}>
                        <CarClassChip carClass={s.carClass} />
                        <span className="truncate text-fg-soft">{s.car ?? '—'}</span>
                    </span>
                    <span className="num justify-self-end text-fg-muted">{s.lapCount ?? 0}</span>
                    <span className="num justify-self-end whitespace-nowrap text-[15px] font-semibold text-fg-strong">{formatLapTime(s.bestLapMs)}</span>
                    <span className="flex min-w-0 flex-col gap-1" title={s.note || undefined}>
                        {s.tags.length > 0 && <span className="flex flex-wrap gap-1">{s.tags.map(t => <Tag key={t}>{t}</Tag>)}</span>}
                        {s.note && <span className="truncate text-fg-2">{s.note.split('\n')[0]}</span>}
                        {s.lapNoteCount > 0 && <span className="text-[11px] text-fg-subtle">{s.lapNoteCount} lap note{s.lapNoteCount === 1 ? '' : 's'}</span>}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5" title={s.origin === 'import' ? `Imported${s.driver ? ` · driven by ${s.driver}` : ''}` : undefined}>
                        {s.origin === 'import' && <>
                            <Download size={13} className="shrink-0 text-fg-faint" />
                            <span className="truncate text-fg-soft">{s.driver ?? 'Unknown driver'}</span>
                        </>}
                    </span>
                </>
            ) : (
                <span className="col-span-7 flex min-w-0 items-baseline gap-3 text-fg-subtle">
                    <span className="truncate text-fg-muted">{s.fileName}</span>
                    <span className="text-xs">{s.status === 'unparsed' ? 'Reading…' : s.error}</span>
                </span>
            )}
            <span className="flex items-center justify-end gap-1 text-fg-ghost">
                {!open && s.status !== 'unparsed' && (
                    <button aria-label="Delete recording" title="Delete" className="btn-icon hover:text-danger-fg"
                        onClick={e => { e.stopPropagation(); void window.api.sessions.delete(s.id) }}>
                        <Trash2 size={14} />
                    </button>
                )}
                {s.origin !== 'import' && s.archivedPath && (
                    <span title={s.fileMissing ? 'Original deleted — archived copy' : 'Archived in app data'}><Archive size={14} /></span>
                )}
                {open && <ChevronRight size={16} />}
            </span>
        </div>
    )
}

interface DayGroup { key: string; label: string | null; date: string | null; rows: SessionRow[] }

function groupByDay(rows: SessionRow[]): DayGroup[] {
    const groups: DayGroup[] = []
    const today = startOfDay(Date.now())
    for (const s of rows) {
        const day = startOfDay(recordedMs(s))
        const key = String(day)
        let g = groups[groups.length - 1]
        if (!g || g.key !== key) {
            const days = Math.round((today - day) / 86_400_000)
            const d = new Date(day)
            const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday'
                : days < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' })
                : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
            g = { key, label, date: days < 7 ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null, rows: [] }
            groups.push(g)
        }
        g.rows.push(s)
    }
    return groups
}

function startOfDay(ms: number): number {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

const SORT_KEY = 'rays.sessions.sort'
const SORT_KEYS: SortKey[] = ['recorded', 'track', 'session', 'car', 'driver', 'laps', 'best']

function loadSort(): SessionSort {
    try {
        const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as SessionSort | null
        return v && SORT_KEYS.includes(v.key) && (v.dir === 'asc' || v.dir === 'desc') ? v : DEFAULT_SORT
    } catch {
        return DEFAULT_SORT
    }
}

function saveSort(v: SessionSort): void {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(v)) } catch { /* storage unavailable */ }
}

function SortHeader({ k, sort, onSort, right, children }: { k: SortKey; sort: SessionSort; onSort: (k: SortKey) => void; right?: boolean; children: ReactNode }) {
    const active = sort.key === k
    const Icon = sort.dir === 'asc' ? ChevronUp : ChevronDown
    return (
        <span role="columnheader" className={clsx(right && 'justify-self-end')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button onClick={() => onSort(k)} className={clsx('label inline-flex items-center gap-1 hover:text-fg', active && 'text-fg-soft')}>
                {children}
                <Icon size={12} className={active ? '' : 'invisible'} />
            </button>
        </span>
    )
}

function PendingHint({ count }: { count: number }) {
    if (count === 0) return null
    return (
        <span className="flex items-center gap-2 pb-1 text-xs text-fg-muted">
            <Loader2 size={12} className="animate-spin text-accent" />
            Waiting for {count} file{count > 1 ? 's' : ''} to finish recording
        </span>
    )
}

function NoSessions({ status, onImport }: { status: IndexStatus; onImport: () => void }) {
    if (!status.activeFolder || !status.activeFolderExists) {
        return (
            <EmptyState icon={<FolderSearch size={28} />} title="Telemetry folder not found">
                <p>
                    Rays Engineer looks for <span className="text-fg-soft">UserData\Telemetry</span> in
                    your Le Mans Ultimate installation.
                </p>
                <p><Link to="/settings" className="text-accent hover:text-accent-hover">Choose the folder manually</Link>
                    {' '}or <button className="text-accent hover:text-accent-hover" onClick={onImport}>import a session</button>.</p>
            </EmptyState>
        )
    }
    return (
        <EmptyState icon={<FolderOpen size={28} />} title="No recordings yet">
            <p>Watching <span className="text-fg-soft break-all">{status.activeFolder}</span></p>
            <p>New sessions appear here on their own after you drive — or <button className="text-accent hover:text-accent-hover" onClick={onImport}>import</button> a .rses / .rlap file.</p>
            <div className="text-left pt-2"><AutoRecordCard compact /></div>
            <PendingHint count={status.pendingFiles} />
        </EmptyState>
    )
}
