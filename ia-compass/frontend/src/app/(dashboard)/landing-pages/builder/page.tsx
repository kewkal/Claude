'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import PageBuilder from '@/components/landing-pages/PageBuilder';

function BuilderContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  if (!id) return <div className="text-slate-400">No page selected</div>;
  return <PageBuilder pageId={id} />;
}

export default function BuilderPage() {
  return (
    <div>
      <div className="mb-4">
        <Link href="/landing-pages" className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Landing Pages
        </Link>
      </div>
      <Suspense fallback={<div className="text-slate-400">Loading builder...</div>}>
        <BuilderContent />
      </Suspense>
    </div>
  );
}
