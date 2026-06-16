'use client';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getUser } from '@/lib/auth';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/contacts': 'Contacts',
  '/pipeline': 'Pipeline',
  '/sequences': 'Sequences',
  '/landing-pages': 'Landing Pages',
  '/settings': 'Settings',
};

export default function Header() {
  const pathname = usePathname();
  const user = getUser();
  const title = Object.entries(PAGE_TITLES).find(([key]) => pathname.startsWith(key))?.[1] || 'IA Compass';
  const initials = ((user?.name as string) || 'U').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 fixed top-0 right-0 left-60 z-10">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-4">
        <button className="text-slate-400 hover:text-white">
          <Bell className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-sm font-bold text-white">
          {initials}
        </div>
      </div>
    </header>
  );
}
