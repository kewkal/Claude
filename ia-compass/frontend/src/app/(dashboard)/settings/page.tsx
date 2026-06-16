'use client';
import { useState, useEffect } from 'react';
import { getUser } from '@/lib/auth';
import { Copy, Check } from 'lucide-react';

export default function SettingsPage() {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const accountId = user?.accountId as string | undefined;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const webhookUrl = accountId ? `${apiUrl}/api/webhooks/${accountId}/contact` : '(loading...)';

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card-dark rounded-xl border border-slate-700 p-6">
        <h3 className="font-semibold text-white mb-4">Account Information</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <p className="text-white mt-0.5">{user?.name as string || '—'}</p>
          </div>
          <div>
            <label className="text-xs text-slate-400">Email</label>
            <p className="text-white mt-0.5">{user?.email as string || '—'}</p>
          </div>
          <div>
            <label className="text-xs text-slate-400">Role</label>
            <p className="text-white mt-0.5">{user?.role as string || '—'}</p>
          </div>
          <div>
            <label className="text-xs text-slate-400">Account ID</label>
            <p className="text-slate-300 mt-0.5 font-mono text-sm">{accountId || '—'}</p>
          </div>
        </div>
      </div>

      <div className="bg-card-dark rounded-xl border border-slate-700 p-6">
        <h3 className="font-semibold text-white mb-1">Webhook URL</h3>
        <p className="text-sm text-slate-400 mb-4">POST to this URL to create contacts from external sources (forms, third-party tools, etc.)</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-sky-300 font-mono break-all">
            {webhookUrl}
          </code>
          <button onClick={copyWebhook} className="flex-shrink-0 p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-2 font-medium">Example payload:</p>
          <pre className="text-xs text-slate-300 font-mono overflow-x-auto">{JSON.stringify({
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
            phone: "+1234567890",
            sequenceId: "(optional)"
          }, null, 2)}</pre>
        </div>
      </div>

      <div className="bg-card-dark rounded-xl border border-slate-700 p-6">
        <h3 className="font-semibold text-white mb-4">Integrations</h3>
        <div className="space-y-4">
          <div className="border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-white">Twilio (SMS)</h4>
              <span className="text-xs text-slate-400">Configured via .env</span>
            </div>
            <p className="text-xs text-slate-400">Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your .env file to enable SMS sending.</p>
          </div>
          <div className="border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-white">Mailgun (Email)</h4>
              <span className="text-xs text-slate-400">Configured via .env</span>
            </div>
            <p className="text-xs text-slate-400">Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM in your .env file to enable email sending.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
