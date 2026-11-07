import { useCallback, useEffect, useState } from 'react';
import RichEditor from '../components/RichEditor';
import { AdminService, apiErrorMessage } from '../lib/api';

type TemplateKey = 'fixed' | 'detailed';
type QuoteTemplate = {
  template_key: TemplateKey;
  name: string;
  html_content: string;
  updated_at: string;
};

const VARIABLES = [
  ['Référence', '{{quote_number}}'],
  ['Nom du client', '{{client_name}}'],
  ['Nom de l’artisan', '{{artisan_name}}'],
  ['Métier', '{{profession}}'],
  ['Titre du devis', '{{title}}'],
  ['Description', '{{description}}'],
  ['Lignes du devis', '{{items_html}}'],
  ['Sous-total', '{{subtotal}}'],
  ['Taux de TVA', '{{tax_rate}}'],
  ['Montant TVA', '{{tax_amount}}'],
  ['Total TTC', '{{total}}'],
  ['Devise', '{{currency}}'],
  ['Date de validité', '{{valid_until}}'],
  ['Conditions', '{{terms}}'],
];

export default function QuoteTemplates({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [selected, setSelected] = useState<TemplateKey>('fixed');
  const [name, setName] = useState('');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await AdminService.getQuoteTemplates();
      setTemplates(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les modèles.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const template = templates.find((item) => item.template_key === selected);
    setName(template?.name ?? '');
    setHtml(template?.html_content ?? '');
  }, [selected, templates]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data } = await AdminService.updateQuoteTemplate(selected, { name, html_content: html });
      setTemplates((current) => current.map((item) => item.template_key === selected ? data : item));
      setMessage('Modèle enregistré.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible d’enregistrer le modèle.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Modèles de devis</h1>
          <p className="mt-1 text-sm text-muted">Modifiez le contenu et la mise en forme transmis aux artisans.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-ink hover:bg-gray-50">
          Retour aux devis
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => { setSelected('fixed'); setMessage(''); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${selected === 'fixed' ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-gray-200'}`}>
          Devis forfaitaire
        </button>
        <button type="button" onClick={() => { setSelected('detailed'); setMessage(''); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${selected === 'detailed' ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-gray-200'}`}>
          Devis détaillé
        </button>
      </div>

      {error ? <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}
      {loading ? <p className="py-8 text-center text-sm text-muted">Chargement des modèles…</p> : (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-ink">
            Nom du modèle
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2" />
          </label>
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Variables disponibles</p>
            <div className="flex flex-wrap gap-2">
              {VARIABLES.map(([label, variable]) => (
                <span key={variable} title={label} className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-ink">{variable}</span>
              ))}
            </div>
          </div>
          <RichEditor key={selected} initialHtml={html} onChange={setHtml} hideVariables />
          <div className="flex justify-end">
            <button type="button" disabled={saving || !name.trim() || !html.trim()} onClick={() => void save()} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer le modèle'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
