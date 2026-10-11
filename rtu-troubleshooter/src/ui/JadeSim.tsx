import { useState } from 'react';
import { jadeMenu, type JadeItem } from '../content';
import { SourceTag } from './Tags';

export type JadeValues = Record<string, string | number>;

interface Props {
  values: JadeValues;
  alarms: string[];
  editable?: boolean;
  visible?: (item: JadeItem) => boolean;
  onChange?: (key: string, value: string | number) => void;
  onAction?: (key: string) => string;
  onKey?: () => void;
}

const pad = (s: string, n = 16) => (s.length > n ? s.slice(0, n) : s.padEnd(n, ' '));

export function defaultJadeValues(): JadeValues {
  const v: JadeValues = {};
  for (const m of jadeMenu.menus) for (const i of m.items) if (i.default !== undefined) v[i.key] = i.default;
  return v;
}

export function JadeSim({ values, alarms, editable, visible = () => true, onChange, onAction, onKey }: Props) {
  const [level, setLevel] = useState<'menus' | 'items' | 'edit'>('menus');
  const [mi, setMi] = useState(0);
  const [ii, setIi] = useState(0);
  const [edit, setEdit] = useState<string | number>('');
  const [flash, setFlash] = useState<string | null>(null);

  const menus = jadeMenu.menus;
  const menu = menus[mi];
  const items: JadeItem[] =
    menu.id === 'ALARMS'
      ? alarms.length
        ? alarms.map((a) => ({ key: a, type: 'status' as const, help: jadeMenu.alarmCatalog[a] }))
        : [{ key: 'NO ALARMS', type: 'status' as const }]
      : menu.items.filter(visible);
  const item = items[Math.min(ii, items.length - 1)];

  const show = (v: string | number | undefined, i: JadeItem) => (v === undefined ? '--' : `${typeof v === 'number' && i.step && i.step < 1 ? v.toFixed(1) : v}${i.unit && v !== '--' && v !== '---' ? ` ${i.unit}` : ''}`);

  let line1 = '';
  let line2 = '';
  if (flash) {
    line1 = 'CHECKOUT';
    line2 = flash;
  } else if (level === 'menus') {
    line1 = `${menu.label}${menu.id === 'ALARMS' && alarms.length ? ` (${alarms.length})` : ''}`;
    line2 = '';
  } else if (level === 'items') {
    line1 = item.key;
    line2 = item.type === 'action' ? 'PRESS ENTER' : menu.id === 'ALARMS' ? '' : show(values[item.key], item);
  } else {
    line1 = `${item.key}*`;
    line2 = show(edit, item);
  }

  const press = (k: 'up' | 'down' | 'enter' | 'menu') => {
    onKey?.();
    if (flash) {
      setFlash(null);
      return;
    }
    if (level === 'menus') {
      if (k === 'up') setMi((mi - 1 + menus.length) % menus.length);
      if (k === 'down') setMi((mi + 1) % menus.length);
      if (k === 'enter') {
        setIi(0);
        setLevel('items');
      }
    } else if (level === 'items') {
      if (k === 'up') setIi((ii - 1 + items.length) % items.length);
      if (k === 'down') setIi((ii + 1) % items.length);
      if (k === 'menu') setLevel('menus');
      if (k === 'enter') {
        if (item.type === 'action' && onAction) setFlash(onAction(item.key));
        else if (editable && (item.type === 'number' || item.type === 'enum')) {
          setEdit(values[item.key] ?? item.default ?? '');
          setLevel('edit');
        }
      }
    } else {
      if (k === 'menu') setLevel('items');
      if (k === 'enter') {
        onChange?.(item.key, edit);
        setLevel('items');
      }
      if (k === 'up' || k === 'down') {
        const d = k === 'up' ? 1 : -1;
        if (item.type === 'number') {
          const step = item.step ?? 1;
          const nv = Math.round((Number(edit) + d * step) / step) * step;
          setEdit(Math.min(item.max ?? Infinity, Math.max(item.min ?? -Infinity, Number(nv.toFixed(2)))));
        } else if (item.options) {
          const i = item.options.indexOf(String(edit));
          setEdit(item.options[(i + d + item.options.length) % item.options.length]);
        }
      }
    }
  };

  const btn = 'flex h-14 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-100 shadow active:scale-95 active:bg-slate-600 select-none';
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-600 bg-gradient-to-b from-slate-700 to-slate-800 p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          <span>Economizer module · W7220-style</span>
          {alarms.length > 0 && <span className="animate-pulse text-rose-400">● ALARM</span>}
        </div>
        <div className="lcd rounded-md border-4 border-slate-900 bg-[#9fd46b] px-3 py-2 text-[17px] font-bold leading-6 text-[#1b2a10] shadow-inner">
          <div className="whitespace-pre">{pad(line1)}</div>
          <div className="whitespace-pre">{pad(line2)}</div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <button className={btn} onClick={() => press('menu')} aria-label="Menu / back">
            <span className="text-xs">MENU</span>
          </button>
          <button className={btn} onClick={() => press('up')} aria-label="Up">▲</button>
          <button className={btn} onClick={() => press('down')} aria-label="Down">▼</button>
          <button className={btn} onClick={() => press('enter')} aria-label="Enter">↵</button>
        </div>
      </div>
      <div className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
        {level !== 'menus' && item.help ? <p>{item.help}</p> : <p>▲▼ scroll · ↵ open/edit/save · MENU back.{editable ? '' : ' View only on service calls. Changes go through Repair.'}</p>}
        <div className="mt-1">
          <SourceTag s={{ verified: false, note: jadeMenu.note }} /> <span className="text-slate-500">Menu labels & defaults pending 63-2700 check</span>
        </div>
      </div>
    </div>
  );
}
