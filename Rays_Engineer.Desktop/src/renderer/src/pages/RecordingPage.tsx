import type { RecordingConfigState } from '@shared/types'
import {
    MAX_HZ,
    MIN_HZ,
    PRESETS,
    matchPreset,
    samplesPerLap,
    type LmuTelemetryConfig,
} from '@shared/telemetry-config'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import AutoRecordCard from '../components/AutoRecordCard'
import { useEffect, useMemo, useState } from 'react'
import { useWorkerQuery } from '../lib/useWorker'
import { callWorker } from '../lib/worker'

const CHANNEL_GROUPS: { label: string; channels: string[] }[] = [
    { label: 'Driver inputs', channels: ['Throttle Pos', 'Throttle Pos Unfiltered', 'Brake Pos', 'Brake Pos Unfiltered', 'Steering Pos', 'Steering Pos Unfiltered', 'Steering Shaft Torque', 'Clutch Pos', 'Clutch Pos Unfiltered'] },
    { label: 'Engine & powertrain', channels: ['Engine RPM', 'Clutch RPM', 'Turbo Boost Pressure', 'FFB Output', 'Regen Rate'] },
    { label: 'Suspension', channels: ['Susp Pos', 'FrontRideHeight', 'RearRideHeight', 'RideHeights', 'Front3rdDeflection', 'Rear3rdDeflection'] },
    { label: 'Tyres', channels: ['TyresTempCentre', 'TyresTempLeft', 'TyresTempRight', 'TyresCarcassTemp', 'TyresRimTemp', 'TyresRubberTemp', 'TyresPressure', 'Tyres Wear'] },
    { label: 'Brakes', channels: ['Brakes Temp', 'Brakes Air Temp', 'Brakes Force', 'Brake Thickness'] },
    { label: 'G-forces & speed', channels: ['Ground Speed', 'G Force Lat', 'G Force Long', 'G Force Vert', 'Wheel Speed'] },
    { label: 'GPS & position', channels: ['GPS Latitude', 'GPS Longitude', 'GPS Speed', 'GPS Time', 'Lap Dist', 'Total Dist', 'Path Lateral', 'Track Edge'] },
    { label: 'Fuel & energy', channels: ['Fuel Level', 'SoC', 'Virtual Energy'] },
    { label: 'Temperatures & environment', channels: ['Engine Oil Temp', 'Engine Water Temp', 'Ambient Temperature', 'Track Temperature', 'Wind Speed', 'Wind Heading', 'OverheatingState', 'Time Behind Next'] },
]

const DEFAULT_PRESET = PRESETS.find(p => p.name === 'medium')!

function clone(c: LmuTelemetryConfig): LmuTelemetryConfig {
    return JSON.parse(JSON.stringify(c)) as LmuTelemetryConfig
}

export default function RecordingPage() {
    const { data: state, setData } = useWorkerQuery('getRecordingConfig', ['status-changed'])
    const [draft, setDraft] = useState<LmuTelemetryConfig | null>(null)
    const [mode, setMode] = useState<string>('medium')
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

    // Initialise the draft from the file on disk (or the default preset).
    useEffect(() => {
        if (!state || draft) return
        const base = state.config ?? DEFAULT_PRESET.config
        setDraft(clone(base))
        setMode(matchPreset(base) ?? 'custom')
    }, [state, draft])

    const dirty = useMemo(() => {
        if (!draft || !state) return false
        return JSON.stringify(draft) !== JSON.stringify(state.config)
    }, [draft, state])

    if (!state || !draft) return null

    function choosePreset(name: string) {
        setMessage(null)
        setMode(name)
        if (name === 'custom') return
        setDraft(clone(PRESETS.find(p => p.name === name)!.config))
    }

    function setHz(channel: string, hz: number) {
        setDraft(d => d && ({
            ...d,
            Channels: { ...d.Channels, [channel]: { ...d.Channels[channel]!, Frequency: Math.max(MIN_HZ, Math.min(MAX_HZ, Math.round(hz) || MIN_HZ)) } },
        }))
    }

    async function writeToLmu() {
        setBusy(true)
        setMessage(null)
        try {
            const next = await callWorker('writeRecordingConfig', { config: draft! })
            setData(next)
            setMessage({ ok: true, text: 'Saved. Restart Le Mans Ultimate if it is running.' })
        } catch (e) {
            setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
        } finally {
            setBusy(false)
        }
    }

    async function saveAs() {
        const saved = await window.api.dialog.saveText('config.json', JSON.stringify(draft, null, 4))
        if (saved) setMessage({ ok: true, text: `Saved to ${saved}` })
    }

    const options = [
        ...PRESETS.map(p => ({ name: p.name, label: p.displayName, description: p.description })),
        { name: 'custom', label: 'Custom', description: `Set every channel yourself, ${MIN_HZ}–${MAX_HZ} Hz.` },
    ]

    return (
        <div className="px-10 pt-8 pb-12 max-w-5xl flex flex-col gap-6">
            <header className="flex flex-col gap-2">
                <h1 className="page-title">Recording</h1>
                <p className="text-[13px] text-fg-muted">What Le Mans Ultimate records, and how often. Changes are written to the game's own config files.</p>
            </header>

            <AutoRecordCard />

            <section aria-label="Channel frequencies" className="rounded-xl border border-edge bg-card flex flex-col">
                <div className="flex items-start gap-4 px-6 pt-5">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-base font-semibold text-fg">Channel frequencies</h2>
                        <p className="text-[13px] text-fg-muted">How often each telemetry channel is sampled · ~{samplesPerLap(draft).toLocaleString()} samples per 90 s lap.</p>
                    </div>
                    <CurrentFile state={state} />
                </div>

                <div role="radiogroup" aria-label="Preset" className="grid grid-cols-4 gap-2.5 px-6 py-[18px]">
                    {options.map(o => {
                        const on = mode === o.name
                        return (
                            <button key={o.name} role="radio" aria-checked={on} onClick={() => choosePreset(o.name)}
                                className={clsx('flex flex-col items-start gap-1.5 rounded-xl border-[1.5px] p-4 text-left transition-colors',
                                    on ? 'border-accent bg-accent-tint' : 'border-edge bg-well hover:border-edge-strong')}>
                                <span className="flex w-full items-center gap-2">
                                    <span className="text-[15px] font-semibold text-fg">{o.label}</span>
                                    {o.name === DEFAULT_PRESET.name && <span className="ml-auto text-[11px] text-accent">Recommended</span>}
                                </span>
                                <span className="text-xs leading-snug text-fg-muted">{o.description}</span>
                            </button>
                        )
                    })}
                </div>

                <ChannelEditor config={draft} locked={mode !== 'custom'} onChange={setHz} />

                <div className="flex flex-wrap items-center gap-3 px-6 py-5">
                    <button className="btn-primary h-11" disabled={busy || !state.folder || !dirty} onClick={writeToLmu}>
                        Write to LMU
                    </button>
                    <button className="btn-ghost h-11" onClick={saveAs}>Save as…</button>
                    {message
                        ? <span className={clsx('text-xs', message.ok ? 'text-ok-fg' : 'text-danger-fg')}>{message.text}</span>
                        : state.folder && (
                            <span className="text-xs leading-relaxed text-fg-subtle">
                                Writes <span className="num break-all text-fg-2">{state.path}</span><br />
                                An existing file is backed up once as config.rays-backup.json.
                            </span>
                        )}
                </div>
            </section>
        </div>
    )
}

function CurrentFile({ state }: { state: RecordingConfigState }) {
    let text: string
    if (!state.folder) text = 'No telemetry folder'
    else if (state.error) text = 'config.json invalid'
    else if (!state.exists) text = 'No config.json yet'
    else {
        const p = matchPreset(state.config!)
        text = `On disk: ${p ? PRESETS.find(x => x.name === p)!.displayName : 'Custom'}`
    }
    return (
        <span className={clsx('chip ml-auto shrink-0 font-normal', state.error ? 'bg-danger-bg text-danger-fg' : 'bg-active text-fg-2')} title={state.error ?? undefined}>
            {text}
        </span>
    )
}

/** Every channel's frequency; read-only for presets, editable for Custom. */
function ChannelEditor({ config, locked, onChange }: { config: LmuTelemetryConfig; locked: boolean; onChange: (ch: string, hz: number) => void }) {
    const [open, setOpen] = useState<Set<string>>(new Set(['Driver inputs']))
    const grouped = new Set(CHANNEL_GROUPS.flatMap(g => g.channels))
    const other = Object.keys(config.Channels).filter(c => !grouped.has(c)).sort()
    const groups = other.length ? [...CHANNEL_GROUPS, { label: 'Other', channels: other }] : CHANNEL_GROUPS

    return (
        <div className="mx-6 overflow-hidden rounded-xl border border-edge bg-well">
            <div className="flex h-10 items-center border-b border-line px-4">
                <span className="label">Channels</span>
                <span className="ml-auto text-xs text-fg-subtle">{locked ? 'Preset values · choose Custom to edit' : `Editing — values are clamped to ${MIN_HZ}–${MAX_HZ} Hz`}</span>
            </div>
            {groups.map((g, gi) => {
                const chans = g.channels.filter(c => c in config.Channels)
                if (!chans.length) return null
                const isOpen = open.has(g.label)
                const hz = chans.map(c => config.Channels[c]!.Frequency)
                return (
                    <div key={g.label} className={clsx(gi > 0 && 'border-t border-row')}>
                        <button aria-expanded={isOpen} className="flex h-11 w-full items-center gap-2.5 px-4 text-left text-[13px] font-semibold text-fg-soft hover:bg-hover"
                            onClick={() => setOpen(s => { const n = new Set(s); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n })}>
                            <ChevronRight size={14} className={clsx('transition-transform', isOpen ? 'rotate-90 text-fg-muted' : 'text-fg-faint')} />
                            {g.label}
                            <span className="num ml-auto text-[11px] font-normal text-fg-subtle">
                                {chans.length} channel{chans.length === 1 ? '' : 's'} · {Math.min(...hz) === Math.max(...hz) ? Math.min(...hz) : `${Math.min(...hz)}–${Math.max(...hz)}`} Hz
                            </span>
                        </button>
                        {isOpen && (
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 pb-3.5 pl-10 pr-4">
                                {chans.map(c => (
                                    <label key={c} className="flex items-center gap-2.5 text-[13px] text-fg-2">
                                        <span className="flex-1 truncate">{c}</span>
                                        <input type="number" min={MIN_HZ} max={MAX_HZ} value={config.Channels[c]!.Frequency} disabled={locked}
                                            onChange={e => onChange(c, Number(e.target.value))}
                                            className="num h-8 w-16 rounded-md border border-edge-strong bg-field px-2 text-right text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:border-line disabled:text-fg-muted" />
                                        <span className="w-[18px] text-[11px] text-fg-subtle">Hz</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
