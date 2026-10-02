import type { SetupEntry } from '@shared/setup'
import { describe, expect, it } from 'vitest'
import { parseSetupJson } from '../../../shared/setup'
import { describeKey, setupChanges, setupRows } from './setup'

const e = (key: string, text: string, value = 0): SetupEntry => ({ key, text, value })

describe('setup parsing', () => {
    it('keeps available settings and survives bad input', () => {
        const json = JSON.stringify({
            VM_REAR_WING: { available: true, stringValue: '3.3 deg', value: 9 },
            VM_ENGINE_BOOST: { available: false, stringValue: 'N/A', value: 0 },
        })
        expect(parseSetupJson(json)).toEqual([{ key: 'VM_REAR_WING', text: '3.3 deg', value: 9 }])
        expect(parseSetupJson('{oops')).toBeNull()
        expect(parseSetupJson(null)).toBeNull()
    })
})

describe('setup rows', () => {
    it('names LMU keys and falls back for unknown ones', () => {
        expect(describeKey('VM_BRAKE_BALANCE', 0)).toMatchObject({ label: 'Brake balance', group: 'Brakes' })
        expect(describeKey('WM_RIDEHEIGHT-W_RL', 0)).toMatchObject({ id: 'WM_RIDEHEIGHT|rear', label: 'Ride height', sub: 'rear', side: 'left' })
        expect(describeKey('VM_FRONT_3RD_SPRING', 0)).toMatchObject({ label: 'Third spring', sub: 'front', group: 'Suspension' })
        expect(describeKey('VM_SOMETHING_NEW', 0)).toMatchObject({ label: 'Something new', group: 'Other' })
    })

    it('joins wheels per axle, hides fixed settings and finds differences', () => {
        const a = [e('VM_REAR_WING', '3.3 deg', 9), e('WM_CAMBER-W_FL', '-2.30 deg', 27), e('WM_CAMBER-W_FR', '-2.30 deg', 27),
            e('VM_GEAR_1', 'Fixed'), e('VM_FUEL_CAPACITY', '48.4L', 0)]
        const b = [e('VM_REAR_WING', '4.4 deg', 12), e('WM_CAMBER-W_FL', '-2.30 deg', 27), e('WM_CAMBER-W_FR', '-2.40 deg', 26),
            e('VM_GEAR_1', 'Fixed'), e('VM_FUEL_CAPACITY', '30.2L', 0)]
        const rows = setupRows([a, b])
        expect(rows.map(r => r.label)).toEqual(['Rear wing', 'Camber', 'Fuel'])
        const camber = rows.find(r => r.label === 'Camber')!
        expect(camber.cells.map(c => c?.text)).toEqual(['-2.30 deg', '-2.30 deg · -2.40 deg'])
        expect(camber.differs).toBe(true)
        // fuel is strategy: it differs but is not a setup change
        expect(setupChanges(rows, 1)).toBe(2)
    })

    it('handles a setup missing from one recording', () => {
        const rows = setupRows([[e('VM_REAR_WING', '3.3 deg')], null])
        expect(rows[0]!.cells).toEqual([{ text: '3.3 deg', value: 0, compare: '3.3 deg' }, null])
    })

    it('treats tyre wear as state, not as a setup change', () => {
        const rows = setupRows([
            [e('WM_COMPOUND-W_FL', '100% Medium'), e('WM_COMPOUND-W_FR', '99% Medium')],
            [e('WM_COMPOUND-W_FL', 'Medium'), e('WM_COMPOUND-W_FR', 'Medium')],
        ])
        expect(rows[0]!.cells[0]!.text).toBe('100% Medium · 99% Medium')
        expect(rows[0]!.differs).toBe(false)
    })
})
