# LMU file formats

Everything here is verified against real files in [`samples/`](../samples/). Anything not
yet verified is listed under *Open* — nothing is assumed. (The web platform's older,
unverified description is in git history, see `docs/LEGACY.md`.)

## Telemetry recordings (`UserData\Telemetry\*.duckdb`)

Verified with DuckDB 1.5.6 against 11 recordings in `samples/` (Bahrain, Spa; Practice,
Qualify, Race; GT3) and 5 older WAL files.

### File naming

`<TrackName>_<P|Q|R>_<RecordingTime>.duckdb`, e.g.
`Bahrain International Circuit_R_2026-09-18T14_44_00Z.duckdb`. The letter matches
`SessionType` (`Practice`, `Qualify`, `Race`); the timestamp equals `RecordingTime`.

### Storage

DuckDB storage with **16 KB blocks** (`pragma_database_size`: `block_size = 16384`).

### Empty recordings

A recording can contain **no tables at all** (`Circuit de Spa-Francorchamps_R_…`, 12 KB).
Several recordings are only seconds long (garage → pit lane) and contain no lap.

### Write-ahead log (`<file>.duckdb.wal`)

- LMU can leave a DuckDB WAL next to a recording after the session ends (older samples had
  WALs for sessions from April to September; the newer samples have none).
- Some WALs contain the whole database from creation, others only appended rows.
- A WAL cannot be read without its main `.duckdb` file: DuckDB discards a WAL whose
  identifier does not match the database.
- Consequences for the app: a recording is the pair `.duckdb` + `.wal`; the WAL is not a
  "still recording" signal; both files are hashed, archived and exported together.

### Tables

101 tables: 3 meta tables, one table per continuous channel (56) and one per event (42).
Table names equal the channel/event names (with spaces, quote them: `"Lap Dist"`).

#### `metadata` (`key VARCHAR, value VARCHAR`), 12 rows

| key | example | note |
|---|---|---|
| `Version` | `1` | |
| `DriverName` | `Raffael Rayfl` | |
| `SteamID` | `0` | 0 in all samples |
| `RecordingTime` | `2026-09-18T14_44_00Z` | UTC, `_` instead of `:` |
| `SessionTime` | `14:00:17` | **in-game time of day at the recording start (`t0`)**, see *Conditions* |
| `SessionType` | `Practice` / `Qualify` / `Race` | note: `Qualify`, not "Qualifying" |
| `TrackName` | `Bahrain International Circuit` | |
| `TrackLayout` | `Bahrain International Circuit` | equals `TrackName` in all samples |
| `WeatherConditions` | `Overcast`, `Mostly Cloudy`, `Overcast & Light Rain` | |
| `CarName` | `Team WRT 2024 #46:LM`, `Garage 59 2026 #10:WEC` | |
| `CarClass` | `GT3` | |
| `CarSetup` | JSON, ~38 000 chars | see below |

`CarSetup` is an object of 172 entries keyed by setting id (`VM_BRAKE_BALANCE`, …), each
`{ available, diffComparisonValue, isFreeSetting, key, lastSavedStringValue, maxValue,
minValue, numChangesValue, stringValue, value }`, e.g. `stringValue: "9 (Understeer)", value: 9`.

#### `channelsList` (`channelName VARCHAR, frequency INTEGER, unit VARCHAR`)

One row per continuous channel. Frequencies follow `config.json` (Default preset in the
samples: 1, 2, 5, 7, 10, 20, 50, 100 Hz). Units seen: `C`, `%`, `RPM`, `m`, `L`, `G`, `deg`,
`m/s`, `s`, `km/h`, `kW`, `Nm`, `Pa`, `kPa`, empty.

#### `eventsList` (`eventName VARCHAR, unit VARCHAR`)

One row per event table (42 in the samples).

#### Continuous channel tables

Columns `value` or `value1`…`value4` (four wheels), **no timestamp column**. Rows are
samples at the channel's `frequency` in insertion order (`rowid`).

**Time of a row: `t0 + rowid / frequency`**, where `t0` is the first `GPS Time` value,
which equals the smallest event `ts` (identical in every sample). Evidence:
- `GPS Time` (100 Hz) deviates from `t0 + rowid/100` by at most 2.5 ms in all files.
- `rows / frequency` agrees across all channels of a file to within one sample.
- The `Lap Dist` (10 Hz) wrap at the finish line lies 0–80 ms after the matching
  `Current Sector` event, i.e. within one sample period.

`t0` is a session clock in seconds, not 0 (e.g. 17.96, 2970.115).

Value conventions verified from ranges:

| Channel | Range / unit |
|---|---|
| `Throttle Pos`, `Brake Pos` (+ `Unfiltered`) | 0–100 % |
| `Steering Pos` (+ `Unfiltered`) | −100…100 %, **> 0 = steering right** (La Source / Spa and T1 / Bahrain, both right-handers) |
| `Ground Speed` | km/h |
| `Wheel Speed` (`value1–4`) | m/s (max ≈ `Ground Speed` / 3.6). Front and rear are equal; only left vs right differ by the corner radius → **no wheel-slip information**. value1/value3 and value2/value4 are the same side; value1 is faster in right-hand corners → 1 = left (FL, FR, RL, RR) |
| `G Force Lat` | G — **actually longitudinal**: correlation −0.99 with d(speed)/dt, 0.93 with brake; ≈ +2 G under braking |
| `G Force Long` | G — **actually lateral**: correlation −0.95 with steering × v²; **< 0 in right-hand corners** |
| `G Force Vert` | G |
| `Lap Dist` | m since the finish line, resets at each crossing; ≈ track length before the wrap (Bahrain ≈ 5384 m, Spa ≈ 6976 m); small negative values (−2 m) occur |
| `Total Dist` | m, cumulative over the recording |
| `GPS Latitude/Longitude` | deg — **not real-world positions** (Bahrain samples at ≈ 60° N), but metrically consistent: with x = lon · 111 320 · cos(lat), y = lat · 110 540 the lap path length matches `Lap Dist` (5316 vs 5384 m, 6961 vs 6976 m) and right-hand corners turn clockwise (≥ 99.8 % of samples) — the map is correct up to rotation, not mirrored |

The app normalises the swapped G channels when reading: `gLat` = −`G Force Long`
(> 0 = right-hand corner), `gLon` = `G Force Lat` (> 0 = braking).

#### Event tables

Columns `ts DOUBLE` + `value` or `value1`…`value4`. A row is written at recording start
(`ts = t0`, current state) and **whenever the value changes** — not when it stays the same.

Lap-related events (all verified against each other in the race and qualifying samples):

| Event | Meaning |
|---|---|
| `Current Sector` | sector the car is in: `1`, `2`, then **`0` for sector 3**. A change to `1` is a **finish-line crossing** — including the rolling start of a race, where `Lap` does not count up |
| `Lap` | LMU's lap counter; changes at crossings but not at the race start; starts at 0 or 1 depending on the session |
| `Lap Time` | official time of the lap that just ended, written at the crossing; **0 = invalid lap** (no event if the previous lap was invalid too) |
| `Last Sector1` | sector 1 time of the lap that just ended; 0 = invalid sector |
| `Last Sector2` | **cumulative** sector 1+2 time of the lap that just ended; 0 = invalid |
| `Current Sector1`, `Current Sector2` | same values, written when the car enters the next sector |
| `Best LapTime`, `Current LapTime` | session best / last valid lap time |
| `In Pits` | 1 while in the pit lane |
| `Finish Status` | 1 after the chequered flag |

Example (race): crossings at 128.625 (start), 260.88, 385.14, 509.6, 633.16, 756.88; `Lap Time`
at 260.88 = 132.247 = 260.88 − 128.625 (± 8 ms); sector 1 = 42.734 = 171.36 − 128.625
(`Current Sector` → 2), sector 1+2 = 98.071 = 226.7 − 128.625 (`Current Sector` → 0).

Other events seen: `Gear` (TINYINT; 0 = neutral — every shift passes through 0 for ≈ 43 ms,
which the app ignores below 200 ms; negative = reverse is unverified), `TC`, `ABS` (BOOLEAN, active),
`SurfaceTypes` (`value1–4`), `Sector1/2/3 Flag`, `Headlights State`, `TyresCompound`, …

#### Conditions

Verified against the 10 non-empty samples:

- **In-game time of day:** `SessionTime − t0` gives the same session start in every file of a
  session (Bahrain: 13:59:58–14:00:01 for P/R, 13:44:58–13:44:59 for P/Q; Spa: 14:44:58–14:44:59
  for 5 files), so the clock at a lap start is `SessionTime + (lapStart − t0)` (assumes time
  scale 1×, the only one seen).
- `Track Temperature`, `Ambient Temperature` — channels, 1 Hz, `C` (Bahrain 26–28 / 28–29, Spa 17–20 / 16).
- `Wind Speed` — channel, 1 Hz, `m/s` (7 in all samples); `Wind Heading` in rad.
- `Minimum Path Wetness` — event, FLOAT, `%`: 0 at Bahrain (dry), 12.5–40 at Spa
  (`WeatherConditions` "Overcast & Light Rain" and the files before it).
- Not used (meaning unverified): `OffpathWetness` (BOOLEAN though unit `%`), `CloudDarkness`
  (always false), `TyresCompound` (`value1–4`, 0 or 1 — compound index, mapping unknown).

**Lap segmentation used by the app:** boundaries are the recording start, every
`Current Sector` change to 1 after the start, and the recording end. A segment between two
crossings is a complete lap; its time and validity come from `Lap Time` at the closing
crossing, its sectors from `Last Sector1` / `Last Sector2`. Segments touching the
recording start or end are partial (out-lap, formation lap, unfinished lap).

## Recording config (`UserData\Telemetry\config.json`)

```json
{
    "Channels": { "<channel>": { "Frequency": <Hz, integer>, "Name": "<channel>" }, … },
    "Events":   { "<event>":   { "Name": "<event>" }, … }
}
```

- Sample: 56 channels, 42 events; frequencies 1–100 Hz.
- The sample is identical to the app's *Default* preset (`src/shared/presets/medium.json`).

## Player settings (`UserData\player\Settings.JSON`)

- JSON object of sections (`CHAT`, `Controls`, `DRIVER`, `Game Options`, …), CRLF line
  endings, two-space indentation, no BOM.
- Each option `"<name>"` may have a description sibling `"<name>#"`.
- Automatic recording: `"Game Options"` → `"Automatically Record Telemetry"`: `true | false`
  (description: *"Enables automatic telemetry recording every time you drive. Recordings
  can be manually run when this is off or stopped via the Telemetry Recording key bind."*).
- Related, untouched by the app: `"Record Replays"`, `"Record Hotlap"`.

## Steam (`steamapps\libraryfolders.vdf`)

- KeyValues text format: `"libraryfolders" { "<n>" { "path" "<dir>" … "apps" { "<appid>" "<size>" } } }`,
  backslashes escaped (`\\`).
- LMU's app id `2399420` appears in the `apps` block of the library it is installed in.
