import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    findTelemetryFolders,
    LMU_STEAM_APP_ID,
    parseRegQueryOutput,
    pickBestCandidate,
    readSteamLibraries,
} from './telemetry-folder'

function tmp(): string {
    return mkdtempSync(join(tmpdir(), 'rays-locate-'))
}

describe('parseRegQueryOutput', () => {
    it('extracts REG_SZ values and normalises slashes', () => {
        const out = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n'
        expect(parseRegQueryOutput(out, 'SteamPath')).toBe('c:\\program files (x86)\\steam')
    })

    it('returns null when the value is absent', () => {
        expect(parseRegQueryOutput('ERROR: nothing', 'SteamPath')).toBeNull()
    })
})

describe('findTelemetryFolders', () => {
    it('finds LMU in a secondary Steam library and prefers folders with recordings', async () => {
        const steam = tmp()
        const lib2 = tmp()
        const docs = tmp()
        mkdirSync(join(steam, 'steamapps'), { recursive: true })
        writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'),
            `"libraryfolders" { "0" { "path" "${steam.replaceAll('\\', '\\\\')}" } "1" { "path" "${lib2.replaceAll('\\', '\\\\')}" } }`)

        // LMU installed in lib2 under a custom install dir announced by its appmanifest.
        mkdirSync(join(lib2, 'steamapps'), { recursive: true })
        writeFileSync(join(lib2, 'steamapps', `appmanifest_${LMU_STEAM_APP_ID}.acf`), '"AppState" { "installdir" "LMU Custom" }')
        const telemetry = join(lib2, 'steamapps', 'common', 'LMU Custom', 'UserData', 'Telemetry')
        mkdirSync(telemetry, { recursive: true })
        writeFileSync(join(telemetry, 'a.duckdb'), '')
        writeFileSync(join(telemetry, 'b.DUCKDB'), '')
        writeFileSync(join(telemetry, 'notes.txt'), '')

        // Empty but existing Documents location.
        mkdirSync(join(docs, 'Le Mans Ultimate', 'UserData', 'Telemetry'), { recursive: true })

        const found = await findTelemetryFolders({ steamRoots: [steam], documentsDir: docs })
        expect(found[0]).toMatchObject({ path: telemetry, source: 'steam', exists: true, duckdbCount: 2 })
        expect(found.find(c => c.source === 'documents')).toMatchObject({ exists: true, duckdbCount: 0 })
        expect(found.filter(c => !c.exists)).toHaveLength(1) // default install dir in the Steam root
        expect(pickBestCandidate(found)?.path).toBe(telemetry)
    })

    it('returns no usable candidate when nothing exists', async () => {
        const found = await findTelemetryFolders({ steamRoots: [join(tmp(), 'missing')], documentsDir: null })
        expect(found.every(c => !c.exists)).toBe(true)
        expect(pickBestCandidate(found)).toBeNull()
    })

    it('always includes the Steam root even without libraryfolders.vdf', async () => {
        const root = tmp()
        expect(await readSteamLibraries(root)).toEqual([root])
    })
})

describe('real libraryfolders.vdf sample', () => {
    it('lists all four libraries', async () => {
        const { readFileSync } = await import('node:fs')
        const { parseVdf } = await import('./vdf')
        const text = readFileSync(join(__dirname, '..', '..', '..', '..', 'samples', 'libraryfolders.vdf'), 'utf8')
        const folders = parseVdf(text)['libraryfolders'] as Record<string, Record<string, unknown>>
        const paths = Object.values(folders).map(f => f['path'])
        expect(paths).toEqual(['C:\\Program Files (x86)\\Steam', 'F:\\Steam Games', 'E:\\SteamLibrary', 'G:\\SteamLibrary'])
        const withLmu = Object.values(folders).filter(f => LMU_STEAM_APP_ID in (f['apps'] as Record<string, string>))
        expect(withLmu.map(f => f['path'])).toEqual(['G:\\SteamLibrary'])
    })
})
