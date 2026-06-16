import KanbanBoard from '@/components/crm/KanbanBoard';

export default function PipelinePage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">Pipeline</h2>
        <p className="text-slate-400 text-sm mt-1">Drag and drop deals through your sales stages</p>
      </div>
      <KanbanBoard />
    </div>
  );
}
