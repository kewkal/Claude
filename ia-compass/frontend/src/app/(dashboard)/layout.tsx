'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);
  return (
    <div className="min-h-screen bg-slate-900">
      <Sidebar />
      <Header />
      <main className="ml-60 pt-16 p-6 min-h-screen">{children}</main>
    </div>
  );
}
