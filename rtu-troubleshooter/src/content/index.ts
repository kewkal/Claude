// Content is discovered by folder, so new JSON files show up without code changes.
import type { ActionDef, Component, ReadingDef, Scenario, Sourced, UnitId } from '../engine/types';
import type { UnitData } from '../engine/rules';
import readingsCatalog from './catalog/readings.json';
import actionsCatalog from './catalog/actions.json';
import jadeMenuJson from './honeywell/jade-menu.json';

const values = <T>(mods: Record<string, unknown>) => Object.values(mods).map((m) => (m as { default: T }).default);

export interface Unit extends UnitData {
  id: UnitId;
  shortName: string;
  model: Sourced<string>;
  refrigerant: Sourced<string>;
  voltage: Sourced<string>;
  controller: Sourced<string>;
  nominalTons: Sourced<number>;
  designations: Record<string, Sourced<string>>;
  sequenceOfOperation: Sourced<string[]>;
  [k: string]: unknown;
}

export interface JadeItem {
  key: string;
  type: 'status' | 'number' | 'enum' | 'action';
  default?: string | number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  help?: string;
}
export interface JadeMenu { id: string; label: string; items: JadeItem[] }

export interface CommissioningJob {
  id: string;
  title: string;
  unitId: UnitId;
  climate: string;
  spec: string[];
  strategy: string;
  targets: Record<string, { value: number | string; tol?: number }>;
  checkout: string[];
  parSeconds: number;
  consequences: Record<string, string>;
  verified: boolean;
  note?: string;
}

export const units = values<Unit>(import.meta.glob('./units/*.json', { eager: true }));
export const unitById = Object.fromEntries(units.map((u) => [u.id, u])) as Record<UnitId, Unit>;
export const components = values<Component>(import.meta.glob('./components/*.json', { eager: true }));
export const componentById = Object.fromEntries(components.map((c) => [c.id, c]));
const order = { beginner: 0, medium: 1, advanced: 2, master: 3 };
export const scenarios = values<Scenario>(import.meta.glob('./scenarios/*.json', { eager: true })).sort(
  (a, b) => order[a.difficulty] - order[b.difficulty] || a.title.localeCompare(b.title),
);
export const jobs = values<CommissioningJob>(import.meta.glob('./commissioning/*.json', { eager: true }));
export const readingDefs = readingsCatalog as Record<string, ReadingDef>;
export const actionDefs = actionsCatalog as ActionDef[];
export const actionById = Object.fromEntries(actionDefs.map((a) => [a.id, a]));
export const jadeMenu = jadeMenuJson as unknown as {
  note: string;
  minPosNote: string;
  menus: JadeMenu[];
  alarmCatalog: Record<string, string>;
  strategyBySensors: Record<string, string[] | string>;
};
