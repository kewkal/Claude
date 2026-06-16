'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import ContactForm from './ContactForm';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  tags: string[];
  source: string;
  createdAt: string;
}

const PAGE_SIZE = 20;

export default function ContactsTable() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [page, setPage] = useState(1);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.contacts.list(search || undefined);
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchContacts, 300);
    return () => clearTimeout(t);
  }, [fetchContacts]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this contact?')) return;
    await api.contacts.delete(id);
    fetchContacts();
  }

  const paged = contacts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(contacts.length / PAGE_SIZE);

  const sourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      MANUAL: 'bg-slate-700 text-slate-300',
      FORM: 'bg-emerald-900/40 text-emerald-400',
      WEBHOOK: 'bg-blue-900/40 text-blue-400',
    };
    return colors[source] || 'bg-slate-700 text-slate-300';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search contacts..."
            className="pl-9 pr-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 w-64"
          />
        </div>
        <button
          onClick={() => { setEditContact(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Contact
        </button>
      </div>

      <div className="bg-card-dark rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Phone</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Source</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Tags</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Added</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : paged.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No contacts found</td></tr>
            ) : paged.map(c => (
              <tr key={c.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3 text-white font-medium">{c.firstName} {c.lastName}</td>
                <td className="px-4 py-3 text-slate-300">{c.email || '—'}</td>
                <td className="px-4 py-3 text-slate-300">{c.phone || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${sourceBadge(c.source)}`}>{c.source}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 bg-sky-900/40 text-sky-400 rounded text-xs">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => { setEditContact(c); setShowForm(true); }} className="text-slate-400 hover:text-sky-400"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(c.id)} className="text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-400">{contacts.length} contacts</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm text-white rounded-lg transition-colors">Prev</button>
            <span className="px-3 py-1.5 text-sm text-slate-400">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm text-white rounded-lg transition-colors">Next</button>
          </div>
        </div>
      )}

      {showForm && (
        <ContactForm
          contact={editContact}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchContacts(); }}
        />
      )}
    </div>
  );
}
