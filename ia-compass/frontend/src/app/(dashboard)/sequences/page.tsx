import SequenceList from '@/components/sequences/SequenceList';

export default function SequencesPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">Sequences</h2>
        <p className="text-slate-400 text-sm mt-1">Build automated email and SMS drip campaigns</p>
      </div>
      <SequenceList />
    </div>
  );
}
