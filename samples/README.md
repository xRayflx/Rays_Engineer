# Sample recordings

Real Le Mans Ultimate recordings used to derive `docs/SCHEMA.md` and as test
fixtures for the telemetry reader. Nothing in here is generated or guessed.

| What | From | Purpose |
|---|---|---|
| `*.duckdb` **and** `*.duckdb.wal` | `…\Le Mans Ultimate\UserData\Telemetry\` | schema analysis, reader tests — always copy both files of a recording; a `.wal` alone cannot be read |
| `Settings.JSON` | `…\Le Mans Ultimate\UserData\player\Settings.JSON` | "recording disabled" detection |
| `libraryfolders.vdf` (optional) | `…\Steam\steamapps\libraryfolders.vdf` | folder detection test |

GitHub rejects files over 100 MB (browser upload: 25 MB) — zip large recordings or use a
shorter session. `.duckdb` files are git-ignored elsewhere but allowed in this folder, so
`git add samples/` works.

## Analysis

```bash
cd Rays_Engineer.Desktop
npm run inspect-duckdb -- ../samples          # writes ../samples/analysis/*.inspect.json
```

The reports contain the file's metadata (driver name, Steam ID, car setup).
