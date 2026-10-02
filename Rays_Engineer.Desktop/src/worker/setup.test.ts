import { join } from 'node:path'
import { expect, it } from 'vitest'
import { setupChanges, setupRows } from '../renderer/src/lib/setup'
import { parseSetupJson } from '../shared/setup'
import { readRecordingSession } from './telemetry/reader'

const SAMPLES = join(__dirname, '..', '..', '..', 'samples')

it('lines up the real Bahrain race and qualifying setups', async () => {
    const race = await readRecordingSession(join(SAMPLES, 'Bahrain International Circuit_R_2026-09-18T14_44_00Z.duckdb'))
    const quali = await readRecordingSession(join(SAMPLES, 'Bahrain International Circuit_Q_2026-09-18T14_34_20Z.duckdb'))
    const rows = setupRows([parseSetupJson(race.setupJson), parseSetupJson(quali.setupJson)])

    const row = (label: string, sub = '') => rows.find(r => r.label === label && r.sub === sub)
    expect(row('Brake balance')!.cells.map(c => c?.text)).toEqual(['45.0:55.0', '45.0:55.0'])
    expect(row('Ride height', 'rear')!.cells[0]!.text).toBe('6.7 cm')
    // Same car setup; only the fuel (strategy) differs between the two sessions.
    expect(row('Fuel')!.differs).toBe(true)
    expect(setupChanges(rows, 1)).toBe(0)
    // Fixed gears and N/A chassis adjusters are hidden; known settings all get a real name.
    expect(rows.some(r => /^Gear \d/.test(r.label))).toBe(false)
    expect(rows.filter(r => r.group === 'Other').map(r => r.label)).toEqual([])
})
