import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LapRow, SessionRow } from '../shared/types'
import { exportLap, exportSession, renumberFromManifest, unpackImport, writeLapRecording } from './packages'
import { readLapTrace, readRecordingSession } from './telemetry/reader'

const RACE = join(__dirname, '..', '..', '..', 'samples', 'Bahrain International Circuit_R_2026-09-18T14_44_00Z.duckdb')
const tmp = () => mkdtempSync(join(tmpdir(), 'rays-pkg-'))

async function lapRow(path: string, index: number): Promise<{ lap: LapRow; session: SessionRow }> {
    const s = await readRecordingSession(path)
    const g = s.laps[index]!
    return {
        lap: { id: 1, sessionId: 1, lapNumber: g.index, kind: g.kind, lapTimeMs: g.lapTimeMs, sector1Ms: g.sector1Ms, sector2Ms: g.sector2Ms, sector3Ms: g.sector3Ms, isValid: g.isValid, inPits: g.inPits, startTs: g.startTs, endTs: g.endTs, isReference: false, note: '' },
        session: { id: 1, track: s.track, trackLayout: s.trackLayout, car: s.car, carClass: s.carClass, sessionType: s.sessionType, recordedAt: s.recordedAt } as SessionRow,
    }
}

describe('.rlap lap recordings', () => {
    it('contain exactly the lap, readable by the normal reader with original timestamps', async () => {
        const orig = await readRecordingSession(RACE)
        const { lap } = await lapRow(RACE, 2)
        const out = join(tmp(), 'lap.duckdb')
        await writeLapRecording(RACE, lap, out)
        expect(statSync(out).size).toBeLessThan(statSync(RACE).size / 3)

        const s = await readRecordingSession(out)
        expect(s.track).toBe(orig.track)
        expect(s.t0).toBeGreaterThan(orig.t0)
        expect(Number.isInteger(Math.round((s.t0 - orig.t0) * 1000) / 1000)).toBe(true) // whole seconds after recording start
        const complete = s.laps.filter(l => l.kind === 'lap')
        expect(complete).toHaveLength(1)
        expect(complete[0]).toMatchObject({
            startTs: lap.startTs, endTs: lap.endTs, lapTimeMs: lap.lapTimeMs, isValid: true,
            sector1Ms: lap.sector1Ms, sector2Ms: lap.sector2Ms, sector3Ms: lap.sector3Ms,
        })

        // the traces are identical to the ones read from the full recording
        const a = await readLapTrace(RACE, orig, lap, 50)
        const b = await readLapTrace(out, s, lap, 50)
        expect(b.count).toBe(a.count)
        for (const k of ['speed', 'throttle', 'brake', 'steer'] as const)
            for (let i = 0; i < a.count; i += 97) expect(b[k][i]).toBeCloseTo(a[k][i]!, 4)
        // distance can differ by < 1 m right at the line: track length = max Lap Dist of each file
        for (let i = 0; i < a.count; i += 97) expect(Math.abs(b.distM![i]! - a.distM![i]!)).toBeLessThan(1)
    })
})

describe('packages', () => {
    it('round-trips .rses and .rlap through unpackImport', async () => {
        const dir = tmp()
        const { lap, session } = await lapRow(RACE, 2)
        await exportSession(RACE, session, [lap], '9.9.9', join(dir, 's.rses'))
        await exportLap(RACE, session, lap, '9.9.9', join(dir, 'l.rlap'))

        const ses = await unpackImport(join(dir, 's.rses'), join(dir, 'imports'))
        expect(ses.manifest).toMatchObject({ format: 'rses', formatVersion: 1, appVersion: '9.9.9', track: 'Bahrain International Circuit' })
        expect(statSync(ses.path).size).toBe(statSync(RACE).size)
        expect((await readRecordingSession(ses.path)).laps.filter(l => l.kind === 'lap')).toHaveLength(5)

        const lp = await unpackImport(join(dir, 'l.rlap'), join(dir, 'imports'))
        expect(lp.manifest?.format).toBe('rlap')
        expect(lp.manifest?.laps).toHaveLength(1)
        expect(lp.manifest?.laps[0]).toMatchObject({ lapTimeMs: lap.lapTimeMs, startTs: lap.startTs, endTs: lap.endTs })
        const r = await readRecordingSession(lp.path)
        expect(r.laps.filter(l => l.kind === 'lap')[0]?.lapTimeMs).toBe(lap.lapTimeMs)
        // the imported lap keeps its original number (2), neighbours get 1 and 3
        expect(renumberFromManifest(r.laps, JSON.stringify(lp.manifest)).map(l => [l.kind, l.index])).toEqual([['partial', 1], ['lap', 2], ['partial', 3]])
    })

    it('rejects wrong extensions and foreign files', async () => {
        const dir = tmp()
        const { lap, session } = await lapRow(RACE, 2)
        await expect(exportLap(RACE, session, lap, '1', join(dir, 'x.zip'))).rejects.toThrow(/\.rlap/)
        await expect(unpackImport(join(dir, 'x.txt'), dir)).rejects.toThrow(/Unsupported/)
    })
})
