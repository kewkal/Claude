# Component schema

One JSON file per component in `src/content/components/`. Type: `Component` in `src/engine/types.ts`. Examples: every file in that folder.

## Sourced values

Every spec, threshold, location, designation, part number, and availability status is a **Sourced** object:

```json
{ "value": 5, "verified": false, "basis": "rule-of-thumb", "note": "why / what to check", "source": "docs/x.pdf p.12" }
```

- `verified: true` **requires** `source` (validator enforces).
- `verified: false` → "⚠ generic value" tag in the UI and a row in `docs/UNVERIFIED.md`.
- `basis: "rule-of-thumb"` → "rule of thumb" tag in the UI, even when verified.
- After any change, run `npm run unverified` to regenerate the list.

## Fields

| Field | Notes |
|---|---|
| `id`, `name` | |
| `kind` | Selects the Component Lab judge: `contactor`, `relay`, `run-capacitor`, `pressure-switch`, `ntc-sensor`, `actuator-2-10`, `actuator-sylk`. |
| `domain` | One of the five domains. |
| `function` | What it does in the sequence of operation. |
| `perUnit.<unitId>` | `availability` (`factory-standard` / `factory-option` / `field-accessory` / `not-available`), `designation`, `location` (in the unit + on the wiring diagram), `partNumber`. All Sourced. Plus `sequenceRole`. Omit a unit the component doesn't exist on. |
| `failureModes[]` | `id`, `name`, `goodVsBad`, `symptoms`. A lab case's `failureMode` must be one of these ids. |
| `test` | `meter`, `procedure[]`, `safety[]`. |
| `thresholds` | Map of Sourced numbers used by the judge (below). |
| `symptoms` | `customer`, `tech`. |
| `confusedWith[]` | Look-alike faults. |
| `labCases[]` | At least one per unit in `perUnit` (validator enforces). |

## Thresholds and lab reading keys per `kind`

| kind | thresholds | lab reading keys |
|---|---|---|
| contactor | `coilOhms` [lo,hi], `contactDropGoodV`, `contactDropBadV` | `coil_ohm`, `drop_p1..3`, `visual` |
| relay | `coilOhms` [lo,hi], `contactOhmsMax` | `coil_ohm`, `no_deenergized`, `nc_deenergized`, `no_energized`, `nc_energized` |
| run-capacitor | `tolerancePct` (fallback; the rating label wins), `marginalPct` | `uf`, `case`, `shorted` |
| pressure-switch | `setpointTolPsig` | `opened_at_psig`, `closed_at_psig` (`"never"` allowed). Rating needs `opensPsig`, `closesPsig`. |
| ntc-sensor | `goodTolF`, `marginalTolF` | `ref_temp_f`, `ohm` (checked against `src/content/honeywell/c7250a-chart.json`) |
| actuator-2-10 / actuator-sylk | `powerVac` [lo,hi], `trackTolPct`, `strokeSecondsMax` | `vac`, `vdc`, `shaft_pct`, `stroke_s`, `motor_sound` |

## Lab case

```json
{ "id": "cap-tr-open", "unitId": "trane-tsc072", "designation": "CF",
  "context": "ODM hums, won't start.", "rating": { "uf": 5, "tolerancePct": 6, "vac": 370 },
  "condition": "bad", "failureMode": "open",
  "tests": [ { "id": "uf", "label": "Capacitance", "setup": "LOTO, discharged, one lead off.",
               "minutes": 3, "power": "off", "readings": { "uf": "OL" } } ],
  "explanation": "..." }
```

The validator runs the judge on the readings and fails if the verdict disagrees with `condition` / `failureMode`. Ohm and µF tests must be `power: "off"` unless `setup` says "in-circuit".
