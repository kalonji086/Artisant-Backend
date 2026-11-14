import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { getBranding } from '../lib/branding';
import { defaultLegalHtml, sanitizeLegalHtml, type CustomDoc, type LegalSlug } from '../lib/legal';
type AuthenticatedRequest = Request & { user?: { id: string } };

const isSlug = (v: unknown): v is LegalSlug => v === 'privacy' || v === 'terms';

const baseUrlOf = (req: Request): string =>
  (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

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
  return res.json({ slug, customized: true, updated_at: data.updated_at });
};

export const resetLegalDocument = async (req: AuthenticatedRequest, res: Response) => {
  const slug = req.params.slug;
  if (!isSlug(slug)) return res.status(404).json({ error: 'Document introuvable' });

  const { error } = await supabase.from('legal_documents').delete().eq('slug', slug);
  if (error) return res.status(500).json({ error: error.message || 'Erreur lors de la réinitialisation' });
  return res.json({ slug, customized: false });
};
