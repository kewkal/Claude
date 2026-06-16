'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Users, Mail, Globe, TrendingUp } from 'lucide-react';

interface StatCard {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}

export default function DashboardPage() {
  const [contacts, setContacts] = useState<unknown[]>([]);
  const [sequences, setSequences] = useState<unknown[]>([]);
  const [pages, setPages] = useState<unknown[]>([]);
  const [deals, setDeals] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.contacts.list(),
      api.sequences.list(),
      api.landingPages.list(),
      api.deals.list(),
    ]).then(([c, s, p, d]) => {
      setContacts(c);
      setSequences(s);
      setPages(p);
      setDeals(d);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const stats: StatCard[] = [
    { label: 'Total Contacts', value: contacts.length, icon: Users, color: 'bg-sky-500/20 text-sky-400' },
    { label: 'Active Sequences', value: (sequences as {active: boolean}[]).filter(s => s.active).length, icon: Mail, color: 'bg-purple-500/20 text-purple-400' },
    { label: 'Landing Pages', value: pages.length, icon: Globe, color: 'bg-emerald-500/20 text-emerald-400' },
    { label: 'Deals in Pipeline', value: deals.length, icon: TrendingUp, color: 'bg-orange-500/20 text-orange-400' },
  ];

  const recentContacts = (contacts as {id: string; firstName: string; lastName: string; email?: string; source: string; createdAt: string}[]).slice(0, 5);

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card-dark rounded-xl p-5 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-sm">{stat.label}</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-bold text-white">
              {loading ? '...' : stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-card-dark rounded-xl border border-slate-700 p-5">
        <h2 className="text-base font-semibold text-white mb-4">Recent Contacts</h2>
        {loading ? (
          <p className="text-slate-400 text-sm">Loading...</p>
        ) : recentContacts.length === 0 ? (
          <p className="text-slate-400 text-sm">No contacts yet. Add your first contact.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left pb-3 font-medium">Name</th>
                <th className="text-left pb-3 font-medium">Email</th>
                <th className="text-left pb-3 font-medium">Source</th>
                <th className="text-left pb-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {recentContacts.map((c) => (
                <tr key={c.id} className="border-b border-slate-800 last:border-0">
                  <td className="py-3 text-white font-medium">{c.firstName} {c.lastName}</td>
                  <td className="py-3 text-slate-300">{c.email || '—'}</td>
                  <td className="py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">{c.source}</span>
                  </td>
                  <td className="py-3 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
