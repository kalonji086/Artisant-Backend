import { useState } from 'react';

export default function Settings() {
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Paramètres</h1>
        <p className="mt-1 text-sm text-muted">Gérez les paramètres de la plateforme ARTISANTS</p>
      </div>

      {saved && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
          ✓ Paramètres enregistrés avec succès
        </div>
      )}

      <div className="grid gap-6 rounded-xl border border-gray-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-ink">Nom de la plateforme</label>
          <input
            type="text"
            defaultValue="ARTISANTS"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">Email de support</label>
          <input
            type="email"
            placeholder="support@artisants.com"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">Téléphone de support</label>
          <input
            type="tel"
            placeholder="+33 1 23 45 67 89"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink">URL de la plateforme</label>
          <input
            type="url"
            defaultValue="https://artisants.com"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <button
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition"
        >
          Enregistrer les paramètres
        </button>
      </div>
    </div>
  );
}
