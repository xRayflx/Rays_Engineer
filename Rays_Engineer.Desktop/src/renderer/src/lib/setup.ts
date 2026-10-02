import type { SetupEntry } from '@shared/setup'

export const SETUP_GROUPS = ['Aero', 'Suspension', 'Brakes', 'Electronics', 'Tyres', 'Drivetrain', 'Cooling', 'Fuel & energy', 'Other'] as const
export type SetupGroup = (typeof SETUP_GROUPS)[number]

/** Groups that are race strategy rather than car setup: shown, but not counted as setup changes. */
export const STRATEGY_GROUPS: ReadonlySet<SetupGroup> = new Set(['Fuel & energy'])

interface Label {
    label: string
    sub?: string
    group: SetupGroup
}

/** Readable names for LMU's per-car settings (`VM_…`). Unknown keys fall back to a cleaned-up id. */
const VM: Record<string, Label> = {
    FRONT_WING: { label: 'Front wing', group: 'Aero' },
    REAR_WING: { label: 'Rear wing', group: 'Aero' },
    LEFT_FENDER_FLARE: { label: 'Fender flare', sub: 'left', group: 'Aero' },
    RIGHT_FENDER_FLARE: { label: 'Fender flare', sub: 'right', group: 'Aero' },
    FRONT_ANTISWAY: { label: 'Anti-roll bar', sub: 'front', group: 'Suspension' },
    REAR_ANTISWAY: { label: 'Anti-roll bar', sub: 'rear', group: 'Suspension' },
    FRONT_TOEIN: { label: 'Toe-in', sub: 'front', group: 'Suspension' },
    REAR_TOEIN: { label: 'Toe-in', sub: 'rear', group: 'Suspension' },
    FRONT_TOEOFFSET: { label: 'Toe offset', sub: 'front', group: 'Suspension' },
    REAR_TOEOFFSET: { label: 'Toe offset', sub: 'rear', group: 'Suspension' },
    LEFT_CASTER: { label: 'Caster', sub: 'left', group: 'Suspension' },
    RIGHT_CASTER: { label: 'Caster', sub: 'right', group: 'Suspension' },
    LEFT_TRACK_BAR: { label: 'Track bar', sub: 'left', group: 'Suspension' },
    RIGHT_TRACK_BAR: { label: 'Track bar', sub: 'right', group: 'Suspension' },
    FRONT_WHEEL_TRACK: { label: 'Wheel track', sub: 'front', group: 'Suspension' },
    REAR_WHEEL_TRACK: { label: 'Wheel track', sub: 'rear', group: 'Suspension' },
    WEIGHT_DISTRIB: { label: 'Weight distribution', group: 'Suspension' },
    WEIGHT_LATERAL: { label: 'Lateral weight', group: 'Suspension' },
    WEIGHT_VERTICAL: { label: 'Vertical weight', group: 'Suspension' },
    WEIGHT_WEDGE: { label: 'Wedge', group: 'Suspension' },
    BRAKE_BALANCE: { label: 'Brake balance', group: 'Brakes' },
    BRAKE_PRESSURE: { label: 'Brake pressure', group: 'Brakes' },
    BRAKE_MIGRATION: { label: 'Brake migration', group: 'Brakes' },
    BRAKE_DUCTS: { label: 'Brake ducts', sub: 'front', group: 'Brakes' },
    BRAKE_DUCTS_REAR: { label: 'Brake ducts', sub: 'rear', group: 'Brakes' },
    HANDBRAKE_PRESSURE: { label: 'Handbrake pressure', group: 'Brakes' },
    HANDFRONTBRAKE_PRESSURE: { label: 'Front handbrake pressure', group: 'Brakes' },
    TRACTION_CONTROL: { label: 'Traction control system', group: 'Electronics' },
    TRACTIONCONTROLMAP: { label: 'Traction control', group: 'Electronics' },
    TRACTIONCONTROLPOWERCUTMAP: { label: 'TC power cut', group: 'Electronics' },
    TRACTIONCONTROLSLIPANGLEMAP: { label: 'TC slip angle', group: 'Electronics' },
    ANTILOCK_BRAKES: { label: 'ABS system', group: 'Electronics' },
    ANTILOCKBRAKESYSTEMMAP: { label: 'ABS', group: 'Electronics' },
    ELECTRIC_MOTOR_MAP: { label: 'Electric motor map', group: 'Electronics' },
    REGEN_LEVEL: { label: 'Regen level', group: 'Electronics' },
    ENGINE_MIXTURE: { label: 'Engine mixture', group: 'Electronics' },
    ENGINE_BOOST: { label: 'Engine boost', group: 'Electronics' },
    ENGINE_BRAKEMAP: { label: 'Engine braking', group: 'Electronics' },
    STEER_LOCK: { label: 'Steering lock', group: 'Electronics' },
    FRONT_TIRE_COMPOUND: { label: 'Compound', sub: 'front', group: 'Tyres' },
    REAR_TIRE_COMPOUND: { label: 'Compound', sub: 'rear', group: 'Tyres' },
    DIFF_PRELOAD: { label: 'Diff preload', group: 'Drivetrain' },
    DIFF_POWER: { label: 'Diff power', group: 'Drivetrain' },
    DIFF_COAST: { label: 'Diff coast', group: 'Drivetrain' },
    DIFF_PUMP: { label: 'Diff pump', group: 'Drivetrain' },
    FRONT_DIFF_PRELOAD: { label: 'Front diff preload', group: 'Drivetrain' },
    FRONT_DIFF_POWER: { label: 'Front diff power', group: 'Drivetrain' },
    FRONT_DIFF_COAST: { label: 'Front diff coast', group: 'Drivetrain' },
    FRONT_DIFF_PUMP: { label: 'Front diff pump', group: 'Drivetrain' },
    TORQUE_SPLIT: { label: 'Torque split', group: 'Drivetrain' },
    REV_LIMITER: { label: 'Rev limiter', group: 'Drivetrain' },
    RATIO_SET: { label: 'Gear ratios', group: 'Drivetrain' },
    GEAR_FINAL: { label: 'Final drive', group: 'Drivetrain' },
    GEAR_REVERSE: { label: 'Reverse gear', group: 'Drivetrain' },
    GEAR_AUTOUPSHIFT: { label: 'Auto upshift', group: 'Drivetrain' },
    GEAR_AUTODOWNSHIFT: { label: 'Auto downshift', group: 'Drivetrain' },
    WATER_RADIATOR: { label: 'Water radiator', group: 'Cooling' },
    OIL_RADIATOR: { label: 'Oil radiator', group: 'Cooling' },
    FUEL_CAPACITY: { label: 'Fuel', group: 'Fuel & energy' },
    FUEL_LEVEL: { label: 'Fuel level', group: 'Fuel & energy' },
    VIRTUAL_ENERGY: { label: 'Virtual energy', group: 'Fuel & energy' },
    NUM_PITSTOPS: { label: 'Pit stops', group: 'Fuel & energy' },
}

/** Per-wheel settings (`WM_<NAME>-W_FL` …), shown per axle. */
const WM: Record<string, { label: string; group: SetupGroup }> = {
    RIDEHEIGHT: { label: 'Ride height', group: 'Suspension' },
    CAMBER: { label: 'Camber', group: 'Suspension' },
    SPRING: { label: 'Spring', group: 'Suspension' },
    TENDERSPRING: { label: 'Tender spring', group: 'Suspension' },
    TENDERSPRINGTRAVEL: { label: 'Tender spring travel', group: 'Suspension' },
    PACKERS: { label: 'Packers', group: 'Suspension' },
    SLOWBUMP: { label: 'Slow bump', group: 'Suspension' },
    SLOWREBOUND: { label: 'Slow rebound', group: 'Suspension' },
    FASTBUMP: { label: 'Fast bump', group: 'Suspension' },
    FASTREBOUND: { label: 'Fast rebound', group: 'Suspension' },
    PRESSURE: { label: 'Cold pressure', group: 'Tyres' },
    COMPOUND: { label: 'Tyre (wear · compound)', group: 'Tyres' },
    BRAKEDISC: { label: 'Brake disc', group: 'Brakes' },
    BRAKEPAD: { label: 'Brake pad', group: 'Brakes' },
}

const AXLE: Record<string, 'front' | 'rear'> = { FL: 'front', FR: 'front', RL: 'rear', RR: 'rear' }

function humanize(id: string): string {
    const s = id.replace(/_/g, ' ').toLowerCase().replace(/\b3rd\b/, 'third')
    return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface SetupRowDef {
    /** Stable id: the LMU key, or `WM_<NAME>|front` for an axle of a per-wheel setting. */
    id: string
    label: string
    sub: string
    group: SetupGroup
    order: number
}

/** How one LMU key is shown: its row and, for per-wheel settings, the wheel within the axle row. */
export function describeKey(key: string, order: number): SetupRowDef & { side: 'left' | 'right' | null } {
    const wm = /^WM_(.+)-W_(FL|FR|RL|RR)$/.exec(key)
    if (wm) {
        const [, name, wheel] = wm as unknown as [string, string, string]
        const axle = AXLE[wheel]!
        const d = WM[name] ?? { label: humanize(name), group: 'Other' as SetupGroup }
        return { id: `WM_${name}|${axle}`, label: d.label, sub: axle, group: d.group, order, side: wheel.endsWith('L') ? 'left' : 'right' }
    }
    const id = key.replace(/^VM_/, '')
    const gear = /^GEAR_(\d+)$/.exec(id)
    if (gear) return { id: key, label: `Gear ${gear[1]}`, sub: '', group: 'Drivetrain', order, side: null }
    const pit = /^PITSTOP_(\d+)$/.exec(id)
    if (pit) return { id: key, label: `Pit stop ${pit[1]}`, sub: '', group: 'Fuel & energy', order, side: null }
    const third = /^(FRONT|REAR)_3RD_(.+)$/.exec(id)
    if (third) return { id: key, label: `Third ${humanize(third[2]!).toLowerCase()}`, sub: third[1]!.toLowerCase(), group: 'Suspension', order, side: null }
    const d = VM[id]
    if (d) return { id: key, label: d.label, sub: d.sub ?? '', group: d.group, order, side: null }
    if (/^CHASSIS_ADJ_/.test(id)) return { id: key, label: humanize(id), sub: '', group: 'Other', order, side: null }
    return { id: key, label: humanize(id), sub: '', group: 'Other', order, side: null }
}

export interface SetupCell {
    text: string
    /** Mean position on the setting's scale (both wheels for an axle row). */
    value: number
    /** What counts when comparing: the text without parts that aren't a setting (tyre wear). */
    compare: string
}

/** LMU prefixes used tyres with their remaining tread ("99% Medium"); that is wear, not setup. */
function comparable(text: string): string {
    const parts = text.split(' · ').map(p => p.replace(/^\d+% /, ''))
    return parts.every(p => p === parts[0]) ? parts[0]! : parts.join(' · ')
}

export interface SetupRow extends SetupRowDef {
    /** One cell per setup, in the order given; null where that setup lacks the setting. */
    cells: (SetupCell | null)[]
    /** Some setup shows a different value than the first one. */
    differs: boolean
}

/** Settings that only ever read like this are not adjustable on the car and are hidden. */
const NOT_ADJUSTABLE = /^(N\/A|Non-adjustable|Fixed|Detached)$/i

/**
 * Lines up several setups as rows, grouped and in LMU's order. Per-wheel settings
 * become one row per axle ("5.1 cm", or "5.1 · 5.2 cm" when left and right differ).
 */
export function setupRows(setups: (SetupEntry[] | null)[]): SetupRow[] {
    const defs = new Map<string, SetupRowDef>()
    // wheel values per row per setup: left / right (or the single value)
    const values = new Map<string, { left?: SetupEntry; right?: SetupEntry; single?: SetupEntry }[]>()
    let order = 0
    setups.forEach((setup, k) => {
        for (const e of setup ?? []) {
            const d = describeKey(e.key, order++)
            if (!defs.has(d.id)) defs.set(d.id, { id: d.id, label: d.label, sub: d.sub, group: d.group, order: d.order })
            let perSetup = values.get(d.id)
            if (!perSetup) { perSetup = setups.map(() => ({})); values.set(d.id, perSetup) }
            const slot = perSetup[k]!
            if (d.side === 'left') slot.left = e
            else if (d.side === 'right') slot.right = e
            else slot.single = e
        }
    })

    const rows: SetupRow[] = []
    for (const def of defs.values()) {
        const cell = (text: string, value: number): SetupCell => ({ text, value, compare: comparable(text) })
        const cells = values.get(def.id)!.map((v): SetupCell | null => {
            if (v.single) return cell(v.single.text, v.single.value)
            const l = v.left
            const r = v.right
            if (!l && !r) return null
            if (!l || !r || l.text === r.text) return cell((l ?? r)!.text, (l ?? r)!.value)
            return cell(`${l.text} · ${r.text}`, (l.value + r.value) / 2)
        })
        const present = cells.filter((c): c is SetupCell => c !== null)
        if (present.every(c => NOT_ADJUSTABLE.test(c.text) || c.text === '')) continue
        rows.push({ ...def, cells, differs: present.some(c => c.compare !== present[0]!.compare) || present.length < cells.length })
    }
    return rows.sort((a, b) => SETUP_GROUPS.indexOf(a.group) - SETUP_GROUPS.indexOf(b.group) || a.order - b.order)
}

/** Setup settings (not strategy) in which setup `k` differs from setup 0. */
export function setupChanges(rows: SetupRow[], k: number): number {
    return rows.filter(r => !STRATEGY_GROUPS.has(r.group) && cellDiffers(r, k)).length
}

/** Setup `k` shows a different setting than setup 0 in this row. */
export function cellDiffers(row: SetupRow, k: number): boolean {
    return (row.cells[k]?.compare ?? null) !== (row.cells[0]?.compare ?? null)
}
