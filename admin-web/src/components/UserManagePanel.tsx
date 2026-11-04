import { useState, type FormEvent, type ReactNode } from 'react';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { Profile, ProfileRole } from '../types';

interface Props {
  profile: Profile;
  onDeleted: () => void;
}

type EditForm = {
  full_name: string;
  phone: string;
  city: string;
  address: string;
  profession: string;
  description: string;
  role: ProfileRole;
};

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const buttonClass =
  'rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

const toForm = (p: Profile): EditForm => ({
  full_name: p.full_name ?? '',
  phone: p.phone ?? '',
  city: p.city ?? '',
  address: p.address ?? '',
  profession: p.profession ?? '',
  description: p.description ?? '',
  role: p.role ?? 'client',
});

export default function UserManagePanel({ profile, onDeleted }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(() => toForm(profile));
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isArtisan = profile.role === 'artisan';
  const suspended = Boolean(profile.is_suspended);
  const reasonOk = reason.trim().length >= 3;
  const confirmTarget = profile.email ?? 'SUPPRIMER';
  const deleteOk = reasonOk && confirmText.trim() === confirmTarget;

  // Exécute une action serveur : vérifie le motif, gère l'état occupé et les messages.
  const run = async (action: () => Promise<unknown>, message: string, onOk?: () => void) => {
    if (!reasonOk) {
      setError('Indiquez un motif (3 caractères minimum).');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      setReason('');
      onOk?.();
    } catch (err) {
      setError(apiErrorMessage(err, 'Action impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      reason: reason.trim(),
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      profession: isArtisan ? form.profession.trim() || null : undefined,
      description: isArtisan ? form.description.trim() || null : undefined,
      role: form.role,
    };
    void run(() => AdminService.updateUser(profile.id, body), 'Profil mis à jour.', () => setEditing(false));
  };

  const toggleSuspend = () =>
    void run(
      () => (suspended ? AdminService.reactivateUser(profile.id, reason.trim()) : AdminService.suspendUser(profile.id, reason.trim())),
      suspended ? 'Compte réactivé.' : 'Compte suspendu.'
    );

  const remove = () =>
    void run(() => AdminService.deleteUser(profile.id, reason.trim()), 'Compte supprimé.', onDeleted);

  return (
    <section className="mt-6 space-y-4 border-t border-gray-100 pt-6" aria-label="Actions administrateur">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Gestion du compte</h3>
        {suspended ? <span className="text-xs font-medium text-red-600">Compte suspendu</span> : null}
      </div>

      <div>
        <label htmlFor="user-reason" className="mb-1 block text-xs font-medium text-muted">
          Motif (obligatoire pour toute action)
        </label>
        <textarea
          id="user-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Ex. : demande du client, violation des conditions…"
          className={inputClass}
        />
      </div>

      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {success ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</p> : null}

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setForm(toForm(profile));
              setEditing(true);
              setError(null);
            }}
            className={`${buttonClass} bg-brand text-white hover:bg-brand-dark`}
          >
            Modifier
          </button>
          <button
            type="button"
            disabled={busy || !reasonOk}
            onClick={toggleSuspend}
            className={`${buttonClass} ${suspended ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
          >
            {suspended ? 'Réactiver le compte' : 'Suspendre le compte'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowDelete((v) => !v)}
            className={`${buttonClass} border border-red-200 bg-white text-red-600 hover:bg-red-50`}
          >
            Supprimer le compte
          </button>
        </div>
      ) : (
        <form onSubmit={submitEdit} className="space-y-3">
          <Field label="Nom complet">
            <input className={inputClass} required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Téléphone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Ville">
            <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="Adresse">
            <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          {isArtisan ? (
            <>
              <Field label="Métier">
                <input className={inputClass} value={form.profession} onChange={(e) => setForm({ ...form, profession: e.target.value })} />
              </Field>
              <Field label="Description">
                <textarea rows={3} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </>
          ) : null}
          <Field label="Rôle">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ProfileRole })}>
              <option value="client">Client</option>
              <option value="artisan">Artisan</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !reasonOk} className={`${buttonClass} bg-brand text-white hover:bg-brand-dark`}>
              Enregistrer
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={`${buttonClass} bg-gray-100 text-ink hover:bg-gray-200`}>
              Annuler
            </button>
          </div>
        </form>
      )}

      {showDelete && !editing ? (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-4">
          <p className="text-xs text-red-700">
            Suppression définitive : le compte et ses données liées seront effacés. Tapez <strong>{confirmTarget}</strong> pour confirmer.
          </p>
          <input
            className={inputClass}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Confirmation de suppression"
          />
          <button
            type="button"
            disabled={busy || !deleteOk}
            onClick={remove}
            className={`${buttonClass} bg-red-600 text-white hover:bg-red-700`}
          >
            Confirmer la suppression
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
