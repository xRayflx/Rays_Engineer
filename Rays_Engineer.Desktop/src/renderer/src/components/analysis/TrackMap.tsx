import { useEffect, useRef } from 'react'
import { useAnalysisStore } from '../../lib/analysisStore'
import { useChartPalette } from '../../lib/theme'

export interface MapLap {
    color: string
    x: Float32Array
    y: Float32Array
}

interface Props {
    laps: MapLap[]
    stepM: number
}

/** Track outline from the reference lap with a marker per lap at the cursor distance; the zoomed range is highlighted. */
export default function TrackMap({ laps, stepM }: Props) {
    const canvas = useRef<HTMLCanvasElement>(null)
    const palette = useChartPalette()

    useEffect(() => {
        const el = canvas.current
        const ref = laps[0]
        if (!el || !ref || ref.x.length < 2) return

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (let i = 0; i < ref.x.length; i++) {
            minX = Math.min(minX, ref.x[i]!); maxX = Math.max(maxX, ref.x[i]!)
            minY = Math.min(minY, ref.y[i]!); maxY = Math.max(maxY, ref.y[i]!)
        }

        const draw = () => {
            const { cursorM, zoom } = useAnalysisStore.getState()
            const dpr = window.devicePixelRatio || 1
            const w = el.clientWidth
            const h = el.clientHeight
            el.width = w * dpr
            el.height = h * dpr
            const ctx = el.getContext('2d')!
            ctx.scale(dpr, dpr)
            ctx.clearRect(0, 0, w, h)
            const pad = 14
            const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1))
            const ox = (w - (maxX - minX) * scale) / 2
            const oy = (h - (maxY - minY) * scale) / 2
            const px = (i: number, lap: MapLap) => ox + (lap.x[i]! - minX) * scale
            const py = (i: number, lap: MapLap) => h - (oy + (lap.y[i]! - minY) * scale)

            const path = (from: number, to: number, stroke: string, width: number) => {
                ctx.strokeStyle = stroke
                ctx.lineWidth = width
                ctx.lineJoin = 'round'
                ctx.beginPath()
                ctx.moveTo(px(from, ref), py(from, ref))
                for (let i = from + 1; i <= to; i++) ctx.lineTo(px(i, ref), py(i, ref))
                ctx.stroke()
            }
            const last = ref.x.length - 1
            path(0, last, palette.mapTrack, 6)
            if (zoom) path(Math.max(0, Math.floor(zoom.min / stepM)), Math.min(last, Math.ceil(zoom.max / stepM)), palette.mapZoom, 6)
            // start/finish
            ctx.fillStyle = palette.mapStart
            ctx.beginPath(); ctx.arc(px(0, ref), py(0, ref), 3, 0, Math.PI * 2); ctx.fill()

            if (cursorM != null) {
                const i = Math.round(cursorM / stepM)
                for (const lap of [...laps].reverse()) {
                    if (i < 0 || i >= lap.x.length) continue
                    ctx.fillStyle = lap.color
                    ctx.strokeStyle = palette.markerRing
                    ctx.lineWidth = 2
                    ctx.beginPath(); ctx.arc(px(i, lap), py(i, lap), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
                }
            }
        }

        let frame = 0
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
        schedule()
        const unsub = useAnalysisStore.subscribe((s, prev) => { if (s.cursorM !== prev.cursorM || s.zoom !== prev.zoom) schedule() })
        const ro = new ResizeObserver(schedule)
        ro.observe(el)
        return () => { unsub(); ro.disconnect(); cancelAnimationFrame(frame) }
    }, [laps, stepM, palette])

    return <canvas ref={canvas} className="w-full h-full block" />
}
