import type { AppInfo, WorkerStatus } from '@shared/ipc'
import type { FolderCandidate, IndexStatus } from '@shared/types'
import clsx from 'clsx'
import { Check, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Switch } from '../components/ui'
import { formatDateTime } from '../lib/format'
import { THEMES, useThemeStore, type ThemeInfo } from '../lib/theme'
import { useWorkerQuery } from '../lib/useWorker'
import { callWorker } from '../lib/worker'

export default function SettingsPage() {
    return (
        <div className="px-10 pt-8 pb-12 max-w-5xl flex flex-col gap-6">
            <h1 className="page-title">Settings</h1>
            <AppearanceSection />
            <TelemetryFolderSection />
            <StorageSection />
            <div className="grid grid-cols-2 gap-4">
                <AboutSection />
                <DiagnosticsSection />
            </div>
        </div>
    )
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children?: React.ReactNode }) {
    return (
        <section aria-label={title} className="card flex flex-col gap-4 px-6 py-[22px]">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-fg">{title}</h2>
                    {description && <p className="text-[13px] leading-relaxed text-fg-muted">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

// ── Appearance ───────────────────────────────────────────────────────────────

function AppearanceSection() {
    const theme = useThemeStore(s => s.theme)
    const setTheme = useThemeStore(s => s.setTheme)
    return (
        <Section title="Appearance" description="Colour theme for the whole app, including charts and the track map.">
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
                {THEMES.map(t => <ThemeOption key={t.id} theme={t} selected={theme === t.id} onSelect={() => setTheme(t.id)} />)}
            </div>
        </Section>
    )
}

/** A miniature of the theme — sidebar, a card and the accent — drawn in its own colours. */
function ThemeOption({ theme, selected, onSelect }: { theme: ThemeInfo; selected: boolean; onSelect: () => void }) {
    const [ground, panel, text, accent] = theme.swatches
    return (
        <button role="radio" aria-checked={selected} onClick={onSelect}
            className={clsx('flex flex-col gap-3 rounded-xl border-[1.5px] p-3 text-left transition-colors',
                selected ? 'border-accent bg-accent-tint' : 'border-edge bg-well hover:border-edge-strong')}>
            <div className="flex h-20 overflow-hidden rounded-lg border border-black/10" style={{ background: ground }} aria-hidden="true">
                <div className="w-10 flex flex-col gap-1.5 p-2" style={{ background: panel }}>
                    <span className="h-1.5 w-full rounded-full" style={{ background: accent }} />
                    <span className="h-1.5 w-4/5 rounded-full opacity-40" style={{ background: text }} />
                    <span className="h-1.5 w-4/5 rounded-full opacity-40" style={{ background: text }} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <span className="h-2 w-2/3 rounded-full" style={{ background: text }} />
                    <span className="h-1.5 w-1/2 rounded-full opacity-50" style={{ background: text }} />
                    <span className="mt-auto h-4 w-14 rounded" style={{ background: accent }} />
                </div>
            </div>
            <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">{theme.name}</span>
                {selected && <Check size={14} className="ml-auto text-accent" />}
            </span>
            <span className="-mt-2 text-xs text-fg-muted">{theme.description}</span>
        </button>
    )
}

// ── Telemetry folder ─────────────────────────────────────────────────────────

function TelemetryFolderSection() {
    const { data: status, setData } = useWorkerQuery('getIndexStatus', ['status-changed', 'sessions-changed'])
    const [busy, setBusy] = useState(false)

    async function run(fn: () => Promise<IndexStatus>) {
        setBusy(true)
        try { setData(await fn()) } finally { setBusy(false) }
    }

    async function chooseFolder() {
        const path = await window.api.dialog.pickFolder(status?.activeFolder ?? undefined)
        if (path) await run(() => callWorker('setTelemetryFolder', { mode: 'manual', path }))
    }

    if (!status) return null
    const auto = status.folderSetting.mode === 'auto'

    return (
        <Section
            title="Telemetry folder"
            action={
                <div className="flex shrink-0 gap-2">
                    <button className="btn-ghost" disabled={busy} onClick={() => run(() => callWorker('rescan', undefined))}>
                        <RefreshCw size={15} className={clsx(busy && 'animate-spin')} /> Rescan
                    </button>
                    <button className="btn-ghost" disabled={busy} onClick={chooseFolder}>
                        <FolderOpen size={15} /> Choose folder…
                    </button>
                </div>
            }
        >
            <div className="-mt-2 flex flex-col gap-1.5">
                <div className="num text-sm text-fg-strong break-all select-text">{status.activeFolder ?? 'No folder found'}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {status.activeFolder && status.activeFolderExists
                        ? <span className="chip bg-ok-bg font-normal text-ok-fg"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{auto ? 'Detected automatically' : 'Chosen manually'}</span>
                        : <span className="chip bg-danger-bg font-normal text-danger-fg">{status.activeFolder ? 'Folder does not exist' : 'Not found'}</span>}
                    {status.lastScanAt && <span>Last scan {formatDateTime(status.lastScanAt)}</span>}
                    {!auto && (
                        <button className="text-accent hover:text-accent-hover" disabled={busy}
                            onClick={() => run(() => callWorker('setTelemetryFolder', { mode: 'auto', path: null }))}>
                            Use automatic detection
                        </button>
                    )}
                </div>
                {status.lastError && <div className="text-xs text-danger-fg">{status.lastError}</div>}
            </div>

            {status.candidates.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-edge bg-well">
                    <div className="border-b border-line px-4 py-2.5"><span className="label">Locations checked</span></div>
                    <ul>
                        {status.candidates.map(c => (
                            <CandidateRow key={c.path} c={c} active={c.path === status.activeFolder} />
                        ))}
                    </ul>
                </div>
            )}
        </Section>
    )
}

function CandidateRow({ c, active }: { c: FolderCandidate; active: boolean }) {
    return (
        <li className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-t border-row px-4 py-2 first:border-t-0">
            <span>{active && <Check size={14} className="text-accent" />}</span>
            <span className={clsx('num break-all text-xs select-text', c.exists ? 'text-fg-soft' : 'text-fg-faint')}>{c.path}</span>
            <span className="whitespace-nowrap text-xs text-fg-subtle">
                {c.exists ? `${c.duckdbCount} file${c.duckdbCount === 1 ? '' : 's'}` : 'not found'} · {c.source}
            </span>
        </li>
    )
}

// ── Storage ──────────────────────────────────────────────────────────────────

function StorageSection() {
    const { data: status, setData } = useWorkerQuery('getIndexStatus', ['status-changed'])
    const [busy, setBusy] = useState(false)
    if (!status) return null

    async function toggle() {
        setBusy(true)
        try { setData(await callWorker('setArchiveSessions', { enabled: !status!.archiveSessions })) } finally { setBusy(false) }
    }

    return (
        <Section
            title="Archive sessions in app data"
            description="Keeps a copy of every recording so it stays available if LMU's files are deleted. Turning this off keeps existing copies."
            action={<Switch checked={status.archiveSessions} disabled={busy} onChange={() => void toggle()} label="Archive sessions in app data" />}
        />
    )
}

// ── About / diagnostics ──────────────────────────────────────────────────────

function AboutSection() {
    const [info, setInfo] = useState<AppInfo | null>(null)
    useEffect(() => { window.api.app.getInfo().then(setInfo) }, [])
    return (
        <Section title="About">
            {info ? (
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
                    <Row label="Version" value={info.version} />
                    <Row label="Electron" value={`${info.electron} (Chromium ${info.chrome}, Node ${info.node})`} />
                    <Row label="Platform" value={`${info.platform} ${info.arch}`} />
                    <Row label="Data folder" value={info.userDataPath} />
                </dl>
            ) : <p className="text-sm text-fg-subtle">Loading…</p>}
        </Section>
    )
}

function DiagnosticsSection() {
    const [status, setStatus] = useState<WorkerStatus | null>(null)
    const [transfer, setTransfer] = useState<string | null>(null)
    const [inspect, setInspect] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function guard(fn: () => Promise<void>) {
        setError(null)
        try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    }

    const checkWorker = () => guard(async () => {
        setStatus(await window.api.worker.status())
        const t0 = performance.now()
        const res = await callWorker('transferTest', { samples: 100_000 })
        const binary = res.value instanceof Float32Array && res.distance instanceof Float32Array
        setTransfer(`${res.value.length.toLocaleString()} samples in ${(performance.now() - t0).toFixed(1)} ms${binary ? '' : ' (not binary!)'}`)
    })

    const inspectFile = () => guard(async () => {
        const path = await window.api.dialog.pickDuckDb()
        if (!path) return
        setInspect('Analysing…')
        const report = await callWorker('inspectDuckDb', { path })
        const name = path.split(/[\\/]/).pop()!.replace(/\.duckdb$/i, '')
        const saved = await window.api.dialog.saveText(`${name}.inspect.json`, JSON.stringify(report, null, 2))
        setInspect(saved ? `${report.tables.length} tables · saved to ${saved}` : null)
    })

    return (
        <Section title="Diagnostics">
            {(status || inspect) ? (
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
                    {status && <Row label="Worker PID" value={String(status.pid)} />}
                    {status && <Row label="Round trip" value={`${status.roundTripMs.toFixed(1)} ms`} />}
                    {transfer && <Row label="Trace transfer" value={transfer} />}
                    {inspect && <Row label="File report" value={inspect} />}
                </dl>
            ) : (
                <p className="text-[13px] leading-relaxed text-fg-muted">
                    “Inspect .duckdb” writes a structural report of a recording — tables, columns, value ranges,
                    metadata incl. driver name and setup — to a JSON file.
                </p>
            )}
            {error && <p className="text-sm text-danger-fg">{error}</p>}
            <div className="mt-auto flex gap-2">
                <button className="btn-ghost" onClick={inspectFile}>Inspect .duckdb…</button>
                <button className="btn-ghost" onClick={checkWorker}>Check worker</button>
            </div>
        </Section>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt className="text-fg-subtle">{label}</dt>
            <dd className="num break-all text-xs leading-5 text-fg select-text">{value}</dd>
        </>
    )
}
