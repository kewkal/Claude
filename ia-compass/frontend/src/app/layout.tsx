import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IA Compass',
  description: 'CRM & Marketing Automation Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-900 text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
