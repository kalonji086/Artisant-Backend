import { useCallback, useEffect, useState } from 'react';
import RichEditor from './RichEditor';
import { Card, Spinner } from './ui';
import { DocumentIcon, ExternalLinkIcon } from './icons';
import { api, apiErrorMessage } from '../lib/api';

type Slug = 'privacy' | 'terms';

interface LegalDoc {
  html: string;
  customized: boolean;
  updated_at: string | null;
}

const TABS: { slug: Slug; label: string }[] = [
  { slug: 'privacy', label: 'Politique de confidentialité' },
  { slug: 'terms', label: "Conditions d'utilisation" },
];

export default function LegalEditor() {
  const [slug, setSlug] = useState<Slug>('privacy');
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [html, setHtml] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (target: Slug) => {
    setDoc(null);
    setMessage(null);
    try {
      const data = await api.get<LegalDoc>(`/admin/legal/${target}`);
      setDoc(data);
      setHtml(data.html);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Impossible de charger le document') });
    }
  }, []);

  useEffect(() => {
    void load(slug);
  }, [slug, load]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api.put<{ updated_at: string }>(`/admin/legal/${slug}`, { html });
      setDoc((d) => (d ? { ...d, html, customized: true, updated_at: data.updated_at } : d));
      setMessage({ ok: true, text: 'Publié : la page publique est à jour immédiatement.' });
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Erreur lors de la publication (migration 016 exécutée ?)') });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Revenir au texte standard ? Votre version personnalisée sera supprimée.')) return;
    setBusy(true);
    try {
      await api.delete(`/admin/legal/${slug}`);
      await load(slug);
      setMessage({ ok: true, text: 'Texte standard restauré.' });
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Erreur lors de la réinitialisation') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Éditeur des pages légales"
      subtitle="Modifiez le texte et publiez en temps réel. Chaque titre « Titre 2 » devient une section numérotée."
      icon={<DocumentIcon className="h-5 w-5" />}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => setSlug(t.slug)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              slug === t.slug ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        <a
          href={`/legal/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <ExternalLinkIcon className="h-4 w-4" /> Voir la page publique
        </a>
      </div>

      {doc ? (
        <>
          <p className="mb-3 text-xs text-gray-500">
            {doc.customized
              ? `Version personnalisée — publiée le ${new Date(doc.updated_at ?? '').toLocaleString('fr-FR')}`
              : 'Texte standard (non modifié)'}
          </p>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <RichEditor key={`${slug}-${version}`} initialHtml={doc.html} onChange={setHtml} hideVariables />
          </div>
        </>
      ) : (
        <div className="flex justify-center py-10"><Spinner /></div>
      )}

      {message ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !doc}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Spinner className="h-4 w-4" /> : null} Publier les modifications
        </button>
        {doc?.customized ? (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            Restaurer le texte standard
          </button>
        ) : null}
      </div>
    </Card>
  );
}
