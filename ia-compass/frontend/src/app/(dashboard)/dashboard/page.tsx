'use client';
import { useEffect, useState } from 'react';
import { Users, Mail, Globe, TrendingUp } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function DashboardPage() {
  const user = getUser();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [stats, setStats] = useState({ contacts: 0, sequences: 0, pages: 0 });

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => {
        setAccounts(r.data);
        if (r.data.length > 0) setSelectedAccount(r.data[0].id);
      });
    }
  }, []);

  useEffect(() => {
    const accountId = user?.role === 'AGENCY_ADMIN' ? selectedAccount : undefined;
    if (!accountId && user?.role === 'AGENCY_ADMIN') return;
    const params = accountId ? { accountId } : {};
    Promise.all([
      api.get('/contacts', { params }),
      api.get('/sequences', { params }),
      api.get('/landing-pages', { params }),
    ]).then(([c, s, p]) => {
      setStats({ contacts: c.data.length, sequences: s.data.length, pages: p.data.length });
    }).catch(() => {});
  }, [selectedAccount]);

  const statCards = [
    { label: 'Total Contacts', value: stats.contacts, icon: Users, color: 'text-sky-400', bg: 'bg-sky-400/10' },
    { label: 'Active Sequences', value: stats.sequences, icon: Mail, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: 'Landing Pages', value: stats.pages, icon: Globe, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: 'Accounts', value: accounts.length, icon: TrendingUp, color: 'text-orange-400', bg: 'bg-orange-400/10' },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Welcome back, {user?.name}</p>
        </div>
        {user?.role === 'AGENCY_ADMIN' && accounts.length > 0 && (
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg bg-white text-sm"
          >
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className={`inline-flex p-3 rounded-xl ${s.bg} mb-4`}>
              <s.icon className={`w-6 h-6 ${s.color}`} />
            </div>
            <div className="text-3xl font-bold text-slate-900">{s.value}</div>
            <div className="text-sm text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {user?.role === 'AGENCY_ADMIN' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">Client Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-slate-400 text-sm">No accounts yet. Go to Settings to create one.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {accounts.map((a: any) => (
                <div key={a.id} className="py-3 flex items-center justify-between">
                  <span className="font-medium text-slate-800">{a.name}</span>
                  <span className="text-sm text-slate-400">{a._count?.contacts || 0} contacts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
