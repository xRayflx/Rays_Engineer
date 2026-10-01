import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useAnalysisStore } from '../../lib/analysisStore'
import { useChartPalette, type ChartPalette } from '../../lib/theme'

export interface TraceSeries {
    label: string
    color: string
    values: (number | null)[]
    width?: number
}

interface Props {
    title: string
    x: number[]
    series: TraceSeries[]
    height: number
    yRange?: [number, number]
    formatY?: (v: number) => string
    stepped?: boolean
    zeroLine?: boolean
    /** Distance labels; only the bottom chart shows them. */
    showX?: boolean
    /** Identifies the chart for the readout's hovered-channel column. */
    readKey?: string
}

const SYNC_KEY = 'laps'
const axis = (p: ChartPalette) => ({ stroke: p.axis, grid: { stroke: p.grid, width: 1 }, ticks: { stroke: p.ticks, width: 1 }, font: '11px "JetBrains Mono", monospace' })

/**
 * One uPlot chart over lap distance. All charts share cursor (uPlot sync) and
 * zoom (analysis store), so scrubbing one moves the others, the map and the readout.
 */
export default function TraceChart({ title, x, series, height, yRange, formatY, stepped, zeroLine, showX, readKey }: Props) {
    const holder = useRef<HTMLDivElement>(null)
    const plot = useRef<uPlot | null>(null)
    const zoom = useAnalysisStore(s => s.zoom)
    const palette = useChartPalette()

    useEffect(() => {
        const el = holder.current
        if (!el) return
        const { setCursor, setZoom } = useAnalysisStore.getState()
        // uPlot fits the x scale to the data while it is built; that must not clear the shared zoom.
        let built = false
        const AXIS = axis(palette)
        const paths = stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined
        const opts: uPlot.Options = {
            width: el.clientWidth,
            height,
            legend: { show: false },
            cursor: {
                sync: { key: SYNC_KEY, setSeries: false },
                drag: { x: true, y: false, setScale: true },
                points: { size: 5 },
            },
            select: { show: true, left: 0, top: 0, width: 0, height: 0 },
            scales: {
                x: { time: false, min: zoom?.min, max: zoom?.max },
                y: yRange ? { range: yRange } : { auto: true },
            },
            axes: [
                showX
                    ? { ...AXIS, size: 30, values: (_u, v) => v.map(m => `${Math.round(m)} m`) }
                    : { ...AXIS, size: 6, values: (_u, v) => v.map(() => '') },
                { ...AXIS, size: 44, values: (_u, v) => v.map(n => (formatY ? formatY(n) : String(n))) },
            ],
            series: [
                {},
                ...series.map(s => ({ label: s.label, stroke: s.color, width: s.width ?? 1.25, points: { show: false }, paths, spanGaps: false })),
            ],
            hooks: {
                setCursor: [u => {
                    const i = u.cursor.idx
                    setCursor(i == null ? null : (u.data[0][i] ?? null))
                }],
                setScale: [(u, key) => {
                    if (!built || key !== 'x') return
                    const { min, max } = u.scales.x
                    if (min == null || max == null) return
                    const full = min <= x[0]! && max >= x[x.length - 1]!
                    const cur = useAnalysisStore.getState().zoom
                    const next = full ? null : { min, max }
                    if (JSON.stringify(cur) !== JSON.stringify(next)) setZoom(next)
                }],
                ...(zeroLine ? {
                    draw: [(u: uPlot) => {
                        const y = u.valToPos(0, 'y', true)
                        const ctx = u.ctx
                        ctx.save()
                        ctx.strokeStyle = palette.zeroLine
                        ctx.lineWidth = 1
                        ctx.beginPath()
                        ctx.moveTo(u.bbox.left, y)
                        ctx.lineTo(u.bbox.left + u.bbox.width, y)
                        ctx.stroke()
                        ctx.restore()
                    }],
                } : {}),
            },
        }
        const u = new uPlot(opts, [x, ...series.map(s => s.values)] as uPlot.AlignedData, el)
        plot.current = u
        built = true
        const z = useAnalysisStore.getState().zoom
        if (z) u.setScale('x', z)
        const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }))
        ro.observe(el)
        return () => {
            ro.disconnect()
            u.destroy()
            plot.current = null
        }
        // The chart is rebuilt when its data changes; zoom is applied separately below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [x, series, height, yRange, stepped, zeroLine, showX, palette])

    useEffect(() => {
        const u = plot.current
        if (!u) return
        const min = zoom?.min ?? x[0]!
        const max = zoom?.max ?? x[x.length - 1]!
        if (u.scales.x.min !== min || u.scales.x.max !== max) u.setScale('x', { min, max })
    }, [zoom, x])

    return (
        <div>
            <div className="label px-1 text-fg-2">{title}</div>
            <div ref={holder} onDoubleClick={() => useAnalysisStore.getState().setZoom(null)}
                onMouseEnter={() => useAnalysisStore.getState().setHoverChart(readKey ?? null)} />
        </div>
    )
}
