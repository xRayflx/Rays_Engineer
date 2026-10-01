/**
 * LMU's player settings (UserData\player\Settings.JSON). Only one value is
 * touched: "Game Options" → "Automatically Record Telemetry" (boolean),
 * verified against a real Settings.JSON (samples/Settings.JSON).
 *
 * Writes change exactly that literal in the text (keeping CRLF, indentation,
 * key order and comments-as-"#"-keys byte-identical) and re-parse the result
 * to prove nothing else changed. The original is backed up once.
 */
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AutoRecordState } from '../shared/types'

export const SECTION = 'Game Options'
export const KEY = 'Automatically Record Telemetry'
export const SETTINGS_FILE = 'Settings.JSON'
export const BACKUP_FILE = 'Settings.rays-backup.JSON'

/** <LMU>\UserData\Telemetry → <LMU>\UserData\player\Settings.JSON; null if the folder is not LMU's. */
export function settingsPathForTelemetryFolder(telemetryFolder: string | null): string | null {
    if (!telemetryFolder) return null
    if (basename(telemetryFolder).toLowerCase() !== 'telemetry') return null
    const userData = dirname(telemetryFolder)
    if (basename(userData).toLowerCase() !== 'userdata') return null
    return join(userData, 'player', SETTINGS_FILE)
}

function parse(text: string): Record<string, unknown> {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>
}

function readFlag(json: Record<string, unknown>): boolean | null {
    const section = json[SECTION]
    if (typeof section !== 'object' || section === null) return null
    const v = (section as Record<string, unknown>)[KEY]
    return typeof v === 'boolean' ? v : null
}

export async function readAutoRecord(telemetryFolder: string | null): Promise<AutoRecordState> {
    const path = settingsPathForTelemetryFolder(telemetryFolder)
    if (!path) return { settingsPath: null, exists: false, enabled: null, error: null }
    let text: string
    try { text = await readFile(path, 'utf8') } catch { return { settingsPath: path, exists: false, enabled: null, error: null } }
    try {
        const enabled = readFlag(parse(text))
        return { settingsPath: path, exists: true, enabled, error: enabled === null ? `"${KEY}" not found in ${SETTINGS_FILE}` : null }
    } catch (err) {
        return { settingsPath: path, exists: true, enabled: null, error: `${SETTINGS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
    }
}

/** Returns `text` with the flag set to `enabled`; throws if the change cannot be made safely. */
export function setFlagInText(text: string, enabled: boolean): string {
    const original = parse(text)
    if (readFlag(original) === null) throw new Error(`"${KEY}" not found in ${SETTINGS_FILE}`)

    const sectionAt = text.indexOf(`"${SECTION}"`)
    if (sectionAt < 0) throw new Error(`Section "${SECTION}" not found`)
    // Exact key (the closing quote right after the name excludes the "...Telemetry#" description key).
    const re = new RegExp(`("${KEY}"\\s*:\\s*)(true|false)`, 'g')
    re.lastIndex = sectionAt
    const m = re.exec(text)
    if (!m) throw new Error(`"${KEY}" not found in section "${SECTION}"`)
    const next = text.slice(0, m.index) + m[1] + String(enabled) + text.slice(m.index + m[0].length)

    // Prove that exactly this one value changed.
    const updated = parse(next)
    if (readFlag(updated) !== enabled) throw new Error('Verification failed: flag not updated')
    ;(original[SECTION] as Record<string, unknown>)[KEY] = enabled
    if (JSON.stringify(original) !== JSON.stringify(updated)) throw new Error('Verification failed: other settings would change')
    return next
}

export async function writeAutoRecord(telemetryFolder: string | null, enabled: boolean): Promise<AutoRecordState> {
    const path = settingsPathForTelemetryFolder(telemetryFolder)
    if (!path) throw new Error('LMU settings not found next to the telemetry folder')
    const text = await readFile(path, 'utf8')
    const next = setFlagInText(text, enabled)
    if (next !== text) {
        const backup = join(dirname(path), BACKUP_FILE)
        try { await stat(backup) } catch { await copyFile(path, backup) }
        const tmp = `${path}.tmp`
        await writeFile(tmp, next, 'utf8')
        await rename(tmp, path)
    }
    return readAutoRecord(telemetryFolder)
}
