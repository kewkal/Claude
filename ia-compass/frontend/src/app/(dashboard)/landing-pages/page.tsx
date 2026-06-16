'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, ExternalLink, FileText } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function LandingPagesPage() {
  const router = useRouter();
  const user = getUser();
  const [pages, setPages] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => { setAccounts(r.data); if (r.data.length) setAccountId(r.data[0].id); });
    }
  }, []);

  const params = user?.role === 'AGENCY_ADMIN' ? { accountId } : {};

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN' && !accountId) return;
    api.get('/landing-pages', { params }).then((r) => setPages(r.data));
  }, [accountId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/landing-pages', { ...form, accountId: accountId || undefined });
    setPages((p) => [data, ...p]);
    setShowForm(false);
    router.push(`/landing-pages/builder?id=${data.id}`);
  };

  const togglePublish = async (page: any) => {
    const endpoint = page.published ? `/landing-pages/${page.id}/unpublish` : `/landing-pages/${page.id}/publish`;
    const { data } = await api.post(endpoint);
    setPages((p) => p.map((x) => x.id === page.id ? data : x));
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Landing Pages</h1>
        <div className="flex gap-3">
          {user?.role === 'AGENCY_ADMIN' && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-sm">
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> New Page
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pages.length === 0 && (
          <div className="col-span-3 bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            No landing pages yet. Create your first one!
          </div>
        )}
        {pages.map((p: any) => (
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
            <div className="bg-gradient-to-br from-blue-50 to-sky-100 h-32 flex items-center justify-center">
              <FileText className="w-10 h-10 text-blue-300" />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {p.published ? 'Published' : 'Draft'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-3">/{p.slug}</p>
              <div className="flex gap-2">
                <button onClick={() => router.push(`/landing-pages/builder?id=${p.id}`)}
                  className="flex-1 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">
                  Edit
                </button>
                <button onClick={() => togglePublish(p)}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium ${p.published ? 'border border-slate-200 hover:bg-slate-50' : 'bg-blue-700 hover:bg-blue-800 text-white'}`}>
                  {p.published ? 'Unpublish' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">New Landing Page</h2>
            <form onSubmit={create} className="space-y-3">
              <input placeholder="Page Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">/</span>
                <input placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">Create & Edit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
