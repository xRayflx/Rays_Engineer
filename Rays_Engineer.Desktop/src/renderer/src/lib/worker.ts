/**
 * Direct RPC channel from the renderer to the utility process.
 * The port is brokered by main once; afterwards traffic bypasses main entirely
 * and typed arrays arrive as binary (structured clone), not JSON.
 */
import { WORKER_PORT_MESSAGE } from '@shared/ipc'
import { isWorkerEvent, type WorkerEventName, type WorkerMethod, type WorkerMethods, type WorkerResponse } from '@shared/worker-protocol'

let portPromise: Promise<MessagePort> | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<WorkerEventName, Set<() => void>>()

function getPort(): Promise<MessagePort> {
    if (portPromise) return portPromise
    portPromise = new Promise(resolve => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window || event.data?.type !== WORKER_PORT_MESSAGE) return
            const port = event.ports[0]
            if (!port) return
            window.removeEventListener('message', onMessage)
            port.onmessage = (e: MessageEvent<WorkerResponse | unknown>) => {
                if (isWorkerEvent(e.data)) {
                    listeners.get(e.data.event)?.forEach(fn => fn())
                    return
                }
                if (!isResponse(e.data)) return
                const p = pending.get(e.data.id)
                if (!p) return
                pending.delete(e.data.id)
                if (e.data.ok) p.resolve(e.data.result)
                else p.reject(new Error(e.data.error))
            }
            resolve(port)
        }
        window.addEventListener('message', onMessage)
        window.api.worker.requestPort()
    })
    return portPromise
}

export async function callWorker<M extends WorkerMethod>(
    method: M,
    params: WorkerMethods[M]['params'],
): Promise<WorkerMethods[M]['result']> {
    const port = await getPort()
    const id = nextId++
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        port.postMessage({ id, method, params })
    })
}

function isResponse(data: unknown): data is WorkerResponse {
    return typeof data === 'object' && data !== null && typeof (data as WorkerResponse).id === 'number'
}

/** Subscribes to a worker event; returns the unsubscribe function. */
export function onWorkerEvent(event: WorkerEventName, fn: () => void): () => void {
    void getPort() // make sure the channel is open so events can arrive
    let set = listeners.get(event)
    if (!set) listeners.set(event, set = new Set())
    set.add(fn)
    return () => { set.delete(fn) }
}
