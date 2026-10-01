import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKUP_FILE, readAutoRecord, setFlagInText, settingsPathForTelemetryFolder, writeAutoRecord } from './lmu-settings'

const SAMPLE = join(__dirname, '..', '..', '..', 'samples', 'Settings.JSON')
const sample = readFileSync(SAMPLE, 'utf8')

describe('LMU Settings.JSON', () => {
    it('changes exactly one line of the real sample file', () => {
        const off = setFlagInText(sample, false)
        const a = sample.split('\r\n')
        const b = off.split('\r\n')
        expect(b.length).toBe(a.length)
        const changed = a.flatMap((line, i) => (line !== b[i] ? [i] : []))
        expect(changed).toHaveLength(1)
        expect(b[changed[0]!]).toBe('    "Automatically Record Telemetry": false,')
        expect(setFlagInText(off, true)).toBe(sample) // round trip is byte-identical
    })

    it('never touches the description key', () => {
        expect(setFlagInText(sample, false)).toContain('"Automatically Record Telemetry#": "Enables automatic')
    })

    it('rejects files without the option', () => {
        expect(() => setFlagInText('{"Game Options": {}}', true)).toThrow(/not found/)
    })

    it('derives Settings.JSON from the telemetry folder', () => {
        const lmu = join(tmpdir(), 'LMU')
        expect(settingsPathForTelemetryFolder(join(lmu, 'UserData', 'Telemetry'))).toBe(join(lmu, 'UserData', 'player', 'Settings.JSON'))
        expect(settingsPathForTelemetryFolder(join(lmu, 'somewhere', 'else'))).toBeNull()
    })

    it('reads, writes and backs up once', async () => {
        const root = mkdtempSync(join(tmpdir(), 'rays-lmu-'))
        const telemetry = join(root, 'UserData', 'Telemetry')
        mkdirSync(telemetry, { recursive: true })
        mkdirSync(join(root, 'UserData', 'player'))
        const settings = join(root, 'UserData', 'player', 'Settings.JSON')
        writeFileSync(settings, sample)

        expect(await readAutoRecord(telemetry)).toMatchObject({ exists: true, enabled: true, error: null })
        expect((await writeAutoRecord(telemetry, false)).enabled).toBe(false)
        await writeAutoRecord(telemetry, true)
        expect(readFileSync(settings, 'utf8')).toBe(sample)
        expect(readFileSync(join(root, 'UserData', 'player', BACKUP_FILE), 'utf8')).toBe(sample)
    })
})
