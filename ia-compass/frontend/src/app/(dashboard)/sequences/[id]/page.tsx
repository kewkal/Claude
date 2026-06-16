'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2, MessageSquare, Mail, Clock, Users } from 'lucide-react';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function SequenceDetailPage() {
  const { id } = useParams();
  const user = getUser();
  const [sequence, setSequence] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [stepForm, setStepForm] = useState({ stepType: 'EMAIL', delayValue: '0', delayUnit: 'minutes', subject: '', body: '' });
  const [showEnroll, setShowEnroll] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => api.get(`/sequences/${id}`).then((r) => setSequence(r.data));

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!sequence) return;
    const aId = sequence.accountId;
    setAccountId(aId);
    api.get('/contacts', { params: { accountId: aId } }).then((r) => setContacts(r.data));
  }, [sequence]);

  const addStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const unitMap: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };
    const delayMinutes = parseInt(stepForm.delayValue) * unitMap[stepForm.delayUnit];
    const order = sequence.steps.length;
    await api.post(`/sequences/${id}/steps`, { ...stepForm, delayMinutes, order });
    await load();
    setStepForm({ stepType: 'EMAIL', delayValue: '0', delayUnit: 'minutes', subject: '', body: '' });
    setLoading(false);
  };

  const deleteStep = async (stepId: string) => {
    await api.delete(`/sequences/${id}/steps/${stepId}`);
    await load();
  };

  const enroll = async () => {
    if (selectedContacts.length === 0) return;
    await api.post(`/sequences/${id}/enroll`, { contactIds: selectedContacts });
    setShowEnroll(false);
    setSelectedContacts([]);
    await load();
  };

  if (!sequence) return <div className="p-8 text-slate-400">Loading...</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{sequence.name}</h1>
          <p className="text-slate-500 text-sm mt-1">Trigger: {sequence.triggerType}</p>
        </div>
        <button onClick={() => setShowEnroll(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
          <Users className="w-4 h-4" /> Enroll Contacts
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Steps */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Steps</h2>
          <div className="space-y-3 mb-6">
            {sequence.steps.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-400 text-sm">No steps yet</div>
            )}
            {sequence.steps.map((step: any, i: number) => (
              <div key={step.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${step.stepType === 'SMS' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                  {step.stepType === 'SMS' ? <MessageSquare className="w-4 h-4 text-emerald-600" /> : <Mail className="w-4 h-4 text-blue-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${step.stepType === 'SMS' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{step.stepType}</span>
                    {step.delayMinutes > 0 && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="w-3 h-3" />
                        {step.delayMinutes >= 1440 ? `${step.delayMinutes / 1440}d delay` : step.delayMinutes >= 60 ? `${step.delayMinutes / 60}h delay` : `${step.delayMinutes}m delay`}
                      </span>
                    )}
                  </div>
                  {step.subject && <p className="text-xs font-medium text-slate-600 mb-1">{step.subject}</p>}
                  <p className="text-xs text-slate-500 line-clamp-2">{step.body}</p>
                </div>
                <button onClick={() => deleteStep(step.id)} className="text-slate-300 hover:text-red-500 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add step form */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-semibold mb-4 text-sm">Add Step</h3>
            <form onSubmit={addStep} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select value={stepForm.stepType} onChange={(e) => setStepForm({ ...stepForm, stepType: e.target.value })}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400">
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                </select>
                <div className="flex gap-2">
                  <input type="number" min="0" value={stepForm.delayValue} onChange={(e) => setStepForm({ ...stepForm, delayValue: e.target.value })}
                    className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
                  <select value={stepForm.delayUnit} onChange={(e) => setStepForm({ ...stepForm, delayUnit: e.target.value })}
                    className="flex-1 px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400">
                    <option value="minutes">min</option>
                    <option value="hours">hrs</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>
              {stepForm.stepType === 'EMAIL' && (
                <input placeholder="Subject" value={stepForm.subject} onChange={(e) => setStepForm({ ...stepForm, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required />
              )}
              <textarea placeholder="Message body..." value={stepForm.body} onChange={(e) => setStepForm({ ...stepForm, body: e.target.value })}
                rows={4} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400 resize-none" required />
              <button type="submit" disabled={loading} className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> {loading ? 'Adding...' : 'Add Step'}
              </button>
            </form>
          </div>
        </div>

        {/* Enrollments */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Enrollments</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Contact</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sequence.enrollments.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No enrollments yet</td></tr>
                ) : sequence.enrollments.map((e: any) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-medium">{e.contact.firstName} {e.contact.lastName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        e.status === 'ACTIVE' ? 'bg-sky-100 text-sky-700' :
                        e.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>{e.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{e.currentStep}/{sequence.steps.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showEnroll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Enroll Contacts</h2>
            <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
              {contacts.map((c: any) => (
                <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                  <input type="checkbox" value={c.id} checked={selectedContacts.includes(c.id)}
                    onChange={(e) => setSelectedContacts(e.target.checked ? [...selectedContacts, c.id] : selectedContacts.filter((x) => x !== c.id))}
                    className="accent-blue-700" />
                  <span className="text-sm">{c.firstName} {c.lastName}</span>
                  <span className="text-xs text-slate-400 ml-auto">{c.email}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEnroll(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={enroll} className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">
                Enroll {selectedContacts.length > 0 ? `(${selectedContacts.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
