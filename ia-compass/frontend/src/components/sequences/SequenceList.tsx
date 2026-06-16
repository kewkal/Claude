'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Plus, Play, Pause, ChevronRight, X } from 'lucide-react';

interface Sequence {
  id: string;
  name: string;
  triggerType: string;
  active: boolean;
  createdAt: string;
  _count: { steps: number; enrollments: number };
}

export default function SequenceList() {
  const router = useRouter();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [triggerType, setTriggerType] = useState('MANUAL');

  async function loadSequences() {
    const data = await api.sequences.list();
    setSequences(data);
    setLoading(false);
  }

  useEffect(() => { loadSequences(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.sequences.create({ name: newName, triggerType });
    setShowCreate(false);
    setNewName('');
    loadSequences();
  }

  const triggerBadge = (t: string) => {
    const colors: Record<string, string> = {
      MANUAL: 'bg-slate-700 text-slate-300',
      FORM_SUBMIT: 'bg-emerald-900/40 text-emerald-400',
      WEBHOOK: 'bg-blue-900/40 text-blue-400',
    };
    return colors[t] || 'bg-slate-700 text-slate-300';
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Sequence
        </button>
      </div>

      <div className="bg-card-dark rounded-xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-400">Loading...</p>
        ) : sequences.length === 0 ? (
          <p className="p-8 text-center text-slate-400">No sequences yet. Create your first one.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Trigger</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Steps</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Enrolled</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sequences.map(s => (
                <tr key={s.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30 cursor-pointer" onClick={() => router.push(`/sequences/${s.id}`)}>
                  <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${triggerBadge(s.triggerType)}`}>{s.triggerType}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1 text-xs ${s.active ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {s.active ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      {s.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{s._count.steps}</td>
                  <td className="px-4 py-3 text-slate-300">{s._count.enrollments}</td>
                  <td className="px-4 py-3 text-slate-400"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-80 border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">New Sequence</h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="Welcome Sequence" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Trigger</label>
                <select value={triggerType} onChange={e => setTriggerType(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                  <option value="MANUAL">Manual</option>
                  <option value="FORM_SUBMIT">Form Submit</option>
                  <option value="WEBHOOK">Webhook</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 bg-slate-700 text-white py-2 rounded-lg text-sm">Cancel</button>
                <button type="submit" className="flex-1 bg-sky-500 hover:bg-sky-600 text-white py-2 rounded-lg text-sm font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
