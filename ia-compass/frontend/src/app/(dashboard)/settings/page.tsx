'use client';
import { useEffect, useState } from 'react';
import { Plus, Copy, Check } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function SettingsPage() {
  const user = getUser();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState('');
  const [form, setForm] = useState({ name: '', clientName: '', clientEmail: '', clientPassword: '' });

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => setAccounts(r.data));
    }
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/accounts', form);
    setAccounts((a) => [...a, data]);
    setShowForm(false);
    setForm({ name: '', clientName: '', clientEmail: '', clientPassword: '' });
  };

  const copyWebhook = (accountId: string) => {
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/webhooks/${accountId}/contact`;
    navigator.clipboard.writeText(url);
    setCopied(accountId);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Settings</h1>

      {user?.role === 'AGENCY_ADMIN' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Client Accounts</h2>
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              <Plus className="w-4 h-4" /> Add Account
            </button>
          </div>

          <div className="space-y-3">
            {accounts.length === 0 && <p className="text-slate-400 text-sm">No accounts yet.</p>}
            {accounts.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-medium text-slate-800">{a.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">ID: {a.id}</p>
                </div>
                <button onClick={() => copyWebhook(a.id)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-white transition-colors">
                  {copied === a.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copied === a.id ? 'Copied!' : 'Webhook URL'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Your Profile</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-16">Name</span>
            <span className="text-slate-800 font-medium">{user?.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-16">Email</span>
            <span className="text-slate-800">{user?.email}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-16">Role</span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{user?.role}</span>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Add Client Account</h2>
            <form onSubmit={create} className="space-y-3">
              <input placeholder="Account / Business Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
              <p className="text-xs text-slate-400 pt-2">Optional: create login for client</p>
              <input placeholder="Client Name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <input type="email" placeholder="Client Email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <input type="password" placeholder="Client Password" value={form.clientPassword} onChange={(e) => setForm({ ...form, clientPassword: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
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
