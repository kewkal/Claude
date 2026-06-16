'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Plus, Pencil, Globe, X } from 'lucide-react';

interface LandingPage {
  id: string;
  name: string;
  slug: string;
  published: boolean;
  createdAt: string;
}

export default function LandingPagesPage() {
  const router = useRouter();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  async function loadPages() {
    const data = await api.landingPages.list();
    setPages(data);
    setLoading(false);
  }

  useEffect(() => { loadPages(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const page = await api.landingPages.create({ name: newName, slug: newSlug || undefined });
    setShowCreate(false);
    setNewName('');
    setNewSlug('');
    router.push(`/landing-pages/builder?id=${page.id}`);
  }

  async function handlePublish(id: string) {
    await api.landingPages.publish(id);
    loadPages();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Landing Pages</h2>
          <p className="text-slate-400 text-sm mt-1">Build and publish landing pages</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Page
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : pages.length === 0 ? (
        <div className="bg-card-dark rounded-xl border border-slate-700 p-8 text-center">
          <Globe className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No landing pages yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pages.map(page => (
            <div key={page.id} className="bg-card-dark rounded-xl border border-slate-700 p-5">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-white">{page.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${page.published ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                  {page.published ? 'Published' : 'Draft'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4 font-mono">{page.slug}</p>
              <p className="text-xs text-slate-400 mb-4">Created {new Date(page.createdAt).toLocaleDateString()}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/landing-pages/builder?id=${page.id}`)}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={() => handlePublish(page.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${page.published ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400' : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-400'}`}
                >
                  {page.published ? 'Unpublish' : 'Publish'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-80 border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">New Landing Page</h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Page Name *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="My Landing Page" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Slug (optional)</label>
                <input value={newSlug} onChange={e => setNewSlug(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="my-landing-page" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 bg-slate-700 text-white py-2 rounded-lg text-sm">Cancel</button>
                <button type="submit" className="flex-1 bg-sky-500 hover:bg-sky-600 text-white py-2 rounded-lg text-sm font-medium">Create & Edit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
