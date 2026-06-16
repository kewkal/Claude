'use client';
import { useEffect, useState } from 'react';
import { Plus, Search, Trash2, Tag } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  source: string;
  tags: string[];
  createdAt: string;
}

export default function ContactsPage() {
  const user = getUser();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', tags: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => {
        setAccounts(r.data);
        if (r.data.length > 0) setAccountId(r.data[0].id);
      });
    }
  }, []);

  const params = user?.role === 'AGENCY_ADMIN' ? { accountId, search } : { search };

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN' && !accountId) return;
    api.get('/contacts', { params }).then((r) => setContacts(r.data)).catch(() => {});
  }, [accountId, search]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await api.post('/contacts', { ...form, tags, accountId: accountId || undefined });
      setForm({ firstName: '', lastName: '', email: '', phone: '', tags: '' });
      setShowForm(false);
      api.get('/contacts', { params }).then((r) => setContacts(r.data));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    await api.delete(`/contacts/${id}`);
    setContacts((c) => c.filter((x) => x.id !== id));
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Contact
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl bg-white text-sm focus:outline-none focus:border-sky-400"
          />
        </div>
        {user?.role === 'AGENCY_ADMIN' && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-sm"
          >
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Name', 'Email', 'Phone', 'Source', 'Tags', 'Added', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No contacts found</td></tr>
            ) : contacts.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{c.firstName} {c.lastName}</td>
                <td className="px-4 py-3 text-slate-500">{c.email || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">{c.source}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <button onClick={() => remove(c.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Add Contact</h2>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="First Name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
                <input placeholder="Last Name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              </div>
              <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <input placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                  {loading ? 'Saving...' : 'Add Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
