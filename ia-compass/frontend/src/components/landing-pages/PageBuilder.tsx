'use client';
import { useState, useEffect, useCallback } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import { Save, Globe, Trash2, GripVertical, Plus } from 'lucide-react';

type ElementType = 'heading' | 'paragraph' | 'button' | 'image' | 'form' | 'divider';

interface PageElement {
  id: string;
  type: ElementType;
  props: Record<string, unknown>;
}

const PALETTE_ITEMS: { type: ElementType; label: string; defaultProps: Record<string, unknown> }[] = [
  { type: 'heading', label: 'Heading', defaultProps: { text: 'Your Headline Here', fontSize: '36px', color: '#FFFFFF' } },
  { type: 'paragraph', label: 'Paragraph', defaultProps: { text: 'Write your paragraph content here.', fontSize: '16px', color: '#94A3B8' } },
  { type: 'button', label: 'Button', defaultProps: { label: 'Click Here', url: '#', backgroundColor: '#38BDF8' } },
  { type: 'image', label: 'Image', defaultProps: { src: '', alt: 'Image', width: '100%' } },
  { type: 'form', label: 'Lead Form', defaultProps: { fields: ['Name', 'Email', 'Phone'], submitLabel: 'Submit' } },
  { type: 'divider', label: 'Divider', defaultProps: { color: '#334155', height: '1px' } },
];

function renderElement(el: PageElement) {
  const p = el.props;
  switch (el.type) {
    case 'heading':
      return <h2 style={{ fontSize: p.fontSize as string, color: p.color as string, fontWeight: 'bold', margin: 0 }}>{p.text as string}</h2>;
    case 'paragraph':
      return <p style={{ fontSize: p.fontSize as string, color: p.color as string, margin: 0 }}>{p.text as string}</p>;
    case 'button':
      return (
        <a href={p.url as string} style={{ display: 'inline-block', backgroundColor: p.backgroundColor as string, color: '#fff', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>
          {p.label as string}
        </a>
      );
    case 'image':
      return p.src ? <img src={p.src as string} alt={p.alt as string} style={{ width: p.width as string, maxWidth: '100%', borderRadius: '8px' }} /> : <div className="w-full h-32 bg-slate-700 rounded-lg flex items-center justify-center text-slate-400 text-sm">No image URL set</div>;
    case 'form':
      return (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-600">
          <div className="space-y-2 mb-3">
            {(p.fields as string[]).map((field: string) => (
              <input key={field} placeholder={field} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm" readOnly />
            ))}
          </div>
          <button className="w-full bg-sky-500 text-white py-2 rounded font-medium text-sm">{p.submitLabel as string}</button>
        </div>
      );
    case 'divider':
      return <hr style={{ borderColor: p.color as string, borderWidth: p.height as string, margin: '8px 0' }} />;
    default:
      return null;
  }
}

function SortableElement({ el, selected, onSelect, onDelete }: { el: PageElement; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: el.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} onClick={onSelect} className={`group relative p-4 rounded-lg border-2 cursor-pointer transition-colors ${selected ? 'border-sky-500 bg-sky-500/5' : 'border-transparent hover:border-slate-600'}`}>
      <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab" {...attributes} {...listeners}>
        <GripVertical className="w-4 h-4 text-slate-500" />
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="pl-4">
        {renderElement(el)}
      </div>
    </div>
  );
}

function PropsEditor({ el, onChange }: { el: PageElement; onChange: (props: Record<string, unknown>) => void }) {
  const p = el.props;

  switch (el.type) {
    case 'heading':
    case 'paragraph':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Text</label>
            <textarea value={p.text as string} onChange={e => onChange({ ...p, text: e.target.value })} rows={3} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500 resize-none" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Font Size</label>
            <input value={p.fontSize as string} onChange={e => onChange({ ...p, fontSize: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Color</label>
            <input type="color" value={p.color as string} onChange={e => onChange({ ...p, color: e.target.value })} className="w-full h-9 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer" />
          </div>
        </div>
      );
    case 'button':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Label</label>
            <input value={p.label as string} onChange={e => onChange({ ...p, label: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">URL</label>
            <input value={p.url as string} onChange={e => onChange({ ...p, url: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Background Color</label>
            <input type="color" value={p.backgroundColor as string} onChange={e => onChange({ ...p, backgroundColor: e.target.value })} className="w-full h-9 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer" />
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Image URL</label>
            <input value={p.src as string} onChange={e => onChange({ ...p, src: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="https://..." />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Alt Text</label>
            <input value={p.alt as string} onChange={e => onChange({ ...p, alt: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Width</label>
            <input value={p.width as string} onChange={e => onChange({ ...p, width: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" placeholder="100%" />
          </div>
        </div>
      );
    case 'form':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Fields</label>
            {(p.fields as string[]).map((f: string, i: number) => (
              <div key={i} className="flex gap-1 mb-1">
                <input value={f} onChange={e => { const fields = [...(p.fields as string[])]; fields[i] = e.target.value; onChange({ ...p, fields }); }} className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500" />
                <button onClick={() => { const fields = (p.fields as string[]).filter((_, j) => j !== i); onChange({ ...p, fields }); }} className="text-red-400 px-2"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => onChange({ ...p, fields: [...(p.fields as string[]), 'New Field'] })} className="flex items-center gap-1 text-xs text-sky-400 mt-1">
              <Plus className="w-3 h-3" /> Add Field
            </button>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Submit Label</label>
            <input value={p.submitLabel as string} onChange={e => onChange({ ...p, submitLabel: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500" />
          </div>
        </div>
      );
    case 'divider':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Color</label>
            <input type="color" value={p.color as string} onChange={e => onChange({ ...p, color: e.target.value })} className="w-full h-9 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

interface Props {
  pageId: string;
}

export default function PageBuilder({ pageId }: Props) {
  const [elements, setElements] = useState<PageElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageName, setPageName] = useState('');
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const page = await api.landingPages.get(pageId);
    setPageName(page.name);
    setPublished(page.published);
    setElements(Array.isArray(page.content) ? page.content : []);
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  function addElement(type: ElementType) {
    const palette = PALETTE_ITEMS.find(p => p.type === type);
    if (!palette) return;
    const newEl: PageElement = {
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      props: { ...palette.defaultProps },
    };
    setElements(prev => [...prev, newEl]);
    setSelectedId(newEl.id);
  }

  function updateElement(id: string, props: Record<string, unknown>) {
    setElements(prev => prev.map(el => el.id === id ? { ...el, props } : el));
  }

  function deleteElement(id: string) {
    setElements(prev => prev.filter(el => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setElements(prev => {
      const oldIdx = prev.findIndex(el => el.id === active.id);
      const newIdx = prev.findIndex(el => el.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  async function handleSave() {
    setSaving(true);
    await api.landingPages.update(pageId, { name: pageName, content: elements });
    setSaving(false);
  }

  async function handlePublish() {
    await api.landingPages.publish(pageId);
    setPublished(p => !p);
  }

  const selectedEl = elements.find(el => el.id === selectedId);

  return (
    <div className="flex flex-col h-[calc(100vh-112px)]">
      <div className="flex items-center justify-between mb-4 bg-slate-800 rounded-xl border border-slate-700 px-4 py-3">
        <input
          value={pageName}
          onChange={e => setPageName(e.target.value)}
          className="bg-transparent text-white font-semibold text-lg focus:outline-none border-b border-transparent focus:border-slate-500 transition-colors"
        />
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handlePublish} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${published ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60' : 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'}`}>
            <Globe className="w-4 h-4" /> {published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        <div className="w-44 flex-shrink-0">
          <div className="bg-card-dark rounded-xl border border-slate-700 p-3">
            <p className="text-xs text-slate-400 font-medium mb-2">Elements</p>
            <div className="space-y-1">
              {PALETTE_ITEMS.map(item => (
                <button
                  key={item.type}
                  onClick={() => addElement(item.type)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5 text-sky-400" /> {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-card-dark rounded-xl border border-slate-700 overflow-y-auto p-6">
          {elements.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              Add elements from the left panel
            </div>
          ) : (
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={elements.map(e => e.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2 max-w-2xl mx-auto">
                  {elements.map(el => (
                    <SortableElement
                      key={el.id}
                      el={el}
                      selected={selectedId === el.id}
                      onSelect={() => setSelectedId(el.id)}
                      onDelete={() => deleteElement(el.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="w-56 flex-shrink-0">
          <div className="bg-card-dark rounded-xl border border-slate-700 p-3">
            <p className="text-xs text-slate-400 font-medium mb-3">Properties</p>
            {selectedEl ? (
              <PropsEditor el={selectedEl} onChange={props => updateElement(selectedEl.id, props)} />
            ) : (
              <p className="text-xs text-slate-500">Select an element to edit its properties</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
