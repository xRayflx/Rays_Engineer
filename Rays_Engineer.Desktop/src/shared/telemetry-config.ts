/**
 * LMU telemetry recording config (UserData\Telemetry\config.json): which
 * channels LMU records and at what frequency. Format verified against a real
 * config.json (samples/config.json equals the Default preset).
 */
import inaccurate from './presets/inaccurate.json'
import medium from './presets/medium.json'
import veryAccurate from './presets/very-accurate.json'

export interface TelemetryChannelConfig {
    Frequency: number
    Name: string
}

export interface LmuTelemetryConfig {
    Channels: Record<string, TelemetryChannelConfig>
    Events: Record<string, { Name: string }>
}

export const CONFIG_FILE_NAME = 'config.json'
export const MIN_HZ = 1
export const MAX_HZ = 100

export interface TelemetryPreset {
    name: string
    displayName: string
    description: string
    config: LmuTelemetryConfig
}

export const PRESETS: readonly TelemetryPreset[] = [
    {
        name: 'inaccurate',
        displayName: 'Light',
        description: 'Minimal recording, smallest files. Enough for basic lap time comparisons.',
        config: inaccurate,
    },
    {
        name: 'medium',
        displayName: 'Default',
        description: 'Balanced quality and file size. Recommended — all analysis views work well.',
        config: medium,
    },
    {
        name: 'very-accurate',
        displayName: 'Detailed',
        description: 'High-resolution data for sharp, precise traces. Larger files.',
        config: veryAccurate,
    },
]

/** Throws with a readable message if `value` is not a well-formed config. */
export function validateTelemetryConfig(value: unknown): LmuTelemetryConfig {
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
    if (!isObj(value)) throw new Error('Config must be an object')
    const { Channels, Events } = value
    if (!isObj(Channels) || !isObj(Events)) throw new Error('Config needs "Channels" and "Events" objects')

    const channels: Record<string, TelemetryChannelConfig> = {}
    for (const [key, ch] of Object.entries(Channels)) {
        if (!isObj(ch) || typeof ch['Name'] !== 'string' || typeof ch['Frequency'] !== 'number')
            throw new Error(`Channel "${key}" needs Name and Frequency`)
        const hz = ch['Frequency']
        if (!Number.isInteger(hz) || hz < MIN_HZ || hz > MAX_HZ)
            throw new Error(`Channel "${key}": frequency must be an integer between ${MIN_HZ} and ${MAX_HZ} Hz`)
        channels[key] = { Frequency: hz, Name: ch['Name'] }
    }
    const events: Record<string, { Name: string }> = {}
    for (const [key, ev] of Object.entries(Events)) {
        if (!isObj(ev) || typeof ev['Name'] !== 'string') throw new Error(`Event "${key}" needs a Name`)
        events[key] = { Name: ev['Name'] }
    }
    return { Channels: channels, Events: events }
}

/** Name of the preset whose channel frequencies match `config` exactly, else null. */
export function matchPreset(config: LmuTelemetryConfig): string | null {
    for (const p of PRESETS) {
        const a = p.config.Channels
        const b = config.Channels
        const keys = Object.keys(a)
        if (keys.length === Object.keys(b).length && keys.every(k => b[k]?.Frequency === a[k]!.Frequency)) return p.name
    }
    return null
}

/** Rough samples per lap across all channels, for comparing presets. */
export function samplesPerLap(config: LmuTelemetryConfig, lapSeconds = 90): number {
    return Object.values(config.Channels).reduce((sum, ch) => sum + ch.Frequency * lapSeconds, 0)
}
