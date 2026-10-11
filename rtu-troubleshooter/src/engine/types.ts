// Core content schema. Documented for authors in docs/SCENARIO_SCHEMA.md and docs/COMPONENT_SCHEMA.md.

/** Where a value came from. Anything not from /docs is verified:false and shows a "⚠ generic value" tag. */
export type Basis = 'manual' | 'rating-label' | 'rule-of-thumb' | 'generic' | 'physics';

/** A spec, threshold, setting, or status that must be traceable to a source. */
export interface Sourced<T> {
  value: T;
  verified: boolean;
  /** Required when verified is true, e.g. "docs/LCH-IOM.pdf p.14". */
  source?: string;
  /** rule-of-thumb is shown as such in the UI even when verified. */
  basis?: Basis;
  note?: string;
}

export type UnitId = 'lennox-lch240' | 'trane-tsc072';
export type Difficulty = 'beginner' | 'medium' | 'advanced' | 'master';
export type Domain = 'airflow' | 'refrigeration' | 'electrical' | 'controls' | 'components';
export type Availability = 'factory-standard' | 'factory-option' | 'field-accessory' | 'not-available';

/** A raw meter/gauge/visual result. "OL" = over-limit / open on an ohmmeter. */
export type ReadingValue = number | 'OL' | string;

export type DisplayKind =
  | 'gauge-low'
  | 'gauge-high'
  | 'dmm-vac'
  | 'dmm-vdc'
  | 'clamp-a'
  | 'dmm-ohm'
  | 'dmm-megohm'
  | 'dmm-uf'
  | 'thermo'
  | 'manometer'
  | 'percent'
  | 'ppm'
  | 'rh'
  | 'text';

export interface ReadingDef {
  label: string;
  unit: string;
  display: DisplayKind;
  /** Power state needed to take the reading safely. */
  power: 'on' | 'off' | 'any';
}

export interface ActionDef {
  id: string;
  label: string;
  group: 'safety' | 'look' | 'controls' | 'jade' | 'electrical' | 'refrigeration' | 'air' | 'economizer' | 'hands-on';
  minutes: number;
  readings: string[];
  /** 'on' = needs power; 'off' = needs LOTO + verified dead; 'any' = no requirement. */
  power: 'on' | 'off' | 'any';
  hint?: string;
}

export type MachineState = 'running' | 'off' | 'tripped' | 'short-cycling' | 'humming' | 'locked-out';

/** What the equipment is physically doing. The validator checks readings against this. */
export interface ScenarioState {
  callForCooling: boolean;
  blower: MachineState;
  compressor1: MachineState;
  condFan1: MachineState;
  /** Actual outdoor-air damper position, 0-100 %. */
  damperActualPct?: number;
  /** Does the damper stroke freely by hand with the actuator released? */
  damperFree?: boolean;
  economizerController?: 'jade-w7220' | 'w7212' | 'oem' | 'none';
}

export interface Fault {
  /** Key into the fault rule registry in src/engine/rules.ts. */
  type: string;
  /** Component id from src/content/components. */
  componentId?: string;
  /** Per-unit designation, e.g. "K1". */
  designation?: string;
  role: 'root' | 'secondary';
  description: string;
}

export interface Choice {
  id: string;
  label: string;
  correct?: boolean;
  /** Root cause found but the fix only treats a symptom: partial credit + callback flag. */
  symptomOnly?: boolean;
  /** Parts cost charged to the truck budget if chosen, USD. Generic values unless sourced. */
  partsCost?: number;
  /** Replacing a part when the fix was a setting. */
  unneededPart?: boolean;
  feedback: string;
}

export interface Scenario {
  id: string;
  title: string;
  unitId: UnitId;
  difficulty: Difficulty;
  domains: Domain[];
  honeywell: boolean;
  /** Honeywell scenario-type tags from the spec (see docs/SCENARIO_SCHEMA.md). */
  honeywellTypes?: string[];
  dispatch: {
    complaint: string;
    customer: string;
    outdoorF: number;
    outdoorRH: number;
    timeOfDay: string;
    economizer: string;
    notes?: string;
  };
  state: ScenarioState;
  faults: Fault[];
  /** Name of a baseline in the unit file whose readings this scenario starts from. */
  baseline: string;
  /** Overrides on top of the baseline. */
  readings: Record<string, ReadingValue>;
  jade?: JadeSnapshot;
  controllerAlarms?: { code: Sourced<string>; text: string }[];
  hints: string[];
  diagnosis: Choice[];
  repair: Choice[];
  /** Ideal action ids in order, for the debrief. */
  idealPath: { action: string; why: string }[];
  debrief: string;
  /** Flashcard concept tags; missed ones feed the review queue. */
  concepts: string[];
}

export interface JadeSnapshot {
  /** Menu item key -> value shown on the LCD. Merged over the JADE menu defaults. */
  values: Record<string, string | number>;
  alarms: string[];
  sensorsDetected: string[];
}

export interface TestResult {
  id: string;
  label: string;
  setup: string;
  minutes: number;
  power: 'on' | 'off';
  readings: Record<string, ReadingValue>;
}

export interface LabCase {
  id: string;
  unitId: UnitId;
  designation: string;
  context: string;
  /** Label data on the part being tested. */
  rating: Record<string, string | number>;
  /** Ground truth. */
  condition: 'good' | 'bad' | 'marginal';
  failureMode?: string;
  tests: TestResult[];
  explanation: string;
}

export interface FailureMode {
  id: string;
  name: string;
  goodVsBad: string;
  symptoms: string;
}

export interface Component {
  id: string;
  name: string;
  /** Selects the Component Lab rule set in src/engine/rules.ts. */
  kind: 'contactor' | 'relay' | 'run-capacitor' | 'pressure-switch' | 'ntc-sensor' | 'actuator-2-10' | 'actuator-sylk';
  domain: Domain;
  function: string;
  perUnit: Partial<Record<UnitId, {
    availability: Sourced<Availability>;
    designation: Sourced<string>;
    location: Sourced<string>;
    sequenceRole: string;
    partNumber: Sourced<string>;
  }>>;
  failureModes: FailureMode[];
  test: {
    meter: string;
    procedure: string[];
    safety: string[];
  };
  /** Pass/fail thresholds. Each one is sourced or flagged. */
  thresholds: Record<string, Sourced<number | number[] | string>>;
  symptoms: { customer: string; tech: string };
  confusedWith: string[];
  labCases: LabCase[];
}
