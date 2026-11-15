import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { getBranding } from '../lib/branding';
import { defaultLegalHtml, sanitizeLegalHtml, type CustomDoc, type LegalSlug } from '../lib/legal';
type AuthenticatedRequest = Request & { user?: { id: string } };

const isSlug = (v: unknown): v is LegalSlug => v === 'privacy' || v === 'terms';

const baseUrlOf = (req: Request): string =>
  (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

const publishLegalDocumentChange = async (slug: LegalSlug, updatedAt: string | null): Promise<boolean> => {
  const channel = supabase.channel('legal-document-updates', { config: { private: true } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Délai de connexion Realtime dépassé.')), 8_000);
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(`Connexion Realtime impossible (${status}).`));
        }
      });
    });

    const status = await channel.send({
      type: 'broadcast',
      event: 'document_changed',
      payload: { slug, updated_at: updatedAt },
    });
    if (status !== 'ok') throw new Error(`Publication Realtime impossible (${status}).`);
    return true;
  } catch (error) {
    logger.error('Notification Realtime du document légal impossible', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    try {
      const status = await supabase.removeChannel(channel);
      if (status !== 'ok') {
        logger.error('Fermeture du canal Realtime légal impossible', { slug, status });
      }
    } catch (error) {
      logger.error('Fermeture du canal Realtime légal impossible', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const getCustomDoc = async (slug: LegalSlug): Promise<CustomDoc | null> => {
  const { data } = await supabase
    .from('legal_documents')
    .select('content_html, updated_at')
    .eq('slug', slug)
    .maybeSingle();
  return data?.content_html ? { html: data.content_html, updatedAt: data.updated_at } : null;
};

export const getLegalDocument = async (req: Request, res: Response) => {
  const slug = req.params.slug;
  if (!isSlug(slug)) return res.status(404).json({ error: 'Document introuvable' });

  try {
    const custom = await getCustomDoc(slug);
    const html = custom?.html ?? defaultLegalHtml(slug, await getBranding(), baseUrlOf(req));
    return res.json({ slug, html, customized: !!custom, updated_at: custom?.updatedAt ?? null });
  } catch (err) {
    logger.error('Erreur lecture document légal', { error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'Erreur lors de la lecture du document' });
  }
};

export const saveLegalDocument = async (req: AuthenticatedRequest, res: Response) => {
  const slug = req.params.slug;
  if (!isSlug(slug)) return res.status(404).json({ error: 'Document introuvable' });

  const raw = req.body?.html;
  if (typeof raw !== 'string' || !raw.trim()) {
    return res.status(400).json({ error: 'Le contenu ne peut pas être vide' });
  }
  if (raw.length > 500_000) return res.status(400).json({ error: 'Contenu trop volumineux' });

  const { data, error } = await supabase
    .from('legal_documents')
    .upsert(
      { slug, content_html: sanitizeLegalHtml(raw), updated_at: new Date().toISOString(), updated_by: req.user?.id ?? null },
      { onConflict: 'slug' }
    )
    .select('updated_at')
    .single();

  if (error) {
    logger.error('Erreur sauvegarde document légal', { error: error.message, slug });
    return res.status(500).json({ error: error.message || 'Erreur lors de la sauvegarde' });
  }
  logger.info('Document légal mis à jour', { slug, admin_id: req.user?.id });
  const realtimeUpdated = await publishLegalDocumentChange(slug, data.updated_at);
  return res.json({ slug, customized: true, updated_at: data.updated_at, realtime_updated: realtimeUpdated });
};

export const resetLegalDocument = async (req: AuthenticatedRequest, res: Response) => {
  const slug = req.params.slug;
  if (!isSlug(slug)) return res.status(404).json({ error: 'Document introuvable' });

  const { error } = await supabase.from('legal_documents').delete().eq('slug', slug);
  if (error) return res.status(500).json({ error: error.message || 'Erreur lors de la réinitialisation' });
  const realtimeUpdated = await publishLegalDocumentChange(slug, null);
  return res.json({ slug, customized: false, realtime_updated: realtimeUpdated });
};
