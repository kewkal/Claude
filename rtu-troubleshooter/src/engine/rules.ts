// Physical-consistency rules. Shared by `npm run validate` and the app.
// Every scenario's merged readings must pass the generic checks plus the rules for each declared fault.

import type { Component, LabCase, ReadingValue, Scenario, ScenarioState } from './types';
import { bubbleTempF, dewTempF, subcool, superheat } from './pt';
import { tempAt } from './ntc';

export type Readings = Record<string, ReadingValue>;

export interface UnitData {
  id: string;
  hpsCutoutPsig: { value: number };
  lpsCutoutPsig: { value: number };
  lpsCutinPsig: { value: number };
  ratings?: Record<string, { value: number }>;
  baselines: Record<string, { readings: Readings }>;
}

export const num = (r: Readings, k: string): number | undefined => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
export const isOL = (r: Readings, k: string) => r[k] === 'OL';

const RUNNING: ScenarioState['compressor1'][] = ['running', 'short-cycling'];
const STOPPED: ScenarioState['compressor1'][] = ['off', 'tripped', 'locked-out'];

/** Rule-of-thumb tolerances used by the generic checks. Listed in UNVERIFIED.md via RULES_OF_THUMB. */
export const RULES_OF_THUMB = {
  maxVoltageImbalancePct: { value: 2, note: 'Trane RT-SVX37B-EN p.28: 2.0% max allowable supply imbalance (verified for the Trane unit; Lennox value pending its manual).' },
  goodContactDropV: { value: 0.5, note: 'Closed contacts under load should drop well under 1 V.' },
  mixedAirTolF: { value: 3, note: 'Mixing-equation tolerance; assumes OA fraction ≈ damper position (linear damper, a simplification).' },
  actuatorTrackPct: { value: 7, note: '2-10 Vdc maps linearly to 0-100 % stroke (2 V = closed, 10 V = open).' },
  sensorTrackF: { value: 2, note: 'NTC sensor should read within ±2°F of a reference thermometer.' },
  lowChargeSuperheatF: { value: 15, note: 'TXV system: superheat ≥15°F with low subcooling points to undercharge.' },
  lowChargeSubcoolF: { value: 5, note: 'Subcooling ≤5°F on a TXV system indicates short charge.' },
  highHeadApproachF: { value: 30, note: 'Condensing temp more than ~30°F over OA indicates a condenser heat-rejection problem.' },
  coolingDeltaTMinF: { value: 8, note: 'Running compressor should drop air temperature at least 8°F across the coil.' },
} as const;

// ---------- Generic physics checks ----------

export function genericChecks(r: Readings, s: ScenarioState, faultTypes: Set<string>, unit: UnitData): string[] {
  const e: string[] = [];
  const has = (...k: string[]) => k.every((x) => r[x] !== undefined);

  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'number') continue;
    if ((k.startsWith('ohm_') || k.startsWith('a_') || k.startsWith('uf_') || k.startsWith('meg_')) && v < 0) e.push(`${k} is negative`);
    if (k === 'vdc_act_cmd' && (v < 0 || v > 10.5)) e.push(`vdc_act_cmd ${v} outside 0-10 Vdc`);
    if (k.startsWith('pct_') && (v < 0 || v > 100)) e.push(`${k} ${v} outside 0-100 %`);
  }

  const comp = s.compressor1;
  const running = RUNNING.includes(comp);

  // Refrigeration: superheat / subcooling can't be negative on a running system.
  if (running && has('p_suction1', 't_suction1', 'p_liquid1', 't_liquid1')) {
    const sh = superheat(num(r, 'p_suction1')!, num(r, 't_suction1')!);
    const sc = subcool(num(r, 'p_liquid1')!, num(r, 't_liquid1')!);
    if (sh < -1) e.push(`superheat ${sh.toFixed(1)}°F is negative`);
    if (sc < -1) e.push(`subcooling ${sc.toFixed(1)}°F is negative`);
    const evap = dewTempF(num(r, 'p_suction1')!);
    const cond = bubbleTempF(num(r, 'p_liquid1')!);
    const entering = num(r, 't_mat') ?? num(r, 't_rat');
    if (entering !== undefined && s.blower === 'running' && evap > entering - 10)
      e.push(`evap saturation ${evap.toFixed(1)}°F is not at least 10°F below entering air ${entering}°F`);
    const oat = num(r, 't_oat');
    if (oat !== undefined && cond < oat + 5) e.push(`condensing ${cond.toFixed(1)}°F is not above OA ${oat}°F`);
  }
  if (has('p_suction1', 'p_liquid1') && num(r, 'p_suction1')! > num(r, 'p_liquid1')!) e.push('suction pressure above liquid pressure');

  // Air side delta-T.
  if (has('t_mat', 't_sat') && s.blower === 'running') {
    const dt = num(r, 't_mat')! - num(r, 't_sat')!;
    if (running && !faultTypes.has('frozen-coil') && dt < RULES_OF_THUMB.coolingDeltaTMinF.value)
      e.push(`compressor running but coil delta-T only ${dt.toFixed(1)}°F`);
    if (STOPPED.includes(comp) && Math.abs(dt) > 3) e.push(`compressor stopped but coil delta-T is ${dt.toFixed(1)}°F (expect ≈0-2°F fan heat)`);
  }

  // Mixing equation.
  const p = num(r, 'pct_damper_actual');
  if (p !== undefined && has('t_oat', 't_rat', 't_mat') && s.blower === 'running' && !faultTypes.has('mat-sensor-misplaced')) {
    const expect = (p / 100) * num(r, 't_oat')! + (1 - p / 100) * num(r, 't_rat')!;
    if (Math.abs(expect - num(r, 't_mat')!) > RULES_OF_THUMB.mixedAirTolF.value)
      e.push(`MAT ${num(r, 't_mat')}°F doesn't fit mixing at ${p}% OA (expect ≈${expect.toFixed(1)}°F)`);
  }
  if (s.damperActualPct !== undefined && p !== undefined && Math.abs(s.damperActualPct - p) > 2)
    e.push(`state.damperActualPct ${s.damperActualPct} ≠ pct_damper_actual ${p}`);

  // Line voltage imbalance.
  if (has('v_l1_l2', 'v_l2_l3', 'v_l1_l3') && !faultTypes.has('voltage-imbalance') && !faultTypes.has('phase-loss')) {
    const v = [num(r, 'v_l1_l2')!, num(r, 'v_l2_l3')!, num(r, 'v_l1_l3')!];
    const avg = v.reduce((a, b) => a + b) / 3;
    const imb = (Math.max(...v.map((x) => Math.abs(x - avg))) / avg) * 100;
    if (imb > RULES_OF_THUMB.maxVoltageImbalancePct.value) e.push(`line imbalance ${imb.toFixed(1)}% with no supply fault declared`);
  }

  // Compressor amps vs state.
  const amps = ['a_comp1_l1', 'a_comp1_l2', 'a_comp1_l3'].map((k) => num(r, k));
  if (amps.every((a) => a !== undefined)) {
    const a = amps as number[];
    if (STOPPED.includes(comp) && a.some((x) => x > 0.2)) e.push(`compressor ${comp} but drawing ${a.join('/')} A`);
    if (comp === 'running' && !faultTypes.has('single-phasing')) {
      if (a.some((x) => x <= 0.2)) e.push('compressor running but a leg reads 0 A');
      const avg = a.reduce((x, y) => x + y) / 3;
      if (Math.max(...a.map((x) => Math.abs(x - avg))) / avg > 0.1) e.push('compressor running with >10% current imbalance and no fault declared');
    }
  }

  // Contactor logic.
  const coilV = num(r, 'v_cc1_coil');
  if (running && coilV !== undefined && coilV < 20) e.push('compressor running with no 24V at its contactor coil');
  if (running && isOL(r, 'ohm_cc1_coil')) e.push('compressor running with an open contactor coil');
  if (coilV !== undefined && coilV >= 20 && isOL(r, 'ohm_cc1_coil') && running) e.push('open coil cannot pull in contactor');
  if (!faultTypes.has('contactor-pole-open') && coilV !== undefined && coilV >= 20 && !isOL(r, 'ohm_cc1_coil')) {
    for (const k of ['v_cc1_drop_p1', 'v_cc1_drop_p2', 'v_cc1_drop_p3'])
      if ((num(r, k) ?? 0) > RULES_OF_THUMB.goodContactDropV.value) e.push(`${k} high with no contactor fault declared`);
  }

  // Condenser fan + capacitor.
  const capRated = unit.ratings?.cfm1CapUf?.value;
  const cap = num(r, 'uf_cfm1_cap');
  if (s.condFan1 === 'running' && (num(r, 'a_cfm1') ?? 1) <= 0.1) e.push('condenser fan running at 0 A');
  if (s.condFan1 === 'off' && (num(r, 'a_cfm1') ?? 0) > 0.1) e.push('condenser fan off but drawing current');
  if (!faultTypes.has('run-capacitor-failed') && capRated && cap !== undefined && Math.abs(cap - capRated) / capRated > 0.1)
    e.push(`cap reads ${cap} µF vs ${capRated} µF rated with no capacitor fault declared`);

  // Actuator tracking.
  const pwr = num(r, 'vac_act_power');
  const cmd = num(r, 'vdc_act_cmd');
  const mech = faultTypes.has('actuator-failed') || faultTypes.has('damper-binding') || faultTypes.has('linkage-broken');
  if (!mech && p !== undefined && cmd !== undefined && pwr !== undefined && pwr >= 19 && cmd >= 2) {
    const expect = ((cmd - 2) / 8) * 100;
    if (Math.abs(expect - p) > RULES_OF_THUMB.actuatorTrackPct.value) e.push(`damper at ${p}% but ${cmd} Vdc commands ${expect.toFixed(0)}%`);
  }
  if (pwr !== undefined && pwr < 19 && p !== undefined && p > 0 && !mech) e.push('actuator unpowered but damper reported open (spring-return should close)');

  // Mixed air sensor vs reference.
  const matOhm = num(r, 'ohm_mat_sensor');
  if (!faultTypes.has('mat-sensor-failed') && !faultTypes.has('mat-sensor-misplaced') && matOhm !== undefined && has('t_mat')) {
    const implied = tempAt(matOhm);
    if (Math.abs(implied - num(r, 't_mat')!) > RULES_OF_THUMB.sensorTrackF.value)
      e.push(`MAT sensor ${matOhm} Ω implies ${implied.toFixed(1)}°F vs probe ${num(r, 't_mat')}°F`);
  }

  // LPS state.
  const lpsV = num(r, 'v_lps1');
  if (running && lpsV !== undefined && lpsV > 2) e.push('compressor running with 24V across an open LPS');
  if (running && isOL(r, 'ohm_lps1')) e.push('compressor running with LPS reading open');

  // HPS: a running compressor above cutout is impossible.
  const liq = num(r, 'p_liquid1');
  if (running && liq !== undefined && liq > unit.hpsCutoutPsig.value) e.push(`liquid ${liq} psig above HPS cutout ${unit.hpsCutoutPsig.value} while running`);

  return e;
}

// ---------- Fault-specific rules ----------

type FaultCheck = (r: Readings, s: ScenarioState, unit: UnitData, sc: Scenario) => string[];
const need = (cond: boolean, msg: string) => (cond ? [] : [msg]);
const baseAmpAvg = (unit: UnitData) => {
  const b = Object.values(unit.baselines)[0].readings;
  return ((b.a_comp1_l1 as number) + (b.a_comp1_l2 as number) + (b.a_comp1_l3 as number)) / 3;
};

export const FAULT_RULES: Record<string, { label: string; check: FaultCheck }> = {
  'contactor-coil-open': {
    label: 'Contactor coil open',
    check: (r, s) => [
      ...need(isOL(r, 'ohm_cc1_coil'), 'open coil must read OL'),
      ...need((num(r, 'v_cc1_coil') ?? 0) >= 20, 'open coil fault needs 24V present at coil terminals'),
      ...need(!RUNNING.includes(s.compressor1), 'compressor cannot run with an open contactor coil'),
      ...need(['a_comp1_l1', 'a_comp1_l2', 'a_comp1_l3'].every((k) => (num(r, k) ?? 0) <= 0.2), 'compressor amps must be 0'),
    ],
  },
  'contactor-pole-open': {
    label: 'Burned/pitted contactor pole (open under load)',
    check: (r) => {
      const d = ['v_cc1_drop_p1', 'v_cc1_drop_p2', 'v_cc1_drop_p3'].map((k) => num(r, k) ?? 0);
      return [
        ...need(d.filter((x) => x > 10).length === 1, 'exactly one pole should show a large drop (>10 V) when energized'),
        ...need(d.filter((x) => x <= 1).length === 2, 'the other two poles should drop ≤1 V'),
      ];
    },
  },
  'single-phasing': {
    label: 'Single-phasing at compressor',
    check: (r, s, unit) => {
      const a = ['a_comp1_l1', 'a_comp1_l2', 'a_comp1_l3'].map((k) => num(r, k));
      if (a.some((x) => x === undefined)) return ['single-phasing scenario must include all three compressor amp legs'];
      if (STOPPED.includes(s.compressor1)) return [];
      const zero = (a as number[]).filter((x) => x <= 0.2).length;
      const high = (a as number[]).filter((x) => x > 1.5 * baseAmpAvg(unit)).length;
      return [...need(zero === 1 && high === 2, 'single-phased motor: one leg 0 A, two legs well above RLA')];
    },
  },
  'compressor-overload-trip': {
    label: 'Compressor internal overload open',
    check: (r, s) => {
      const w = ['ohm_comp1_t1t2', 'ohm_comp1_t2t3', 'ohm_comp1_t1t3'];
      const hot = (num(r, 't_comp1_shell') ?? 0) >= 180;
      return [
        ...need(['tripped', 'humming', 'short-cycling'].includes(s.compressor1), 'overload trip: compressor should be tripped/humming/cycling'),
        ...need(hot, 'internal overload trip needs a hot shell (≥180°F)'),
        ...need(w.every((k) => isOL(r, k)) || w.every((k) => !isOL(r, k)), 'internal line-break: windings read all OL (open) or all balanced'),
        ...need((num(r, 'meg_comp1_gnd') ?? 999) >= 100, 'overload trip alone should not show a grounded winding'),
      ];
    },
  },
  'run-capacitor-failed': {
    label: 'Condenser fan run capacitor failed',
    check: (r, s, unit) => {
      const rated = unit.ratings?.cfm1CapUf?.value ?? 0;
      const cap = r.uf_cfm1_cap;
      const errs = [
        ...need(cap === 'OL' || (typeof cap === 'number' && cap < rated * 0.9), 'failed cap must read well below rating (or OL/open)'),
        ...need(['off', 'humming'].includes(s.condFan1), 'fan should be off or humming with a dead cap'),
      ];
      if (s.condFan1 === 'humming') errs.push(...need((num(r, 'a_cfm1') ?? 0) > 0.1, 'humming fan draws current'));
      if (RUNNING.includes(s.compressor1) && num(r, 'p_liquid1') !== undefined && num(r, 't_oat') !== undefined) {
        const approach = bubbleTempF(num(r, 'p_liquid1')!) - num(r, 't_oat')!;
        errs.push(...need(approach >= RULES_OF_THUMB.highHeadApproachF.value, `dead condenser fan should drive head up (approach ${approach.toFixed(0)}°F)`));
      }
      return errs;
    },
  },
  'hps-trip': {
    label: 'High-pressure switch tripped',
    check: (_r, s, _u, sc) => [
      ...need(['tripped', 'locked-out', 'short-cycling'].includes(s.compressor1), 'HPS trip: compressor tripped, locked out, or cycling'),
      ...need((sc.controllerAlarms?.length ?? 0) > 0 || (sc.jade?.alarms.length ?? 0) > 0 || 'txt_controller' in sc.readings, 'HPS trip should surface at the controller'),
    ],
  },
  'low-charge': {
    label: 'Refrigerant undercharge',
    check: (r, s) => {
      if (!RUNNING.includes(s.compressor1)) return ['low-charge scenario needs the compressor running to show its readings'];
      const sh = superheat(num(r, 'p_suction1')!, num(r, 't_suction1')!);
      const scool = subcool(num(r, 'p_liquid1')!, num(r, 't_liquid1')!);
      const evap = dewTempF(num(r, 'p_suction1')!);
      return [
        ...need(sh >= RULES_OF_THUMB.lowChargeSuperheatF.value, `low charge needs high superheat (got ${sh.toFixed(1)}°F)`),
        ...need(scool <= RULES_OF_THUMB.lowChargeSubcoolF.value, `low charge needs low subcooling (got ${scool.toFixed(1)}°F)`),
        ...need(evap <= 38, `low charge needs low suction saturation (got ${evap.toFixed(1)}°F)`),
      ];
    },
  },
  'lps-trip': {
    label: 'Low-pressure switch trip',
    check: (_r, s) => need(['short-cycling', 'tripped', 'locked-out'].includes(s.compressor1), 'LPS trip: compressor cycling or locked out'),
  },
  'actuator-failed': {
    label: 'Economizer actuator failed (no movement on valid signal)',
    check: (r, s) => {
      const cmd = num(r, 'vdc_act_cmd') ?? 0;
      const p = num(r, 'pct_damper_actual') ?? 0;
      return [
        ...need((num(r, 'vac_act_power') ?? 0) >= 19, 'actuator fault requires good 24 VAC power at the actuator'),
        ...need(cmd >= 2.5, 'actuator fault requires a real command signal (>2.5 Vdc)'),
        ...need(Math.abs(((cmd - 2) / 8) * 100 - p) > 15, 'damper must NOT match the command'),
        ...need(s.damperFree === true, 'actuator fault requires the damper to stroke freely by hand (else it is binding)'),
      ];
    },
  },
  'damper-binding': {
    label: 'Damper/linkage mechanically bound',
    check: (r, s) => [
      ...need((num(r, 'vac_act_power') ?? 0) >= 19 && (num(r, 'vdc_act_cmd') ?? 0) >= 2.5, 'binding fault: power and signal are good'),
      ...need(s.damperFree === false, 'binding fault requires the damper to NOT stroke freely by hand'),
    ],
  },
  'linkage-broken': {
    label: 'Linkage/coupling slipped — actuator moves, blades don\'t',
    check: (r, s, _u, sc) => {
      const cmd = num(r, 'vdc_act_cmd') ?? 0;
      const p = num(r, 'pct_damper_actual') ?? 0;
      return [
        ...need(cmd >= 2.5 && Math.abs(((cmd - 2) / 8) * 100 - p) > 15, 'blades must not match command'),
        ...need((sc.jade?.alarms.length ?? 0) === 0, 'non-feedback install: controller reports normal'),
        ...need(s.damperFree === true, 'blades themselves move freely'),
      ];
    },
  },
  'mat-sensor-failed': {
    label: 'Mixed air sensor failed',
    check: (r, _s, _u, sc) => {
      const v = r.ohm_mat_sensor;
      const errs = need(v === 'OL' || (typeof v === 'number' && v < 100) || (typeof v === 'number' && Math.abs(tempAt(v) - (num(r, 't_mat') ?? 0)) > 5),
        'failed sensor reads OL, near 0 Ω, or more than 5°F off chart');
      if (v === 'OL' || (typeof v === 'number' && v < 100)) errs.push(...need((sc.jade?.alarms.length ?? 0) > 0, 'open/shorted MAT sensor should raise a JADE alarm'));
      return errs;
    },
  },
};

export function validateScenario(sc: Scenario, unit: UnitData): string[] {
  const base = unit.baselines[sc.baseline];
  if (!base) return [`unknown baseline ${sc.baseline}`];
  const r: Readings = { ...base.readings, ...sc.readings };
  const types = new Set(sc.faults.map((f) => f.type));
  const errs = genericChecks(r, sc.state, types, unit);
  for (const f of sc.faults) {
    const rule = FAULT_RULES[f.type];
    if (!rule) errs.push(`no rule registered for fault type "${f.type}"`);
    else errs.push(...rule.check(r, sc.state, unit, sc));
  }
  if (!sc.faults.some((f) => f.role === 'root')) errs.push('no root-cause fault declared');
  if (sc.difficulty === 'advanced' && sc.faults.length < 2) errs.push('advanced scenarios need two faults (or a cause→effect chain)');
  if (!sc.diagnosis.some((c) => c.correct)) errs.push('no correct diagnosis choice');
  if (!sc.repair.some((c) => c.correct)) errs.push('no correct repair choice');
  return errs;
}

export function mergedReadings(sc: Scenario, unit: UnitData): Readings {
  return { ...unit.baselines[sc.baseline].readings, ...sc.readings };
}

// ---------- Component Lab rules ----------

type T = Component['thresholds'];
const th = (t: T, k: string) => t[k]?.value as number | number[];
const lab = (c: LabCase, key: string): ReadingValue | undefined => {
  for (const t of c.tests) if (key in t.readings) return t.readings[key];
  return undefined;
};
const n = (v: ReadingValue | undefined) => (typeof v === 'number' ? v : undefined);

/** Returns what the readings say the condition is. The validator compares this to the declared ground truth. */
export function judgeLab(comp: Component, c: LabCase): { condition: LabCase['condition']; mode?: string } | { error: string } {
  const t = comp.thresholds;
  switch (comp.kind) {
    case 'contactor': {
      const [lo, hi] = th(t, 'coilOhms') as number[];
      const coil = lab(c, 'coil_ohm');
      if (coil === 'OL') return { condition: 'bad', mode: 'coil-open' };
      if (n(coil) !== undefined && n(coil)! < lo) return { condition: 'bad', mode: 'coil-shorted' };
      if (n(coil) !== undefined && n(coil)! > hi) return { condition: 'bad', mode: 'coil-open' };
      const drops = ['drop_p1', 'drop_p2', 'drop_p3'].map((k) => n(lab(c, k))).filter((x): x is number => x !== undefined);
      const worst = Math.max(0, ...drops);
      if (worst > (th(t, 'contactDropBadV') as number)) return { condition: 'bad', mode: 'contacts-pitted' };
      if (worst > (th(t, 'contactDropGoodV') as number)) return { condition: 'marginal', mode: 'contacts-pitted' };
      return { condition: 'good' };
    }
    case 'relay': {
      const [lo, hi] = th(t, 'coilOhms') as number[];
      const coil = lab(c, 'coil_ohm');
      if (coil === 'OL' || (n(coil) ?? lo) > hi) return { condition: 'bad', mode: 'coil-open' };
      if ((n(coil) ?? lo) < lo) return { condition: 'bad', mode: 'coil-shorted' };
      const maxR = th(t, 'contactOhmsMax') as number;
      const noDe = lab(c, 'no_deenergized');
      const noEn = lab(c, 'no_energized');
      if (noDe !== 'OL') return { condition: 'bad', mode: 'contacts-welded' };
      if (noEn === 'OL') return { condition: 'bad', mode: 'contacts-burned-open' };
      if ((n(noEn) ?? 0) > maxR * 10) return { condition: 'bad', mode: 'contacts-high-resistance' };
      if ((n(noEn) ?? 0) > maxR) return { condition: 'marginal', mode: 'contacts-high-resistance' };
      return { condition: 'good' };
    }
    case 'run-capacitor': {
      const rated = Number(c.rating.uf);
      const tol = Number(c.rating.tolerancePct ?? th(t, 'tolerancePct'));
      const m = lab(c, 'uf');
      if (m === 'OL' || m === undefined) return { condition: 'bad', mode: 'open' };
      if (lab(c, 'shorted') === 'yes') return { condition: 'bad', mode: 'shorted' };
      const dev = (Math.abs(n(m)! - rated) / rated) * 100;
      if (lab(c, 'case') === 'bulged') return { condition: 'bad', mode: 'bulged-case' };
      if (dev <= tol) return { condition: 'good' };
      if (dev <= (th(t, 'marginalPct') as number)) return { condition: 'marginal', mode: 'weak' };
      return { condition: 'bad', mode: 'weak' };
    }
    case 'pressure-switch': {
      // Bench ramp test: where does the switch actually open and close vs its rating?
      const tol = th(t, 'setpointTolPsig') as number;
      const opened = lab(c, 'opened_at_psig');
      const closed = lab(c, 'closed_at_psig');
      if (opened === undefined && closed === undefined) return { error: 'pressure-switch case needs opened_at_psig and/or closed_at_psig' };
      if (closed === 'never') return { condition: 'bad', mode: 'stuck-open' };
      if (opened === 'never') return { condition: 'bad', mode: 'stuck-closed' };
      const offOpen = n(opened) !== undefined ? Math.abs(n(opened)! - Number(c.rating.opensPsig)) : 0;
      const offClose = n(closed) !== undefined ? Math.abs(n(closed)! - Number(c.rating.closesPsig)) : 0;
      if (offOpen > tol || offClose > tol) return { condition: 'bad', mode: 'out-of-calibration' };
      return { condition: 'good' };
    }
    case 'ntc-sensor': {
      const v = lab(c, 'ohm');
      const ref = n(lab(c, 'ref_temp_f'));
      if (ref === undefined) return { error: 'ntc case needs ref_temp_f' };
      if (v === 'OL') return { condition: 'bad', mode: 'open' };
      if ((n(v) ?? 0) < 100) return { condition: 'bad', mode: 'shorted' };
      const off = Math.abs(tempAt(n(v)!) - ref);
      if (off <= (th(t, 'goodTolF') as number)) return { condition: 'good' };
      if (off <= (th(t, 'marginalTolF') as number)) return { condition: 'marginal', mode: 'drifted' };
      return { condition: 'bad', mode: 'drifted' };
    }
    case 'actuator-2-10':
    case 'actuator-sylk': {
      const [vlo, vhi] = th(t, 'powerVac') as number[];
      const pwr = n(lab(c, 'vac'));
      if (pwr === undefined || pwr < vlo || pwr > vhi) return { error: 'actuator bench test must be run with valid 24 VAC power' };
      const sig = n(lab(c, 'vdc'));
      const pos = n(lab(c, 'shaft_pct'));
      if (sig === undefined || pos === undefined) return { error: 'actuator case needs vdc and shaft_pct' };
      const expect = Math.max(0, Math.min(100, ((sig - 2) / 8) * 100));
      const off = Math.abs(expect - pos);
      const stroke = n(lab(c, 'stroke_s'));
      if (off > 25) return { condition: 'bad', mode: lab(c, 'motor_sound') === 'hum' ? 'stalled-gear-train' : 'no-response' };
      if (off > (th(t, 'trackTolPct') as number)) return { condition: 'marginal', mode: 'poor-tracking' };
      if (stroke !== undefined && stroke > (th(t, 'strokeSecondsMax') as number)) return { condition: 'marginal', mode: 'slow-stroke' };
      return { condition: 'good' };
    }
  }
}

export function validateLabCase(comp: Component, c: LabCase): string[] {
  const j = judgeLab(comp, c);
  if ('error' in j) return [j.error];
  const e: string[] = [];
  if (j.condition !== c.condition) e.push(`readings say ${j.condition}${j.mode ? ` (${j.mode})` : ''} but case declares ${c.condition}`);
  else if (c.condition !== 'good' && c.failureMode && j.mode !== c.failureMode) e.push(`readings point to ${j.mode} but case declares ${c.failureMode}`);
  if (c.condition !== 'good' && !comp.failureModes.some((f) => f.id === c.failureMode)) e.push(`failureMode "${c.failureMode}" not in component failureModes`);
  for (const t of c.tests) {
    if (t.power === 'on' && Object.keys(t.readings).some((k) => k.endsWith('ohm') || k === 'uf') && !t.setup.toLowerCase().includes('in-circuit'))
      e.push(`test ${t.id}: resistance/capacitance taken with power on`);
  }
  return e;
}
