import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashRecording, statRecording, walPath } from './recording-file'

describe('recording files (.duckdb + .wal)', () => {
    it('includes the WAL in size and hash', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rays-rec-'))
        const db = join(dir, 'a.duckdb')
        writeFileSync(db, 'main')
        const before = await statRecording(db)
        const h1 = await hashRecording(db, false)
        writeFileSync(walPath(db), 'wal-bytes')
        const after = await statRecording(db)
        expect(before).toMatchObject({ size: 4, hasWal: false })
        expect(after).toMatchObject({ size: 13, hasWal: true })
        expect(await hashRecording(db, true)).not.toBe(h1)
    })

    it('returns null for a missing main file (a lone .wal is not a recording)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rays-rec-'))
        writeFileSync(join(dir, 'x.duckdb.wal'), 'wal')
        expect(await statRecording(join(dir, 'x.duckdb'))).toBeNull()
    })
})
