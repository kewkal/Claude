'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { X } from 'lucide-react';

interface Contact {
  id?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
}

interface Props {
  contact?: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ContactForm({ contact, onClose, onSaved }: Props) {
  const [firstName, setFirstName] = useState(contact?.firstName || '');
  const [lastName, setLastName] = useState(contact?.lastName || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [tags, setTags] = useState((contact?.tags || []).join(', '));
  const [source, setSource] = useState(contact?.source || 'MANUAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const data = {
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      source,
    };
    try {
      if (contact?.id) {
        await api.contacts.update(contact.id, data);
      } else {
        await api.contacts.create(data);
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">{contact?.id ? 'Edit Contact' : 'Add Contact'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">First Name *</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Last Name *</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Tags (comma-separated)</label>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="lead, vip, hot" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
              <option value="MANUAL">Manual</option>
              <option value="FORM">Form</option>
              <option value="WEBHOOK">Webhook</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors">
              {loading ? 'Saving...' : 'Save Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
