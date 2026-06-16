import ContactsTable from '@/components/crm/ContactsTable';

export default function ContactsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white">Contacts</h2>
        <p className="text-slate-400 text-sm mt-1">Manage your CRM contact database</p>
      </div>
      <ContactsTable />
    </div>
  );
}
