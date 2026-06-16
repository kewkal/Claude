'use client';
import { useEffect, useState } from 'react';
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCorners,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import api from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Plus } from 'lucide-react';

interface Deal { id: string; contact: { firstName: string; lastName: string }; stageId: string; value: number; }
interface Stage { id: string; name: string; color: string; deals: Deal[]; }

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm cursor-grab active:cursor-grabbing"
    >
      <p className="font-medium text-slate-800 text-sm">{deal.contact.firstName} {deal.contact.lastName}</p>
      {deal.value > 0 && <p className="text-sky-600 text-xs mt-1 font-semibold">${deal.value.toLocaleString()}</p>}
    </div>
  );
}

export default function PipelinePage() {
  const user = getUser();
  const [stages, setStages] = useState<Stage[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [dealForm, setDealForm] = useState({ contactId: '', stageId: '', value: '' });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN') {
      api.get('/accounts').then((r) => { setAccounts(r.data); if (r.data.length) setAccountId(r.data[0].id); });
    }
  }, []);

  const params = user?.role === 'AGENCY_ADMIN' ? { accountId } : {};

  useEffect(() => {
    if (user?.role === 'AGENCY_ADMIN' && !accountId) return;
    api.get('/pipelines', { params }).then((r) => {
      if (r.data.length > 0) setStages(r.data[0].stages);
    });
    api.get('/contacts', { params }).then((r) => setContacts(r.data));
  }, [accountId]);

  const findStageOfDeal = (dealId: string) => stages.find((s) => s.deals.some((d) => d.id === dealId));

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const fromStage = findStageOfDeal(active.id as string);
    const toStage = stages.find((s) => s.id === over.id) || findStageOfDeal(over.id as string);
    if (!fromStage || !toStage || fromStage.id === toStage.id) return;

    setStages((prev) =>
      prev.map((s) => {
        if (s.id === fromStage.id) return { ...s, deals: s.deals.filter((d) => d.id !== active.id) };
        if (s.id === toStage.id) {
          const deal = fromStage.deals.find((d) => d.id === active.id)!;
          return { ...s, deals: [...s.deals, { ...deal, stageId: s.id }] };
        }
        return s;
      })
    );
    await api.put(`/pipelines/deals/${active.id}`, { stageId: toStage.id });
  };

  const addDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/pipelines/deals', dealForm);
    setStages((prev) =>
      prev.map((s) => s.id === data.stageId ? { ...s, deals: [...s.deals, data] } : s)
    );
    setShowAddDeal(false);
    setDealForm({ contactId: '', stageId: '', value: '' });
  };

  const activeDeal = activeId ? stages.flatMap((s) => s.deals).find((d) => d.id === activeId) : null;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
        <div className="flex gap-3">
          {user?.role === 'AGENCY_ADMIN' && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-sm">
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowAddDeal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add Deal
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <div key={stage.id} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="font-semibold text-slate-700 text-sm">{stage.name}</span>
                <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{stage.deals.length}</span>
              </div>
              <SortableContext id={stage.id} items={stage.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                <div className="bg-slate-100 rounded-2xl p-3 min-h-32 space-y-2">
                  {stage.deals.map((deal) => <DealCard key={deal.id} deal={deal} />)}
                </div>
              </SortableContext>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeDeal && (
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-lg">
              <p className="font-medium text-slate-800 text-sm">{activeDeal.contact.firstName} {activeDeal.contact.lastName}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {showAddDeal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Add Deal</h2>
            <form onSubmit={addDeal} className="space-y-3">
              <select value={dealForm.contactId} onChange={(e) => setDealForm({ ...dealForm, contactId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required>
                <option value="">Select Contact</option>
                {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
              <select value={dealForm.stageId} onChange={(e) => setDealForm({ ...dealForm, stageId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" required>
                <option value="">Select Stage</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="number" placeholder="Deal Value ($)" value={dealForm.value} onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-400" />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddDeal(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">Add Deal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
