// npm run validate              → check every scenario, lab case, and job; fail on any contradiction
// npm run unverified            → same, and rewrite docs/UNVERIFIED.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_OF_THUMB, validateLabCase, validateScenario, type UnitData } from '../src/engine/rules';
import type { ActionDef, Component, Scenario } from '../src/engine/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = path.join(root, 'src/content');
const write = process.argv.includes('--write-unverified');
const strict = process.argv.includes('--strict');

const readDir = <T>(dir: string) =>
  fs.readdirSync(path.join(content, dir)).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: `src/content/${dir}/${f}`, data: JSON.parse(fs.readFileSync(path.join(content, dir, f), 'utf8')) as T }));
const readJson = <T>(rel: string) => JSON.parse(fs.readFileSync(path.join(content, rel), 'utf8')) as T;

const errors: string[] = [];
const warnings: string[] = [];
const err = (file: string, msg: string) => errors.push(`${file}: ${msg}`);

const units = readDir<UnitData & { id: string }>('units');
const unitById = Object.fromEntries(units.map((u) => [u.data.id, u.data]));
const components = readDir<Component>('components');
const compById = Object.fromEntries(components.map((c) => [c.data.id, c.data]));
const scenarios = readDir<Scenario>('scenarios');
const jobs = readDir<{ id: string; unitId: string; strategy: string; targets: Record<string, { value: number | string; tol?: number }>; checkout: string[] }>('commissioning');
const readingsCat = readJson<Record<string, unknown>>('catalog/readings.json');
const actions = readJson<ActionDef[]>('catalog/actions.json');
const actionIds = new Set(actions.map((a) => a.id));
const jade = readJson<{ menus: { id: string; items: { key: string; type: string; min?: number; max?: number; options?: string[] }[] }[]; alarmCatalog: Record<string, string>; strategyBySensors: Record<string, unknown> }>('honeywell/jade-menu.json');
const jadeItems = Object.fromEntries(jade.menus.flatMap((m) => m.items.map((i) => [i.key, i])));

// ---- Catalog integrity
for (const a of actions) for (const r of a.readings) if (!(r in readingsCat)) err('catalog/actions.json', `action ${a.id} references unknown reading ${r}`);

// ---- Units
for (const u of units) for (const [name, b] of Object.entries(u.data.baselines))
  for (const k of Object.keys(b.readings)) if (!(k in readingsCat)) err(u.file, `baseline ${name} has unknown reading key ${k}`);

// ---- Scenarios
const ids = new Set<string>();
for (const { file, data: sc } of scenarios) {
  if (ids.has(sc.id)) err(file, `duplicate scenario id ${sc.id}`);
  ids.add(sc.id);
  const unit = unitById[sc.unitId];
  if (!unit) { err(file, `unknown unitId ${sc.unitId}`); continue; }
  for (const k of Object.keys(sc.readings)) if (!(k in readingsCat)) err(file, `unknown reading key ${k}`);
  for (const p of sc.idealPath) if (!actionIds.has(p.action)) err(file, `idealPath action ${p.action} not in catalog`);
  for (const f of sc.faults) if (f.componentId && !compById[f.componentId]) err(file, `fault references unknown component ${f.componentId}`);
  if (sc.honeywell && !sc.jade) err(file, 'Honeywell scenario needs a jade snapshot');
  if (sc.jade) {
    for (const k of Object.keys(sc.jade.values)) if (!jadeItems[k]) err(file, `jade value ${k} is not a JADE menu item`);
    for (const a of sc.jade.alarms) if (!jade.alarmCatalog[a]) err(file, `jade alarm ${a} not in alarmCatalog`);
    const dout = sc.jade.values['DAMPER OUT'];
    const merged = { ...unit.baselines[sc.baseline]?.readings, ...sc.readings };
    if (typeof dout === 'number' && typeof merged.vdc_act_cmd === 'number' && Math.abs(dout - merged.vdc_act_cmd) > 0.2)
      err(file, `JADE DAMPER OUT ${dout} V ≠ measured ${merged.vdc_act_cmd} Vdc at actuator (no wiring fault declared)`);
    const ma = sc.jade.values['MA TEMP'];
    if (typeof ma === 'number' && typeof merged.t_mat === 'number' && Math.abs(ma - merged.t_mat) > 2 && !sc.faults.some((f) => f.type.startsWith('mat-sensor')))
      err(file, `JADE MA TEMP ${ma} vs probe ${merged.t_mat} with no MAT sensor fault`);
  }
  for (const e of validateScenario(sc, unit)) err(file, e);
}

// ---- Components + lab cases
for (const { file, data: c } of components) {
  for (const unitId of Object.keys(c.perUnit)) {
    if (!unitById[unitId]) err(file, `perUnit has unknown unit ${unitId}`);
    if (!c.labCases.some((l) => l.unitId === unitId)) err(file, `no Component Lab case for ${unitId}`);
  }
  if (!c.test?.procedure?.length) err(file, 'missing test procedure');
  for (const l of c.labCases) for (const e of validateLabCase(c, l)) err(file, `lab ${l.id}: ${e}`);
  const used = scenarios.some((s) => s.data.faults.some((f) => f.componentId === c.id));
  if (!used) (strict ? errors : warnings).push(`${file}: component not used as a fault in any scenario yet`);
}

// ---- Commissioning jobs
const strategies = Object.keys(jade.strategyBySensors).filter((k) => k !== 'note');
for (const { file, data: j } of jobs) {
  if (!unitById[j.unitId]) err(file, `unknown unit ${j.unitId}`);
  if (!strategies.includes(j.strategy)) err(file, `unknown strategy ${j.strategy}`);
  for (const [k, t] of Object.entries(j.targets)) {
    const item = jadeItems[k];
    if (!item) { err(file, `target ${k} not a JADE menu item`); continue; }
    if (typeof t.value === 'number' && (t.value < (item.min ?? -Infinity) || t.value > (item.max ?? Infinity))) err(file, `target ${k}=${t.value} outside menu range`);
    if (typeof t.value === 'string' && item.options && !item.options.includes(t.value)) err(file, `target ${k}=${t.value} not a menu option`);
  }
  for (const c of j.checkout) if (!jadeItems[c]) err(file, `checkout item ${c} not in CHECKOUT menu`);
}

// ---- Mutation self-test: the rules must catch known contradictions, or the validator is lying.
const mutations: { scenario: string; why: string; patch: (s: Scenario) => void }[] = [
  { scenario: 'tr-beg-low-charge', why: 'undercharge with high subcooling', patch: (s) => { s.readings.t_liquid1 = 80; } },
  { scenario: 'tr-beg-low-charge', why: 'undercharge with normal superheat', patch: (s) => { s.readings.t_suction1 = 14; } },
  { scenario: 'lx-beg-contactor-coil', why: 'open coil reading 13 ohms', patch: (s) => { s.readings.ohm_cc1_coil = 13; } },
  { scenario: 'lx-beg-contactor-coil', why: 'open coil with no 24V at coil', patch: (s) => { s.readings.v_cc1_coil = 0; } },
  { scenario: 'lx-beg-contactor-coil', why: 'compressor drawing amps with open coil', patch: (s) => { s.readings.a_comp1_l1 = 13; } },
  { scenario: 'tr-med-jade-actuator', why: 'actuator blamed but damper binds', patch: (s) => { s.state.damperFree = false; } },
  { scenario: 'tr-med-jade-actuator', why: 'actuator blamed but no 24V', patch: (s) => { s.readings.vac_act_power = 0; } },
  { scenario: 'tr-med-jade-actuator', why: 'MAT violates mixing equation', patch: (s) => { s.readings.t_mat = 84; } },
  { scenario: 'tr-med-jade-actuator', why: 'JADE DAMPER OUT ≠ measured signal', patch: (s) => { s.jade!.values['DAMPER OUT'] = 8; } },
  { scenario: 'tr-med-fan-cap', why: 'dead cap fault with good cap', patch: (s) => { s.readings.uf_cfm1_cap = 5.0; } },
  { scenario: 'tr-med-fan-cap', why: 'dead condenser fan with normal head', patch: (s) => { s.readings.p_liquid1 = 405; s.readings.t_liquid1 = 106; } },
  { scenario: 'tr-med-fan-cap', why: 'running above HPS cutout', patch: (s) => { s.readings.p_liquid1 = 700; } },
  { scenario: 'lx-adv-pitted-contactor', why: 'single-phasing with balanced amps', patch: (s) => { s.readings.a_comp1_l1 = 68; } },
  { scenario: 'lx-adv-pitted-contactor', why: 'supply imbalance with no supply fault', patch: (s) => { s.readings.v_l1_l2 = 430; } },
  { scenario: 'lx-adv-pitted-contactor', why: 'overload trip with cool shell', patch: (s) => { s.readings.t_comp1_shell = 110; } },
  { scenario: 'lx-med-jade-mat-open', why: 'failed MAT sensor reading on-chart', patch: (s) => { s.readings.ohm_mat_sensor = 24445; } },
  { scenario: 'lx-med-jade-mat-open', why: 'negative superheat', patch: (s) => { s.readings.t_suction1 = 30; } },
];
for (const m of mutations) {
  const src = scenarios.find((s) => s.data.id === m.scenario);
  if (!src) { errors.push(`self-test: scenario ${m.scenario} missing`); continue; }
  const sc = JSON.parse(JSON.stringify(src.data)) as Scenario;
  m.patch(sc);
  const unit = unitById[sc.unitId];
  const merged = { ...unit.baselines[sc.baseline].readings, ...sc.readings };
  let caught = validateScenario(sc, unit).length > 0;
  const dout = sc.jade?.values['DAMPER OUT'];
  if (typeof dout === 'number' && typeof merged.vdc_act_cmd === 'number' && Math.abs(dout - merged.vdc_act_cmd) > 0.2) caught = true;
  if (!caught) errors.push(`self-test: validator MISSED "${m.why}" in ${m.scenario}`);
}
const labMutations: { comp: string; lab: string; why: string; patch: (l: Component['labCases'][number]) => void }[] = [
  { comp: 'run-capacitor', lab: 'cap-lx-good', why: 'cap 30% low declared good', patch: (l) => { l.tests[0].readings.uf = 3.5; } },
  { comp: 'contactor', lab: 'cont-lx-good', why: 'pitted pole declared good', patch: (l) => { l.tests[1].readings.drop_p2 = 5; } },
  { comp: 'c7250a', lab: 'c7250-lx-good', why: '10°F-off sensor declared good', patch: (l) => { l.tests[1].readings.ohm = 27079; } },
  { comp: 'relay', lab: 'rel-lx-good', why: 'welded NO declared good', patch: (l) => { l.tests[1].readings.no_deenergized = 0.1; } },
  { comp: 'low-pressure-switch', lab: 'lps-lx-good', why: 'switch opening 20 psi high declared good', patch: (l) => { l.tests[0].readings.opened_at_psig = 60; } },
  { comp: 'honeywell-actuator', lab: 'act-lx-good', why: 'non-tracking actuator declared good', patch: (l) => { l.tests[1].readings.shaft_pct = 0; } },
];
for (const m of labMutations) {
  const comp = compById[m.comp];
  const l = JSON.parse(JSON.stringify(comp.labCases.find((x) => x.id === m.lab)));
  m.patch(l);
  if (validateLabCase(comp, l).length === 0) errors.push(`self-test: validator MISSED "${m.why}" in ${m.lab}`);
}
console.log(`Self-test: ${mutations.length + labMutations.length} injected contradictions`);

// ---- Honeywell coverage report
const hwTypes = new Set(scenarios.flatMap((s) => s.data.honeywellTypes ?? []));

// ---- Sourced-value walk → UNVERIFIED.md
type Row = { file: string; path: string; value: string; basis: string; note: string };
const rows: Row[] = [];
const sourceErrors: string[] = [];
function walk(node: unknown, file: string, p: string) {
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, file, `${p}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (typeof o.verified === 'boolean') {
    if (o.verified && !o.source) sourceErrors.push(`${file}: ${p || '(root)'} is verified:true but has no source`);
    if (!o.verified) {
      const v = 'value' in o ? (Array.isArray(o.value) ? `[${(o.value as unknown[]).length > 4 ? `${(o.value as unknown[]).length} items` : (o.value as unknown[]).join(', ')}]` : String(o.value)) : '(whole file/section)';
      rows.push({ file, path: p || '(root)', value: v.replace(/\|/g, '/').slice(0, 80), basis: String(o.basis ?? ''), note: String(o.note ?? '').replace(/\|/g, '/') });
    }
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'value' || typeof v === 'object') walk(v, file, p ? `${p}.${k}` : k);
}
const allFiles = ['units', 'components', 'scenarios', 'commissioning', 'honeywell', 'pt'].flatMap((d) =>
  fs.readdirSync(path.join(content, d)).filter((f) => f.endsWith('.json')).sort().map((f) => `src/content/${d}/${f}`));
for (const f of allFiles) walk(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')), f, '');
for (const { file, data: sc } of scenarios) {
  const text = JSON.stringify(sc);
  if (text.includes('⚠')) rows.push({ file, path: '(text)', value: 'Inline ⚠ notes', basis: 'generic', note: 'Scenario text contains unverified controller codes/behavior flagged with ⚠.' });
}
errors.push(...sourceErrors);

const md = [
  '# Unverified values',
  '',
  'Generated by `npm run unverified`. Do not edit by hand; fix the JSON and regenerate. `npm run validate` fails if this file is stale.',
  '',
  'Everything here shows a **⚠ generic value** tag in the app. To verify: find it in the manuals in `/docs`, correct the value, set `"verified": true`, add `"source": "docs/<file> p.<page>"`, and rerun `npm run unverified`.',
  '',
  `**${rows.length} unverified entries.**`,
  '',
  '## Rule-of-thumb tolerances used by the validator (src/engine/rules.ts)',
  '',
  '| Rule | Value | Note |',
  '|---|---|---|',
  ...Object.entries(RULES_OF_THUMB).map(([k, v]) => `| ${k} | ${v.value} | ${v.note} |`),
  '',
  '## Content values',
  '',
  '| File | Path | Value | Basis | Note |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.file.replace('src/content/', '')} | ${r.path} | ${r.value} | ${r.basis} | ${r.note} |`),
  '',
].join('\n');

const mdPath = path.join(root, 'docs/UNVERIFIED.md');
if (write) fs.writeFileSync(mdPath, md);
else if (!fs.existsSync(mdPath) || fs.readFileSync(mdPath, 'utf8') !== md) errors.push('docs/UNVERIFIED.md is stale. Run `npm run unverified`.');

// ---- Report
console.log(`Scenarios: ${scenarios.length} | Components: ${components.length} | Lab cases: ${components.reduce((n, c) => n + c.data.labCases.length, 0)} | JADE jobs: ${jobs.length}`);
console.log(`Honeywell scenario types covered: ${[...hwTypes].join(', ') || 'none'}`);
console.log(`Unverified entries: ${rows.length}`);
for (const w of warnings) console.log(`WARN  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL  ${e}`);
  console.error(`\n${errors.length} contradiction(s). Build blocked.`);
  process.exit(1);
}
console.log('\nvalidate: 0 contradictions ✓');
