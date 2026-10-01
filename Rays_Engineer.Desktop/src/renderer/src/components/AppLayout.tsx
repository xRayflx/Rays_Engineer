import clsx from 'clsx'
import { CircleDot, FolderOpen, LineChart, SlidersHorizontal, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { describeImport, importPaths } from '../lib/importFiles'
import { useWorkerQuery } from '../lib/useWorker'
import ComparePanel from './ComparePanel'

const NAV = [
    { to: '/sessions', label: 'Sessions', icon: FolderOpen },
    { to: '/analysis', label: 'Analysis', icon: LineChart },
    { to: '/recording', label: 'Recording', icon: CircleDot },
    { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
] as const

const IMPORTABLE = /\.(rses|rlap|duckdb)$/i

export default function AppLayout() {
    const navigate = useNavigate()
    const onSessions = useLocation().pathname.startsWith('/sessions')
    const [dragging, setDragging] = useState(false)
    const [toast, setToast] = useState<string | null>(null)

    // Drop .rses / .rlap / .duckdb anywhere on the window to import it.
    useEffect(() => {
        let depth = 0
        const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
        const onEnter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true) } }
        const onLeave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDragging(false) } }
        const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
        const onDrop = async (e: DragEvent) => {
            e.preventDefault()
            depth = 0
            setDragging(false)
            const paths = [...(e.dataTransfer?.files ?? [])].map(f => window.api.files.pathFor(f)).filter(p => IMPORTABLE.test(p))
            if (paths.length === 0) { setToast('Drop .rses, .rlap or .duckdb files to import them'); return }
            setToast('Importing…')
            try {
                const r = await importPaths(paths)
                if (!r) return
                setToast(describeImport(r))
                if (r.sessionIds.length === 1 && r.errors.length === 0) navigate(`/sessions/${r.sessionIds[0]}`)
            } catch (err) {
                setToast(err instanceof Error ? err.message : String(err))
            }
        }
        window.addEventListener('dragenter', onEnter)
        window.addEventListener('dragleave', onLeave)
        window.addEventListener('dragover', onOver)
        window.addEventListener('drop', onDrop)
        return () => {
            window.removeEventListener('dragenter', onEnter)
            window.removeEventListener('dragleave', onLeave)
            window.removeEventListener('dragover', onOver)
            window.removeEventListener('drop', onDrop)
        }
    }, [navigate])

    useEffect(() => {
        if (!toast || toast === 'Importing…') return
        const t = setTimeout(() => setToast(null), 6000)
        return () => clearTimeout(t)
    }, [toast])

    return (
        <div className="flex h-full">
            <nav className="w-[232px] shrink-0 bg-panel border-r border-edge flex flex-col px-3 pt-5 pb-4">
                <div className="flex items-center gap-2.5 px-2.5 pb-7">
                    <Logo />
                    <div className="font-display text-[17px] font-bold uppercase leading-none tracking-wide text-fg-strong" style={{ fontStretch: '118%' }}>
                        Rays <span className="font-medium text-fg-subtle">Engineer</span>
                    </div>
                </div>
                <div className="flex flex-col gap-0.5">
                    {NAV.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) => clsx(
                                'group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                                isActive ? 'bg-active text-fg-strong' : 'text-fg-muted hover:bg-hover hover:text-fg',
                            )}
                        >
                            {({ isActive }) => <><Icon size={18} className={clsx(isActive && 'text-accent')} />{label}</>}
                        </NavLink>
                    ))}
                </div>
                <div className="flex-1" />
                <StatusBlock />
            </nav>
            <main className="flex-1 min-w-0 overflow-auto relative">
                <Outlet />
                {toast && (
                    <div className="fixed bottom-4 left-[248px] max-w-md rounded-lg border border-edge bg-raised px-4 py-3 text-xs text-fg-soft shadow-lg">{toast}</div>
                )}
            </main>
            {onSessions && <ComparePanel />}
            {dragging && (
                <div className="fixed inset-0 z-50 bg-canvas/80 border-2 border-dashed border-accent flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-3 text-fg"><Upload size={20} /> Drop to import sessions or laps</div>
                </div>
            )}
        </div>
    )
}

function Logo() {
    return (
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
            <rect width="26" height="26" rx="6" className="fill-active" />
            <path d="M6 19 L13 7 M11 19 L18 7 M16 19 L21 10.5" className="stroke-accent" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </svg>
    )
}

/** Telemetry folder and LMU auto-record state, always visible at the bottom of the sidebar. */
function StatusBlock() {
    const { data: status } = useWorkerQuery('getIndexStatus', ['status-changed'])
    const { data: auto } = useWorkerQuery('getAutoRecord', ['status-changed'])
    if (!status) return null
    const watching = !!status.activeFolder && status.activeFolderExists
    return (
        <div className="rounded-xl border border-edge p-3.5 flex flex-col gap-3 text-xs">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-medium text-fg-soft">
                    <span className={clsx('h-2 w-2 rounded-full', watching ? 'bg-ok' : 'bg-loss')} />
                    {watching ? 'Watching telemetry' : 'Telemetry folder not found'}
                </div>
                {status.activeFolder && (
                    <div className="num text-[11px] text-fg-subtle break-all" title={status.activeFolder}>{shortPath(status.activeFolder)}</div>
                )}
                {status.pendingFiles > 0 && (
                    <div className="text-fg-subtle">Waiting for {status.pendingFiles} file{status.pendingFiles > 1 ? 's' : ''} to finish</div>
                )}
            </div>
            {auto && auto.enabled !== null && (
                <div className="flex justify-between text-fg-muted">
                    <span>Auto-record</span>
                    <span className={clsx('font-medium', auto.enabled ? 'text-fg' : 'text-warn-fg')}>{auto.enabled ? 'On' : 'Off'}</span>
                </div>
            )}
        </div>
    )
}

/** "…\Le Mans Ultimate\UserData\Telemetry" — the last three folders are what identifies it. */
function shortPath(p: string): string {
    const parts = p.split(/[\\/]/).filter(Boolean)
    return parts.length > 3 ? `…\\${parts.slice(-3).join('\\')}` : p
}
