'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DndContext, DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { Type, AlignLeft, Image, MousePointer, FormInput, Minus, Trash2, Save, Globe, ArrowLeft, Settings } from 'lucide-react';
import api from '@/lib/api';

type ElementType = 'heading' | 'paragraph' | 'button' | 'image' | 'form' | 'divider';

interface PageElement {
  id: string;
  type: ElementType;
  props: Record<string, any>;
}

const elementDefs = [
  { type: 'heading' as ElementType, label: 'Heading', icon: Type },
  { type: 'paragraph' as ElementType, label: 'Paragraph', icon: AlignLeft },
  { type: 'button' as ElementType, label: 'Button', icon: MousePointer },
  { type: 'image' as ElementType, label: 'Image', icon: Image },
  { type: 'form' as ElementType, label: 'Lead Form', icon: FormInput },
  { type: 'divider' as ElementType, label: 'Divider', icon: Minus },
];

const defaultProps: Record<ElementType, Record<string, any>> = {
  heading: { text: 'Your Headline Here', fontSize: '36', color: '#1e293b', align: 'center', fontWeight: 'bold' },
  paragraph: { text: 'Add your paragraph text here. Tell your story and connect with your audience.', fontSize: '16', color: '#475569', align: 'left' },
  button: { text: 'Get Started', url: '#', bgColor: '#1E40AF', textColor: '#ffffff', align: 'center' },
  image: { src: 'https://via.placeholder.com/800x400', alt: 'Image', width: '100' },
  form: { buttonText: 'Submit', fields: ['firstName', 'email', 'phone'] },
  divider: { color: '#e2e8f0', margin: '20' },
};

function DraggablePanelItem({ type, label, icon: Icon }: { type: ElementType; label: string; icon: any }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `panel-${type}`, data: { type } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-white cursor-grab active:cursor-grabbing text-sm font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 transition-colors ${isDragging ? 'opacity-40' : ''}`}>
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </div>
  );
}

function renderElement(el: PageElement, selected: boolean, onClick: () => void, onDelete: () => void) {
  const p = el.props;
  return (
    <div key={el.id} onClick={onClick}
      className={`relative group cursor-pointer ${selected ? 'ring-2 ring-sky-400 ring-offset-2' : 'hover:ring-2 hover:ring-slate-200 hover:ring-offset-2'} rounded-lg`}>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 p-1 bg-red-500 text-white rounded-lg transition-opacity">
        <Trash2 className="w-3 h-3" />
      </button>

      {el.type === 'heading' && (
        <div style={{ textAlign: p.align as any, color: p.color, fontWeight: p.fontWeight }}>
          <p style={{ fontSize: `${p.fontSize}px` }}>{p.text}</p>
        </div>
      )}
      {el.type === 'paragraph' && (
        <div style={{ textAlign: p.align as any, color: p.color }}>
          <p style={{ fontSize: `${p.fontSize}px` }}>{p.text}</p>
        </div>
      )}
      {el.type === 'button' && (
        <div style={{ textAlign: p.align as any }}>
          <span style={{ backgroundColor: p.bgColor, color: p.textColor }}
            className="inline-block px-6 py-3 rounded-xl font-semibold cursor-pointer">
            {p.text}
          </span>
        </div>
      )}
      {el.type === 'image' && (
        <img src={p.src} alt={p.alt} style={{ width: `${p.width}%` }} className="mx-auto rounded-lg" />
      )}
      {el.type === 'form' && (
        <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
          <div className="space-y-3">
            {p.fields.includes('firstName') && <input placeholder="First Name" className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm" readOnly />}
            {p.fields.includes('lastName') && <input placeholder="Last Name" className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm" readOnly />}
            {p.fields.includes('email') && <input placeholder="Email Address" className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm" readOnly />}
            {p.fields.includes('phone') && <input placeholder="Phone Number" className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm" readOnly />}
            <button style={{ backgroundColor: '#1E40AF' }} className="w-full py-2 text-white rounded-lg font-medium text-sm">{p.buttonText}</button>
          </div>
        </div>
      )}
      {el.type === 'divider' && (
        <hr style={{ borderColor: p.color, marginTop: `${p.margin}px`, marginBottom: `${p.margin}px` }} />
      )}
    </div>
  );
}

function PropertiesPanel({ element, onChange }: { element: PageElement; onChange: (props: any) => void }) {
  const p = element.props;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-700 text-sm capitalize">{element.type} Properties</h3>

      {(element.type === 'heading' || element.type === 'paragraph') && (
        <>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Text</label>
            <textarea value={p.text} onChange={(e) => onChange({ ...p, text: e.target.value })}
              rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400 resize-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Font Size (px)</label>
            <input type="number" value={p.fontSize} onChange={(e) => onChange({ ...p, fontSize: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Color</label>
            <input type="color" value={p.color} onChange={(e) => onChange({ ...p, color: e.target.value })}
              className="w-full h-9 px-1 border border-slate-200 rounded-lg cursor-pointer" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Alignment</label>
            <select value={p.align} onChange={(e) => onChange({ ...p, align: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400">
              {['left', 'center', 'right'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </>
      )}

      {element.type === 'button' && (
        <>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Button Text</label>
            <input value={p.text} onChange={(e) => onChange({ ...p, text: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">URL</label>
            <input value={p.url} onChange={(e) => onChange({ ...p, url: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Background Color</label>
            <input type="color" value={p.bgColor} onChange={(e) => onChange({ ...p, bgColor: e.target.value })}
              className="w-full h-9 px-1 border border-slate-200 rounded-lg cursor-pointer" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Text Color</label>
            <input type="color" value={p.textColor} onChange={(e) => onChange({ ...p, textColor: e.target.value })}
              className="w-full h-9 px-1 border border-slate-200 rounded-lg cursor-pointer" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Alignment</label>
            <select value={p.align} onChange={(e) => onChange({ ...p, align: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400">
              {['left', 'center', 'right'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </>
      )}

      {element.type === 'image' && (
        <>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Image URL</label>
            <input value={p.src} onChange={(e) => onChange({ ...p, src: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Alt Text</label>
            <input value={p.alt} onChange={(e) => onChange({ ...p, alt: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Width (%)</label>
            <input type="number" min="10" max="100" value={p.width} onChange={(e) => onChange({ ...p, width: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
        </>
      )}

      {element.type === 'form' && (
        <>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Button Text</label>
            <input value={p.buttonText} onChange={(e) => onChange({ ...p, buttonText: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-2 block">Fields</label>
            {['firstName', 'lastName', 'email', 'phone'].map((f) => (
              <label key={f} className="flex items-center gap-2 text-xs text-slate-600 mb-1">
                <input type="checkbox" checked={p.fields.includes(f)} className="accent-blue-700"
                  onChange={(e) => onChange({ ...p, fields: e.target.checked ? [...p.fields, f] : p.fields.filter((x: string) => x !== f) })} />
                {f}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DroppableCanvas({ elements, selectedId, onSelect, onDelete, onUpdate }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' });
  return (
    <div ref={setNodeRef} className={`min-h-96 p-6 space-y-4 transition-colors ${isOver ? 'bg-sky-50' : 'bg-white'}`}>
      {elements.length === 0 && (
        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center text-slate-400">
          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Drag elements here to build your page</p>
        </div>
      )}
      {elements.map((el: PageElement) =>
        renderElement(
          el,
          el.id === selectedId,
          () => onSelect(el.id),
          () => onDelete(el.id)
        )
      )}
    </div>
  );
}

function BuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pageId = searchParams.get('id');
  const [elements, setElements] = useState<PageElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageName, setPageName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (pageId) {
      api.get(`/landing-pages/${pageId}`).then((r) => {
        setPageName(r.data.name);
        setElements(Array.isArray(r.data.content) ? r.data.content : []);
      });
    }
  }, [pageId]);

  const handleDragEnd = (e: DragEndEvent) => {
    if (e.over?.id === 'canvas' && e.active.data.current?.type) {
      const type = e.active.data.current.type as ElementType;
      const newEl: PageElement = { id: crypto.randomUUID(), type, props: { ...defaultProps[type] } };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(newEl.id);
    }
  };

  const updateProps = (props: any) => {
    setElements((prev) => prev.map((el) => el.id === selectedId ? { ...el, props } : el));
  };

  const deleteElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const save = async () => {
    setSaving(true);
    await api.put(`/landing-pages/${pageId}`, { name: pageName, content: elements });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedEl = elements.find((el) => el.id === selectedId);

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4">
        <button onClick={() => router.push('/landing-pages')} className="text-slate-400 hover:text-slate-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <input value={pageName} onChange={(e) => setPageName(e.target.value)}
          className="font-semibold text-slate-800 bg-transparent border-none outline-none focus:ring-0" />
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved!</span>}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:opacity-60">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="w-48 bg-white border-r border-slate-200 p-4 overflow-y-auto">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Elements</p>
            <div className="space-y-2">
              {elementDefs.map((def) => (
                <DraggablePanelItem key={def.type} {...def} />
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <DroppableCanvas
                elements={elements}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDelete={deleteElement}
                onUpdate={updateProps}
              />
            </div>
          </div>

          {/* Right panel */}
          <div className="w-56 bg-white border-l border-slate-200 p-4 overflow-y-auto">
            {selectedEl ? (
              <PropertiesPanel element={selectedEl} onChange={updateProps} />
            ) : (
              <div className="text-center text-slate-400 text-xs pt-8">
                <Settings className="w-6 h-6 mx-auto mb-2 opacity-50" />
                Click an element to edit properties
              </div>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense>
      <BuilderInner />
    </Suspense>
  );
}
