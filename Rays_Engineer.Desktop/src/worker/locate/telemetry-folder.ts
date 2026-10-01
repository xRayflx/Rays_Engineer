/**
 * Locates LMU's telemetry folder (UserData\Telemetry) on this machine:
 * every Steam library listed in libraryfolders.vdf plus Documents\Le Mans Ultimate.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FolderCandidate, FolderSource } from '../../shared/types'
import { parseVdf, type VdfObject } from './vdf'

/** Steam app id of Le Mans Ultimate. Only used to read its appmanifest for the install dir name. */
export const LMU_STEAM_APP_ID = '2399420'
export const LMU_DEFAULT_INSTALL_DIR = 'Le Mans Ultimate'
const TELEMETRY_SUBPATH = ['UserData', 'Telemetry']

export interface LocateInput {
    steamRoots: string[]
    documentsDir: string | null
}

export async function findTelemetryFolders(input: LocateInput): Promise<FolderCandidate[]> {
    const seen = new Set<string>()
    const out: FolderCandidate[] = []

    async function add(path: string, source: FolderSource) {
        const key = path.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        out.push(await describeFolder(path, source))
    }

    for (const root of input.steamRoots) {
        for (const lib of await readSteamLibraries(root)) {
            const installDir = await readInstallDir(lib) ?? LMU_DEFAULT_INSTALL_DIR
            await add(join(lib, 'steamapps', 'common', installDir, ...TELEMETRY_SUBPATH), 'steam')
        }
    }
    if (input.documentsDir)
        await add(join(input.documentsDir, 'Le Mans Ultimate', ...TELEMETRY_SUBPATH), 'documents')

    return rankCandidates(out)
}

/** Existing folders with recordings first, then existing folders, then the rest (stable within groups). */
export function rankCandidates(list: FolderCandidate[]): FolderCandidate[] {
    const score = (c: FolderCandidate) => (c.exists ? 2 : 0) + (c.duckdbCount > 0 ? 1 : 0)
    return list
        .map((c, i) => ({ c, i }))
        .sort((a, b) => score(b.c) - score(a.c) || a.i - b.i)
        .map(x => x.c)
}

export function pickBestCandidate(list: FolderCandidate[]): FolderCandidate | null {
    return rankCandidates(list).find(c => c.exists) ?? null
}

export async function describeFolder(path: string, source: FolderSource): Promise<FolderCandidate> {
    try {
        const s = await stat(path)
        if (!s.isDirectory()) return { path, source, exists: false, duckdbCount: 0 }
        const entries = await readdir(path)
        return { path, source, exists: true, duckdbCount: entries.filter(isDuckDbName).length }
    } catch {
        return { path, source, exists: false, duckdbCount: 0 }
    }
}

export function isDuckDbName(name: string): boolean {
    return name.toLowerCase().endsWith('.duckdb')
}

/** All library roots from <steamRoot>/steamapps/libraryfolders.vdf; the Steam root itself is always included. */
export async function readSteamLibraries(steamRoot: string): Promise<string[]> {
    const libs = [steamRoot]
    try {
        const text = await readFile(join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8')
        const root = parseVdf(text)
        const folders = (root['libraryfolders'] ?? root['LibraryFolders']) as VdfObject | undefined
        if (folders && typeof folders === 'object') {
            for (const entry of Object.values(folders)) {
                // Newer format: { "path": "..." }; old format: "1" "D:\\SteamLibrary"
                const path = typeof entry === 'string' ? entry : typeof entry['path'] === 'string' ? entry['path'] : null
                if (path && !libs.some(l => samePath(l, path))) libs.push(path)
            }
        }
    } catch { /* no vdf — only the root itself */ }
    return libs
}

async function readInstallDir(library: string): Promise<string | null> {
    try {
        const text = await readFile(join(library, 'steamapps', `appmanifest_${LMU_STEAM_APP_ID}.acf`), 'utf8')
        const state = parseVdf(text)['AppState']
        if (state && typeof state === 'object' && typeof state['installdir'] === 'string') return state['installdir']
    } catch { /* not installed in this library */ }
    return null
}

function samePath(a: string, b: string): boolean {
    const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
    return norm(a) === norm(b)
}

// ── Platform-specific Steam root discovery ───────────────────────────────────

export async function getSteamRoots(): Promise<string[]> {
    const roots: string[] = []
    const push = (p: string | null) => {
        if (p && !roots.some(r => samePath(r, p))) roots.push(p)
    }

    if (process.platform === 'win32') {
        push(await readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'))
        push(await readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'))
        push(await readRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'))
        push('C:\\Program Files (x86)\\Steam')
    } else {
        // Development convenience on Linux (Steam / Proton).
        push(join(homedir(), '.local', 'share', 'Steam'))
        push(join(homedir(), '.steam', 'steam'))
    }
    return roots
}

function readRegistryValue(key: string, name: string): Promise<string | null> {
    return new Promise(resolve => {
        execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
            if (err) return resolve(null)
            resolve(parseRegQueryOutput(stdout, name))
        })
    })
}

/** Parses `reg query` output lines like "    SteamPath    REG_SZ    c:/program files (x86)/steam". */
export function parseRegQueryOutput(stdout: string, name: string): string | null {
    for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/)
        if (m && m[1]!.toLowerCase() === name.toLowerCase()) return m[2]!.replace(/\//g, '\\')
    }
    return null
}
