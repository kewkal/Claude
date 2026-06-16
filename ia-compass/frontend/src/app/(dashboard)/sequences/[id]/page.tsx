'use client';
import { use } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import SequenceBuilder from '@/components/sequences/SequenceBuilder';

export default function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div>
      <div className="mb-6">
        <Link href="/sequences" className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-3 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Sequences
        </Link>
        <h2 className="text-xl font-semibold text-white">Sequence Builder</h2>
        <p className="text-slate-400 text-sm mt-1">Configure steps and manage enrollments</p>
      </div>
      <SequenceBuilder sequenceId={id} />
    </div>
  );
}
