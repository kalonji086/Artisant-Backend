import { useState } from 'react';

interface Email {
  id: string;
  to: string;
  subject: string;
  status: 'envoyé' | 'en attente' | 'erreur';
  date: string;
}

const mockEmails: Email[] = [
  {
    id: '1',
    to: 'client@example.com',
    subject: 'Confirmation de votre inscription',
    status: 'envoyé',
    date: '2026-11-01 10:30',
  },
  {
    id: '2',
    to: 'artisan@example.com',
    subject: 'Nouvelle demande de devis',
    status: 'envoyé',
    date: '2026-11-01 09:15',
  },
  {
    id: '3',
    to: 'employer@example.com',
    subject: 'Demande d\'accès employeur',
    status: 'en attente',
    date: '2026-11-01 08:45',
  },
];

export default function Emails() {
  const [emails] = useState<Email[]>(mockEmails);

  const statusColors = {
    envoyé: 'bg-green-50 text-green-700',
    'en attente': 'bg-yellow-50 text-yellow-700',
    erreur: 'bg-red-50 text-red-700',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Emails</h1>
        <p className="mt-1 text-sm text-muted">Historique et gestion des emails envoyés</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-ink">Destinataire</th>
              <th className="px-6 py-3 text-left font-medium text-ink">Sujet</th>
              <th className="px-6 py-3 text-left font-medium text-ink">Statut</th>
              <th className="px-6 py-3 text-left font-medium text-ink">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {emails.map((email) => (
              <tr key={email.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-ink">{email.to}</td>
                <td className="px-6 py-3 text-ink">{email.subject}</td>
                <td className="px-6 py-3">
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusColors[email.status]}`}>
                    {email.status}
                  </span>
                </td>
                <td className="px-6 py-3 text-muted">{email.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Envoyer un email</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Destinataires</label>
            <input
              type="email"
              placeholder="email@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Sujet</label>
            <input
              type="text"
              placeholder="Sujet de l'email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Message</label>
            <textarea
              rows={6}
              placeholder="Contenu de l'email..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition">
            Envoyer l'email
          </button>
        </div>
      </div>
    </div>
  );
}
