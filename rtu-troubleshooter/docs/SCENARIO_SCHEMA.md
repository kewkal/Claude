# Scenario schema

One JSON file per scenario in `src/content/scenarios/`. The app picks it up automatically. Run `npm run validate` after every edit; it blocks the build if any reading contradicts the declared fault.

Types live in `src/engine/types.ts` (`Scenario`). Working examples: every file in `src/content/scenarios/`.

## Top level

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Convention: `<unit>-<tier>-<topic>`, e.g. `tr-med-fan-cap`. |
| `title` | string | Shown on the dispatch board. |
| `unitId` | `lennox-lch240` \| `trane-tsc072` | Must match a file in `src/content/units/`. |
| `difficulty` | `beginner` \| `medium` \| `advanced` \| `master` | Advanced must declare ≥2 faults (validator enforces). |
| `domains` | array of `airflow`, `refrigeration`, `electrical`, `controls`, `components` | |
| `honeywell` | bool | `true` requires a `jade` snapshot. |
| `honeywellTypes` | string[] | Coverage tags (list below). |
| `dispatch` | object | `complaint`, `customer`, `outdoorF`, `outdoorRH`, `timeOfDay` ("2:10 PM"), `economizer`, optional `notes`. Mention "JADE" in `economizer` to enable the JADE tab. |
| `state` | object | What the equipment is physically doing. See below. |
| `faults` | Fault[] | `type`, `componentId?`, `designation?`, `role` (`root`/`secondary`), `description`. At least one root. |
| `baseline` | string | Baseline name in the unit file (e.g. `cooling-95F`). Readings start from here. |
| `readings` | map | Overrides on top of the baseline. Keys must exist in `src/content/catalog/readings.json`. |
| `jade` | object | `values` (JADE menu key → shown value), `alarms` (keys from `alarmCatalog` in `honeywell/jade-menu.json`), `sensorsDetected`. Without it, the LCD derives MA TEMP / OA TEMP / DAMPER OUT etc. from the readings. |
| `hints` | string[] | Beginner: unlimited. Medium: 2. Advanced: 1. Master: none. |
| `diagnosis` | Choice[] | Exactly one `correct: true`. Each has `feedback`. |
| `repair` | Choice[] | One `correct`. Others may set `symptomOnly` (partial credit + callback), `unneededPart` (fixed it, wasted part + callback), `partsCost` (USD charged to the truck budget). |
| `idealPath` | `{action, why}[]` | Action ids from `catalog/actions.json`. Drives the debrief, the beginner guided steps, and the time/efficiency bonus. |
| `debrief` | string | The "why". |
| `concepts` | string[] | Tags fed to the review queue when the player misses the root cause. |

## `state`

```json
{ "callForCooling": true, "blower": "running", "compressor1": "short-cycling",
  "condFan1": "humming", "damperActualPct": 20, "damperFree": true,
  "economizerController": "jade-w7220" }
```

Machine states: `running`, `off`, `tripped`, `short-cycling` (treated as running for readings), `humming`, `locked-out`.
`damperFree` = does the damper stroke freely by hand with the actuator released. It separates actuator faults from binding.

## Readings

- Numbers in the catalog unit (°F, PSIG, VAC/VDC, A, Ω, MΩ, µF, in. W.C., %, ppm).
- `"OL"` for an open / over-range ohmmeter reading.
- Any other string = a field observation shown as text (e.g. "Contactor not pulled in").
- Superheat and subcooling are **calculated** from pressures + line temps using the R-410A PT table (dew for suction, bubble for liquid). Never author SH/SC directly.
- MAT sensor ohms must match the C7250A chart at `t_mat` unless a MAT sensor fault is declared.

## Generic physics the validator always checks

Non-negative SH/SC while running · evap sat ≥10°F below entering air · condensing above OA · coil ΔT ≥8°F running, ≈0 stopped · mixing equation (MAT ≈ p·OAT + (1−p)·RAT ±3°F) · line imbalance ≤2% unless a supply fault · amps vs compressor state · contactor coil/pole logic · fan amps vs fan state · capacitor within 10% unless a cap fault · actuator tracks 2-10 Vdc unless an actuator/linkage fault · MAT ohms vs probe · LPS state vs running · no running above HPS cutout · JADE `DAMPER OUT` = measured `vdc_act_cmd` · JADE `MA TEMP` = probe.

## Fault types (`FAULT_RULES` in `src/engine/rules.ts`)

| Type | Required evidence |
|---|---|
| `contactor-coil-open` | coil OL, ≥20 V at coil, compressor not running, 0 A |
| `contactor-pole-open` | exactly one pole drop >10 V energized, others ≤1 V |
| `single-phasing` | one leg 0 A, two legs >1.5× baseline amps (while trying to run) |
| `compressor-overload-trip` | tripped/humming/cycling, shell ≥180°F, windings all OL or all balanced, no ground fault |
| `run-capacitor-failed` | µF <90% of rating or OL; fan off/humming; head approach ≥30°F if compressor runs |
| `hps-trip` | compressor tripped/locked-out/cycling; shows at a controller |
| `low-charge` | SH ≥15°F, SC ≤5°F, suction sat ≤38°F |
| `lps-trip` | compressor cycling or locked out |
| `actuator-failed` | ≥19 VAC power, ≥2.5 Vdc command, blades >15% off command, `damperFree: true` |
| `damper-binding` | good power + signal, `damperFree: false` |
| `linkage-broken` | blades off command, no JADE alarm, `damperFree: true` |
| `mat-sensor-failed` | OL / <100 Ω / >5°F off chart; JADE alarm if open/short |

Adding a fault type: add a rule to `FAULT_RULES`, plus a mutation in `scripts/validate.ts` that proves the rule catches a contradiction.

## Honeywell scenario-type tags

`sylk-comm-loss`, `wrong-strategy`, `min-pos-too-high`, `min-pos-zero`, `vdc-present-no-movement`, `no-signal`, `mat-sensor-failed`, `mat-sensor-misplaced`, `co2-sensor-fault`, `freeze-protect`, `retrofit-miswire`, `w7212-sensor-or-dial`, `linkage-broken-reports-normal`. The validator prints which ones are covered.
