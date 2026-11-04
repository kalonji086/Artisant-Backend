import { supabase } from './supabase';
import { logger } from './logger';
import { logActivity } from './activity';
import { ACCOUNT_DELETION_PATH, escapeHtml, type Branding } from './branding';

export interface DeletionFormInput {
  email?: unknown;
  full_name?: unknown;
  reason?: unknown;
  confirm?: unknown;
}

export interface DeletionFormState {
  values?: { email: string; full_name: string; reason: string };
  error?: string;
  success?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SUCCESS = 'Si un compte est associé à cette adresse, votre demande de suppression a bien été enregistrée. Notre équipe vous répondra par email.';

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Traite la demande : vérifie le compte puis enregistre la demande (visible en temps réel dans l'admin Support). */
export const submitAccountDeletion = async (
  input: DeletionFormInput
): Promise<{ ok: true } | { ok: false; error: string; values: DeletionFormState['values'] }> => {
  const email = text(input.email, 254).toLowerCase();
  const fullName = text(input.full_name, 120);
  const reason = text(input.reason, 1000);
  const values = { email, full_name: fullName, reason };

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Adresse email invalide.', values };
  if (input.confirm !== 'on' && input.confirm !== 'true' && input.confirm !== true) {
    return { ok: false, error: 'Veuillez cocher la case de confirmation.', values };
  }

  // Réponse identique qu'un compte existe ou non (pas d'énumération des comptes).
  const { data: details, error: lookupError } = await supabase
    .from('profile_details')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (lookupError) {
    logger.error('Recherche de compte pour suppression échouée', { error: lookupError.message });
    return { ok: false, error: 'Une erreur est survenue. Réessayez plus tard.', values };
  }
  if (!details) return { ok: true };

  const { data: open } = await supabase
    .from('support_requests')
    .select('id')
    .eq('request_type', 'account_deletion')
    .eq('email', email)
    .in('status', ['open', 'in_progress'])
    .limit(1);
  if (open && open.length > 0) return { ok: true };

  const message = reason ? `Demande de suppression de compte. Motif : ${reason}` : 'Demande de suppression de compte.';
  const { data: created, error: insertError } = await supabase
    .from('support_requests')
    .insert({
      request_type: 'account_deletion',
      email,
      full_name: fullName || null,
      subject: 'Suppression de compte',
      message,
      status: 'open',
    })
    .select('id')
    .single();
  if (insertError) {
    logger.error('Enregistrement de la demande de suppression échoué', { error: insertError.message });
    return { ok: false, error: 'Une erreur est survenue. Réessayez plus tard.', values };
  }

  await logActivity({
    actorId: details.user_id,
    action: 'account_deletion.requested',
    entityType: 'support_request',
    entityId: created?.id ?? null,
    metadata: { source: 'email_link' },
  });
  return { ok: true };
};

const pageStyle = `
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; color: #1f2937; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 10px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.6; color: #4b5563; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; }
  textarea { min-height: 96px; resize: vertical; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin-top: 16px; font-weight: 500; }
  .check input { width: auto; margin-top: 3px; }
  button { margin-top: 20px; width: 100%; padding: 13px; font-size: 15px; font-weight: 700; color: #fff; background: #dc2626; border: 0; border-radius: 6px; cursor: pointer; }
  .alert { padding: 12px; border-radius: 6px; font-size: 14px; margin-bottom: 14px; }
  .alert.error { background: #fee2e2; color: #991b1b; }
  .alert.success { background: #dcfce7; color: #166534; }
  a { color: #208aef; }
`;

/** Page HTML publique du formulaire de demande de suppression de compte. */
export const renderAccountDeletionPage = (branding: Branding, state: DeletionFormState = {}): string => {
  const v = state.values ?? { email: '', full_name: '', reason: '' };
  const name = escapeHtml(branding.platformName);
  const contact = escapeHtml(branding.contactEmail);

  const body = state.success
    ? `<div class="alert success">${escapeHtml(GENERIC_SUCCESS)}</div>
       <p>Vous pouvez fermer cette page.</p>`
    : `${state.error ? `<div class="alert error">${escapeHtml(state.error)}</div>` : ''}
       <p>Cette demande supprime définitivement votre compte ${name} et vos données personnelles, sauf celles que la loi nous oblige à conserver. Elle est traitée par notre équipe.</p>
       <form method="post" action="${ACCOUNT_DELETION_PATH}">
         <label for="email">Adresse email de votre compte *</label>
         <input id="email" name="email" type="email" required maxlength="254" value="${escapeHtml(v.email)}" autocomplete="email">
         <label for="full_name">Nom complet</label>
         <input id="full_name" name="full_name" maxlength="120" value="${escapeHtml(v.full_name)}" autocomplete="name">
         <label for="reason">Motif (facultatif)</label>
         <textarea id="reason" name="reason" maxlength="1000">${escapeHtml(v.reason)}</textarea>
         <label class="check"><input type="checkbox" name="confirm" required> Je comprends que la suppression de mon compte est définitive.</label>
         <button type="submit">Demander la suppression</button>
       </form>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suppression de compte - ${name}</title>
  <style>${pageStyle}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Supprimer mon compte</h1>
      ${body}
    </div>
    <p style="text-align:center;margin-top:16px;font-size:12px;">
      Une question ? <a href="mailto:${contact}">${contact}</a>
    </p>
  </div>
</body>
</html>`;
};
