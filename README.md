# Rays Engineer

Local telemetry analysis for **Le Mans Ultimate** — a Windows desktop app that works
entirely offline. It reads the `.duckdb` recordings LMU writes itself, indexes them
automatically and lets you compare laps against a reference lap by track distance.

> **Status:** in development. This app replaces the former web platform (ASP.NET +
> Supabase), which has been removed — see [`docs/LEGACY.md`](docs/LEGACY.md).

---

## Features

| | Status |
|---|---|
| Finds LMU's telemetry folder automatically (all Steam libraries, Documents) — changeable in Settings | ✅ |
| Watches the folder and indexes new recordings once LMU has finished writing them | ✅ |
| Optional archive of every recording in the app's data folder (survives deletion in LMU) | ✅ |
| Turn LMU's *Automatically Record Telemetry* on/off from the app | ✅ |
| Recording presets — writes LMU's `config.json` (channel frequencies) | ✅ |
| Session metadata, laps (official LMU lap times, validity), sector times | ✅ |
| Reference lap per track + car (fastest valid lap, can be pinned per lap) | ✅ |
| Analysis: delta, speed, throttle, brake, steering and gear vs. a reference lap — by distance, synced scrubbing and zoom | ✅ |
| Track map with lap markers, corner table (min speed, time gained/lost per corner) | ✅ |
| Any other recorded channel (tyre/brake temperatures, pressures, fuel, suspension, …) as an extra synced chart | ✅ |
| Export / import sessions (`.rses`) and single laps (`.rlap`), import also by drag & drop | ✅ |
| Notes and tags per session, filter in the session list | ✅ |
| Delete sessions (LMU's recording goes to the Recycle Bin) | ✅ |

No account, no cloud, no network access: the app blocks every outgoing request.

## Install

1. Download `Rays Engineer Setup <version>.exe` from the latest GitHub **Release** and run it.
2. The installer is not code-signed yet, so Windows SmartScreen warns:
   **More info → Run anyway**.
3. In LMU, *Automatically Record Telemetry* must be on — the app shows its state on the
   **Recording** page and can switch it (close LMU first).

## Development

Requirements: Node.js 22, npm. Everything lives in `Rays_Engineer.Desktop/`:

```bash
cd Rays_Engineer.Desktop
npm install          # also fetches the Electron build of better-sqlite3
npm run dev          # app with hot reload
npm run build        # typecheck + production build
npm test             # unit tests (vitest)
npm run lint
npm run smoke        # end-to-end smoke test of the build
npm run dist:win     # NSIS installer (use the CI build for real installs)
```

Details (architecture, security model, data flow): [`Rays_Engineer.Desktop/README.md`](Rays_Engineer.Desktop/README.md).

### Architecture in short

```
Renderer (React, sandboxed, no Node)  ── typed window.api ──▶  Main process (thin)
        │                                                          │ spawns
        └──── direct MessagePort (Float32Array traces) ─────▶  Worker (utilityProcess)
                                                                   ├─ SQLite index (better-sqlite3)
                                                                   ├─ folder detection + watcher
                                                                   └─ DuckDB reader (@duckdb/node-api)
```

Raw telemetry stays in LMU's `.duckdb` files; the SQLite index only holds metadata,
lap summaries, reference laps, notes/tags and settings.

### CI

| Workflow | Trigger | What it does |
|---|---|---|
| `tests.yml` | PR to `main` | on Windows: `npm ci` → lint → tests → build → NSIS installer → smoke test of the packaged `.exe` |
| `pr-comment.yml` | after `Tests` | posts the result as a single, updated comment on the PR |
| `pr-rules.yml` | PR to `main` | `issue-link`: description references an open issue (`Closes #42`); `cla`: CLA box ticked (not for the maintainer/bots) |
| `release.yml` | creating branch `release/x.y.z` | builds + smoke-tests the installer and publishes GitHub release `vx.y.z` (`-beta.1` etc. → pre-release) |

`main` is only changed through pull requests; to release, create `release/<version>` from `main`.

## Repository layout

| Path | |
|---|---|
| `Rays_Engineer.Desktop/` | **the desktop app** (Electron, electron-vite, React, TypeScript) |
| `samples/` | real LMU recordings and settings, used as test fixtures and for `docs/SCHEMA.md` |
| `docs/SCHEMA.md` | LMU file formats as verified against real files |
| `docs/LEGACY.md` | where the removed web platform lives in git history |
| `.github/workflows/` | CI and releases |

## Contributing

Contributions are welcome — please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Every pull
request needs a linked open issue and agreement to the [CLA](CLA.md).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — you may use, modify and share Rays Engineer
for any noncommercial purpose. Commercial use is not permitted.
