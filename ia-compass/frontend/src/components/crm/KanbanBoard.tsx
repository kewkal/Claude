'use client';
import { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter, useDraggable } from '@dnd-kit/core';
import { api } from '@/lib/api';
import { Plus, X } from 'lucide-react';

interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
}

interface Deal {
  id: string;
  stageId: string;
  value: number;
  contact: Contact;
}

interface Pipeline {
  id: string;
  stages: Stage[];
}

interface AddDealForm {
  stageId: string;
  contactId: string;
  value: string;
}

function DealCard({ deal, overlay }: { deal: Deal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-slate-900 border border-slate-700 rounded-lg p-3 cursor-grab active:cursor-grabbing ${overlay ? 'shadow-2xl rotate-2 opacity-90' : 'hover:border-sky-500/50'}`}
    >
      <p className="text-sm font-medium text-white">{deal.contact.firstName} {deal.contact.lastName}</p>
      {deal.value > 0 && <p className="text-xs text-emerald-400 mt-0.5">${deal.value.toLocaleString()}</p>}
    </div>
  );
}

export default function KanbanBoard() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [addForm, setAddForm] = useState<AddDealForm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      let pipelines = await api.pipelines.list();
      if (pipelines.length === 0) {
        pipelines = [await api.pipelines.create('Sales Pipeline')];
      }
      setPipeline(pipelines[0]);
      const [d, c] = await Promise.all([api.deals.list(), api.contacts.list()]);
      setDeals(d);
      setContacts(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const deal = deals.find(d => d.id === event.active.id);
    setActiveDeal(deal || null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;
    const dealId = active.id as string;
    const newStageId = over.id as string;
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stageId === newStageId) return;
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stageId: newStageId } : d));
    try {
      await api.deals.update(dealId, { stageId: newStageId });
    } catch {
      loadData();
    }
  }

  async function handleAddDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm) return;
    await api.deals.create({ contactId: addForm.contactId, stageId: addForm.stageId, value: parseFloat(addForm.value) || 0 });
    setAddForm(null);
    loadData();
  }

  if (loading) return <div className="text-slate-400">Loading pipeline...</div>;
  if (!pipeline) return <div className="text-slate-400">No pipeline found</div>;

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  return (
    <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map(stage => {
          const stageDeals = deals.filter(d => d.stageId === stage.id);
          const total = stageDeals.reduce((sum, d) => sum + d.value, 0);
          return (
            <div
              key={stage.id}
              id={stage.id}
              className="flex-shrink-0 w-72 bg-slate-800 rounded-xl border border-slate-700 flex flex-col"
            >
              <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-sm font-medium text-white">{stage.name}</span>
                  <span className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded-full">{stageDeals.length}</span>
                </div>
                <button
                  onClick={() => setAddForm({ stageId: stage.id, contactId: '', value: '' })}
                  className="text-slate-400 hover:text-sky-400"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {total > 0 && (
                <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-700">
                  ${total.toLocaleString()}
                </div>
              )}

              <div className="p-2 space-y-2 flex-1 min-h-[100px]" data-droppable-id={stage.id}>
                {stageDeals.map(deal => (
                  <DealCard key={deal.id} deal={deal} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeDeal && <DealCard deal={activeDeal} overlay />}
      </DragOverlay>

      {addForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-80 border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Add Deal</h3>
              <button onClick={() => setAddForm(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleAddDeal} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Contact</label>
                <select
                  value={addForm.contactId}
                  onChange={e => setAddForm(f => f ? { ...f, contactId: e.target.value } : f)}
                  required
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                >
                  <option value="">Select contact...</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Value ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addForm.value}
                  onChange={e => setAddForm(f => f ? { ...f, value: e.target.value } : f)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                  placeholder="0"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAddForm(null)} className="flex-1 bg-slate-700 text-white py-2 rounded-lg text-sm">Cancel</button>
                <button type="submit" className="flex-1 bg-sky-500 hover:bg-sky-600 text-white py-2 rounded-lg text-sm font-medium">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DndContext>
  );
}
