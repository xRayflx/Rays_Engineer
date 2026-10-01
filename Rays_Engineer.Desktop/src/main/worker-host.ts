/**
 * Owns the utility process: spawns it, restarts it on crash, and brokers
 * MessagePort pairs so renderers can talk to it directly.
 */
import { app, MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import workerPath from '../worker/index?modulePath'
import { IpcPush } from '../shared/ipc'
import {
    type WorkerMethod,
    type WorkerMethods,
    type WorkerResponse,
} from '../shared/worker-protocol'

const REQUEST_TIMEOUT_MS = 30_000

interface Pending {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
}

export class WorkerHost {
    private child: UtilityProcess | null = null
    private nextId = 1
    private readonly pending = new Map<number, Pending>()
    private stopping = false

    start(): void {
        this.stopping = false
        // RAYS_WORKER_INSPECT=9230 opens a Node inspector on the worker (development builds only).
        const inspect = !app.isPackaged ? process.env['RAYS_WORKER_INSPECT'] : undefined
        const child = utilityProcess.fork(workerPath, [], {
            serviceName: 'Rays Engineer Worker',
            stdio: 'inherit',
            execArgv: inspect ? [`--inspect=${/^\d+$/.test(inspect) ? inspect : '9230'}`] : [],
            env: {
                ...process.env,
                RAYS_USER_DATA: app.getPath('userData'),
                RAYS_DOCUMENTS: app.getPath('documents'),
                RAYS_APP_VERSION: app.getVersion(),
            },
        })
        child.on('message', (msg: WorkerResponse | { type: 'event' }) => {
            if ('id' in msg) this.onResponse(msg)
        })
        child.on('exit', code => {
            this.child = null
            this.rejectAll(new Error(`Worker exited with code ${code}`))
            if (!this.stopping) {
                console.error(`[worker] exited unexpectedly (code ${code}), restarting`)
                setTimeout(() => this.start(), 500)
            }
        })
        this.child = child
    }

    stop(): void {
        this.stopping = true
        this.child?.kill()
        this.child = null
    }

    get pid(): number | null {
        return this.child?.pid ?? null
    }

    call<M extends WorkerMethod>(method: M, params: WorkerMethods[M]['params']): Promise<WorkerMethods[M]['result']> {
        const child = this.child
        if (!child) return Promise.reject(new Error('Worker is not running'))

        const id = this.nextId++
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`Worker call '${method}' timed out`))
            }, REQUEST_TIMEOUT_MS)
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
            child.postMessage({ id, method, params })
        })
    }

    /** Creates a port pair: one end to the worker, the other to the renderer. */
    connectRenderer(target: WebContents): void {
        if (!this.child) throw new Error('Worker is not running')
        const { port1, port2 } = new MessageChannelMain()
        this.child.postMessage({ type: 'connect' }, [port1])
        target.postMessage(IpcPush.workerPort, null, [port2])
    }

    private onResponse(msg: WorkerResponse): void {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error))
    }

    private rejectAll(err: Error): void {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer)
            p.reject(err)
        }
        this.pending.clear()
    }
}
