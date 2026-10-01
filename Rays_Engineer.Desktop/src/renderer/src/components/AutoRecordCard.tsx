import type { AutoRecordState } from '@shared/types'
import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { useWorkerQuery } from '../lib/useWorker'
import { callWorker } from '../lib/worker'
import { Switch } from './ui'

/** Shows and toggles LMU's "Automatically Record Telemetry" option. */
export default function AutoRecordCard({ compact = false }: { compact?: boolean }) {
    const { data: state, setData } = useWorkerQuery('getAutoRecord', ['status-changed'])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!state) return null
    if (compact && state.enabled !== false) return null

    async function set(enabled: boolean) {
        setBusy(true)
        setError(null)
        try { setData(await callWorker('setAutoRecord', { enabled })) }
        catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
    }

    return (
        <section aria-label="Automatic telemetry recording" className={clsx('card flex items-center gap-5', compact && 'border-accent/50 bg-accent-tint')}>
            <div className="flex flex-1 flex-col gap-1">
                <h2 className="text-base font-semibold text-fg">Automatic telemetry recording</h2>
                <p className="text-[13px] text-fg-muted">{describe(state)}</p>
                {state.enabled !== null && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-subtle">
                        <Info size={13} className="shrink-0" />
                        Close Le Mans Ultimate before changing this — the game may overwrite its settings when it exits.
                    </p>
                )}
                {(error ?? state.error) && <p className="text-xs text-danger-fg">{error ?? state.error}</p>}
            </div>
            {state.enabled !== null && (
                <Switch checked={state.enabled} disabled={busy} onChange={v => void set(v)} label="Automatic telemetry recording" />
            )}
        </section>
    )
}

function describe(s: AutoRecordState): string {
    if (!s.settingsPath) return 'LMU settings not found next to the telemetry folder.'
    if (!s.exists) return `Settings.JSON not found (${s.settingsPath}). Start LMU once to create it.`
    if (s.enabled === true) return 'On — every session you drive is recorded.'
    if (s.enabled === false) return 'Off — LMU only records when you start it manually.'
    return 'Unknown'
}
