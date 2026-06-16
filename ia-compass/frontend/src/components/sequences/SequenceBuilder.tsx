'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Plus, Trash2, Mail, MessageSquare, X, Users } from 'lucide-react';

interface Step {
  id: string;
  stepType: 'SMS' | 'EMAIL';
  delayMinutes: number;
  subject?: string;
  body: string;
  order: number;
}

interface Enrollment {
  id: string;
  status: string;
  currentStep: number;
  startedAt: string;
  contact: { firstName: string; lastName: string };
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

interface Sequence {
  id: string;
  name: string;
  steps: Step[];
  _count: { enrollments: number };
}

interface Props {
  sequenceId: string;
}

export default function SequenceBuilder({ sequenceId }: Props) {
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [stepType, setStepType] = useState<'SMS' | 'EMAIL'>('EMAIL');
  const [delayValue, setDelayValue] = useState(0);
  const [delayUnit, setDelayUnit] = useState('minutes');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [seq, enr] = await Promise.all([
      api.sequences.get(sequenceId),
      api.sequences.getEnrollments(sequenceId),
    ]);
    setSequence(seq);
    setEnrollments(enr);
    setLoading(false);
  }, [sequenceId]);

  useEffect(() => { load(); }, [load]);

  function getDelayMinutes() {
    const mul = delayUnit === 'minutes' ? 1 : delayUnit === 'hours' ? 60 : 1440;
    return delayValue * mul;
  }

  async function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!sequence) return;
    const maxOrder = sequence.steps.length > 0 ? Math.max(...sequence.steps.map(s => s.order)) + 1 : 0;
    await api.sequences.addStep(sequenceId, {
      stepType,
      delayMinutes: getDelayMinutes(),
      subject: stepType === 'EMAIL' ? subject : undefined,
      body,
      order: maxOrder,
    });
    setBody('');
    setSubject('');
    load();
  }

  async function handleDeleteStep(stepId: string) {
    await api.sequences.deleteStep(sequenceId, stepId);
    load();
  }

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    await api.sequences.enroll(sequenceId, selectedContacts);
    setShowEnroll(false);
    setSelectedContacts([]);
    load();
  }

  async function loadContacts() {
    const c = await api.contacts.list();
    setContacts(c);
  }

  function formatDelay(minutes: number) {
    if (minutes === 0) return 'Immediately';
    if (minutes < 60) return `After ${minutes}m`;
    if (minutes < 1440) return `After ${Math.round(minutes / 60)}h`;
    return `After ${Math.round(minutes / 1440)}d`;
  }

  const statusColor = (s: string) => {
    return s === 'ACTIVE' ? 'text-emerald-400' : s === 'COMPLETED' ? 'text-sky-400' : 'text-slate-400';
  };

  if (loading) return <div className="text-slate-400">Loading...</div>;
  if (!sequence) return <div className="text-slate-400">Sequence not found</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="bg-card-dark rounded-xl border border-slate-700 p-5 mb-4">
          <h3 className="font-semibold text-white mb-4">Steps</h3>
          {sequence.steps.length === 0 ? (
            <p className="text-slate-400 text-sm">No steps yet. Add your first step below.</p>
          ) : (
            <div className="space-y-3">
              {sequence.steps.map((step, i) => (
                <div key={step.id} className="flex items-start gap-3 bg-slate-900 rounded-lg p-3 border border-slate-700">
                  <div className="flex-shrink-0 mt-0.5">
                    {step.stepType === 'EMAIL' ? <Mail className="w-4 h-4 text-sky-400" /> : <MessageSquare className="w-4 h-4 text-purple-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-white">Step {i + 1} — {step.stepType}</span>
                      <span className="text-xs text-slate-400">{formatDelay(step.delayMinutes)}</span>
                    </div>
                    {step.subject && <p className="text-xs text-slate-300 mb-0.5">Subject: {step.subject}</p>}
                    <p className="text-xs text-slate-400 truncate">{step.body}</p>
                  </div>
                  <button onClick={() => handleDeleteStep(step.id)} className="text-slate-500 hover:text-red-400 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card-dark rounded-xl border border-slate-700 p-5">
          <h3 className="font-semibold text-white mb-4">Add Step</h3>
          <form onSubmit={handleAddStep} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Type</label>
                <select value={stepType} onChange={e => setStepType(e.target.value as 'SMS' | 'EMAIL')} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Delay</label>
                <div className="flex gap-1">
                  <input type="number" min="0" value={delayValue} onChange={e => setDelayValue(Number(e.target.value))} className="w-16 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
                  <select value={delayUnit} onChange={e => setDelayUnit(e.target.value)} className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                    <option value="minutes">min</option>
                    <option value="hours">hrs</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>
            </div>
            {stepType === 'EMAIL' && (
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="Email subject line" />
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Message Body *</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} required rows={4} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500 resize-none" placeholder="Your message here..." />
            </div>
            <button type="submit" className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> Add Step
            </button>
          </form>
        </div>
      </div>

      <div>
        <div className="bg-card-dark rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Enrollments ({enrollments.length})</h3>
            <button
              onClick={() => { loadContacts(); setShowEnroll(true); }}
              className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              <Users className="w-3.5 h-3.5" /> Enroll Contacts
            </button>
          </div>
          {enrollments.length === 0 ? (
            <p className="text-slate-400 text-sm">No contacts enrolled yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left pb-2 text-xs text-slate-400 font-medium">Contact</th>
                  <th className="text-left pb-2 text-xs text-slate-400 font-medium">Status</th>
                  <th className="text-left pb-2 text-xs text-slate-400 font-medium">Step</th>
                  <th className="text-left pb-2 text-xs text-slate-400 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map(e => (
                  <tr key={e.id} className="border-b border-slate-800 last:border-0">
                    <td className="py-2 text-white">{e.contact.firstName} {e.contact.lastName}</td>
                    <td className="py-2"><span className={`text-xs ${statusColor(e.status)}`}>{e.status}</span></td>
                    <td className="py-2 text-slate-300">{e.currentStep}</td>
                    <td className="py-2 text-slate-400 text-xs">{new Date(e.startedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showEnroll && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-96 border border-slate-700 p-5 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Enroll Contacts</h3>
              <button onClick={() => setShowEnroll(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 mb-4">
              {contacts.map(c => (
                <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedContacts.includes(c.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedContacts(prev => [...prev, c.id]);
                      else setSelectedContacts(prev => prev.filter(id => id !== c.id));
                    }}
                    className="rounded border-slate-600 bg-slate-900 text-sky-500"
                  />
                  <span className="text-sm text-white">{c.firstName} {c.lastName}</span>
                  {c.email && <span className="text-xs text-slate-400">{c.email}</span>}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowEnroll(false)} className="flex-1 bg-slate-700 text-white py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={(e) => handleEnroll(e as unknown as React.FormEvent)}
                disabled={selectedContacts.length === 0}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
              >
                Enroll {selectedContacts.length > 0 ? `(${selectedContacts.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
