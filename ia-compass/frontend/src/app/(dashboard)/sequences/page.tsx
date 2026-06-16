'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Mail, MessageSquare, Users } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function SequencesPage() {
  const router = useRouter();
  const user = getUser();
  const [sequences, setSequences] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', triggerType: 'MANUAL' });

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => { setAccounts(r.data); if (r.data.length) setAccountId(r.data[0].id); });
    }
  }, []);

  const params = user?.role === 'AGENCY_ADMIN' ? { accountId } : {};

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN' && !accountId) return;
    api.get('/sequences', { params }).then((r) => setSequences(r.data));
  }, [accountId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/sequences', { ...form, accountId: accountId || undefined });
    setSequences((s) => [data, ...s]);
    setShowForm(false);
    setForm({ name: '', triggerType: 'MANUAL' });
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Sequences</h1>
        <div className="flex gap-3">
          {user?.role === 'AGENCY_ADMIN' && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-sm">
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> New Sequence
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sequences.length === 0 && (
          <div className="col-span-3 bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            No sequences yet. Create your first one!
          </div>
        )}
        {sequences.map((s: any) => (
          <button key={s.id} onClick={() => router.push(`/sequences/${s.id}`)}
            className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-sky-300 hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Mail className="w-5 h-5 text-blue-700" />
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${s.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {s.active ? 'Active' : 'Paused'}
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 mb-1">{s.name}</h3>
            <p className="text-xs text-slate-400 mb-3">Trigger: {s.triggerType}</p>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{s._count?.steps || 0} steps</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s._count?.enrollments || 0} enrolled</span>
            </div>
          </button>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">New Sequence</h2>
            <form onSubmit={create} className="space-y-3">
              <input placeholder="Sequence Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
              <select value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400">
                <option value="MANUAL">Manual Enrollment</option>
                <option value="FORM_SUBMIT">Form Submission</option>
                <option value="WEBHOOK">Webhook</option>
              </select>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
