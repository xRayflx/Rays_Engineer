# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Rays Engineer** — an offline Windows desktop app for analysing **Le Mans Ultimate**
telemetry. It reads the `.duckdb` recordings LMU writes itself (`UserData\Telemetry`),
indexes them in a local SQLite database and compares laps by track distance.
No accounts, no cloud, no network access (the app blocks every outgoing request).

All code lives in `Rays_Engineer.Desktop/` (Electron + electron-vite + React + TypeScript).
The former web platform (ASP.NET API, web app, tray uploader) was removed — see
`docs/LEGACY.md` for where to find it in git history.

## Commands

```bash
cd Rays_Engineer.Desktop
npm install                 # postinstall fetches the Electron build of better-sqlite3
npm run dev                 # app with hot reload
npm run build               # typecheck (node + web) + production build into out/
npm test                    # vitest unit tests
npm run lint
npm run smoke               # end-to-end smoke test (pass an exe path to test a packaged build)
npm run inspect-duckdb -- <file|folder>   # structural dump of LMU recordings
npm run dist:win            # NSIS installer (real installers come from CI)
```

Electron refuses to start as root with the sandbox enabled — run the app/smoke test as a
normal user in containers. CI (`.github/workflows/tests.yml`, on PRs to `main`) lints, tests,
builds and smoke-tests the NSIS installer on Windows; `pr-rules.yml` requires `Closes #<issue>`
and (for outside contributors) the CLA checkbox; creating branch `release/x.y.z` runs
`release.yml`, which publishes GitHub release `vx.y.z`. `main` is changed only via PRs.

License: PolyForm Noncommercial 1.0.0 (`LICENSE`); contributions fall under `CLA.md`.

## Architecture

| Process | Path | Role |
|---|---|---|
| main | `src/main/` | window, security policies (`security.ts`), IPC handlers (`ipc.ts`), worker host |
| preload | `src/preload/` | sandboxed; exposes the typed `window.api` |
| worker (utilityProcess) | `src/worker/` | all heavy work: SQLite index, folder detection + watcher, DuckDB reads, analysis |
| renderer | `src/renderer/` | React UI, talks to the worker over a direct MessagePort |
| shared | `src/shared/` | IPC contract (`ipc.ts`), worker RPC protocol (`worker-protocol.ts`), domain types |

- Security: `contextIsolation`, no `nodeIntegration`, sandbox, custom `app://` protocol with
  strict CSP, `webRequest` network kill-switch, every IPC sender validated. Keep it that way.
- New worker features: add the method to `WorkerMethods` in `src/shared/worker-protocol.ts`,
  implement it in the `handlers` map in `src/worker/index.ts`, call it via `callWorker()`
  (`src/renderer/src/lib/worker.ts`). Large data goes as typed arrays, never JSON.
- SQLite schema: `src/worker/db/schema.ts`, append-only migrations. The index never holds raw samples.
- A recording is `<name>.duckdb` **plus** `<name>.duckdb.wal` (LMU leaves the WAL in place).
- Read LMU data only through `src/worker/telemetry/reader.ts`; it normalises LMU quirks
  (swapped G channels, gear-shift neutral blips, Lap Dist wrap) — see `docs/SCHEMA.md`.
- Exchange formats `.rses` / `.rlap`: `src/shared/package.ts`, `src/worker/packages.ts`.

## LMU file formats

Only what is verified against real files in `samples/` goes into `docs/SCHEMA.md`.
Do not guess LMU's schema — inspect real files (`npm run inspect-duckdb`).

## Decisions

English-only UI; clean UI over feature count; reference lap = best valid lap per
track + car (a comparison can pick another lap in the compare panel, nothing is pinned); `.rlap` keeps original timestamps, lap start/end in the
manifest; `samples/` stays in the repo as test fixtures.
