import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activity';
import { createQuoteSchema, updateQuoteStatusSchema, ValidatedRequest } from '../lib/validation';
import { buildQuoteRequestEmail, sendEmail } from '../lib/email';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { renderQuotePdf, QuoteDocumentItem } from '../lib/quote-document';

type AuthenticatedRequest = Request & { user?: { id: string } };

const proposalSchema = z.object({
  intro: z.string().max(5000).optional().default(''),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().finite().positive().max(1000000),
    unitPrice: z.number().finite().nonnegative().max(1000000000),
  })).min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  taxRate: z.number().finite().min(0).max(100),
  validUntil: z.string().date().nullable().optional(),
  terms: z.string().max(10000).optional().default(''),
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] || character));

const formatMoney = (amount: number, currency: string) => {
  const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${currency}`;
};

const proposalTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  html_content: z.string().min(1).max(30000),
});

const quoteTemplateSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ['h1', 'h2', 'h3', 'p', 'strong', 'em', 'u', 's', 'span', 'div', 'blockquote', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
  allowedAttributes: { a: ['href'], '*': ['style'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedStyles: {
    '*': {
      color: [/^#[0-9A-Fa-f]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'background-color': [/^#[0-9A-Fa-f]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(bold|normal|[1-9]00)$/],
      'font-style': [/^(italic|normal)$/],
      'text-decoration': [/^(underline|line-through|none)$/],
      'font-size': [/^\d+(?:px|pt|em|%)$/],
      'font-family': [/^(Arial|Georgia|Times New Roman|Verdana|Trebuchet MS|Courier New)$/],
    },
  },
};

const sendQuoteAssignmentEmails = async (quote: {
  id: string;
  title: string | null;
  description: string | null;
  client_id: string | null;
  artisan_id: string | null;
  status: string;
}) => {
  if (!quote.client_id || !quote.artisan_id) return;

  try {
    const [clientUser, artisanUser] = await Promise.all([
      supabase.auth.admin.getUserById(quote.client_id),
      supabase.auth.admin.getUserById(quote.artisan_id),
    ]);

    const clientEmail = clientUser.data.user?.email ?? null;
    const artisanEmail = artisanUser.data.user?.email ?? null;
    const baseUrl = (process.env.APP_URL || 'https://www.artisants.com').replace(/\/+$/, '');
    const quoteUrl = `${baseUrl}/quotes?quote=${encodeURIComponent(quote.id)}`;
    const dashboardUrl = `${baseUrl}/dashboard?quote=${encodeURIComponent(quote.id)}`;

    const clientName = clientUser.data.user?.user_metadata?.full_name || 'Client';
    const artisanName = artisanUser.data.user?.user_metadata?.full_name || 'Artisan';

    if (clientEmail) {
      const content = await buildQuoteRequestEmail({
        recipientName: clientName,
        quoteTitle: quote.title || 'Votre demande de devis',
        quoteDescription: quote.description || 'Votre devis a été attribué à l’artisan le plus adapté.',
        ctaText: 'Demander un devis',
        ctaUrl: quoteUrl,
        subject: 'Votre devis a été attribué',
      });

      await sendEmail({
        to: clientEmail,
        subject: 'Votre devis a été attribué',
        htmlContent: content,
      });
    }

    if (artisanEmail) {
      const artisanHtml = await buildQuoteRequestEmail({
        recipientName: artisanName,
        quoteTitle: quote.title || 'Nouvelle demande',
        quoteDescription: `Une demande de devis a été attribuée à ${artisanName}. Consultez les détails et répondez directement depuis votre dashboard.`,
        ctaText: 'Voir la demande',
        ctaUrl: dashboardUrl,
        subject: `Nouvelle demande de devis : ${quote.title || 'Service'}`,
      });

      await sendEmail({
        to: artisanEmail,
        subject: `Nouvelle demande de devis : ${quote.title || 'Service'}`,
        htmlContent: artisanHtml,
      });
    }
  } catch (error) {
    console.warn('[quotes] email notification failed:', error);
  }
};

export const createQuoteRequest = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;

  if (!user?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  // Validation Zod du corps de requête
  const validationResult = createQuoteSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: validationResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  const { service_id, description, latitude, longitude } = validationResult.data;

  try {
    // La demande n'a pas d'artisan : elle attend l'assignation par l'Admin.
    const { data: quote, error } = await supabase
      .from('quotes')
      .insert({
        client_id: user.id,
        service_id,
        description: String(description).trim(),
        status: 'unassigned',
        latitude,
        longitude,
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity({ actorId: user.id, action: 'quote.created', entityType: 'quote', entityId: quote.id });
    res.status(201).json(quote);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la création du devis';
    res.status(500).json({ error: message });
  }
};

export const updateQuoteStatus = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  if (!user?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  // Validation Zod
  const validationResult = updateQuoteStatusSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: validationResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  const { status, price } = validationResult.data;

  try {
    // Vérifier que le devis existe et récupérer ses infos
    const { data: existingQuote, error: fetchError } = await supabase
      .from('quotes')
      .select('client_id, artisan_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existingQuote) {
      return res.status(404).json({ error: 'Devis non trouvé' });
    }

    // Contrôle d'accès : seul l'artisan propriétaire du devis peut modifier son statut
    if (existingQuote.artisan_id !== user.id) {
      return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à modifier ce devis' });
    }

    const { data, error } = await supabase
      .from('quotes')
      .update({ status, price })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logActivity({
      actorId: user.id,
      action: 'quote.status_changed',
      entityType: 'quote',
      entityId: id,
      metadata: { from: existingQuote.status, to: status },
    });

    if (status === 'assigned' || status === 'pending' || status === 'accepted') {
      await sendQuoteAssignmentEmails({
        id: data.id,
        title: data.title ?? null,
        description: data.description ?? null,
        client_id: data.client_id,
        artisan_id: data.artisan_id,
        status: data.status,
      });
    }

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la mise à jour du devis';
    res.status(500).json({ error: message });
  }
};

export const getQuoteProposal = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) return res.status(401).json({ error: 'Utilisateur non authentifié' });

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('id, client_id, artisan_id, proposal_template_key, proposal_intro, proposal_items, proposal_currency, proposal_tax_rate, proposal_subtotal, proposal_tax_amount, proposal_total, proposal_valid_until, proposal_terms, proposal_sent_at, proposal_email_id, status')
    .eq('id', req.params.id)
    .single();

  if (error || !quote) return res.status(404).json({ error: 'Devis non trouvé' });
  if (quote.client_id !== user.id && quote.artisan_id !== user.id) {
    return res.status(403).json({ error: 'Vous n’êtes pas autorisé à consulter ce devis' });
  }
  return res.json(quote);
};

export const saveQuoteProposal = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) return res.status(401).json({ error: 'Utilisateur non authentifié' });

  const parsed = proposalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Données du devis invalides', details: parsed.error.issues });
  }
  const { data: quote, error: fetchError } = await supabase
    .from('quotes')
    .select('id, artisan_id, status, proposal_sending_at, proposal_sent_at')
    .eq('id', req.params.id)
    .single();
  if (fetchError || !quote) return res.status(404).json({ error: 'Devis non trouvé' });
  if (quote.artisan_id !== user.id) return res.status(403).json({ error: 'Seul l’artisan assigné peut modifier ce devis' });
  if (quote.proposal_sent_at || quote.status === 'quote_sent') {
    return res.status(409).json({ error: 'Ce devis a déjà été envoyé et ne peut plus être modifié' });
  }
  if (!['assigned', 'pending', 'accepted'].includes(quote.status)) {
    return res.status(409).json({ error: 'Ce devis ne peut pas être modifié dans son état actuel' });
  }
  if (quote.proposal_sending_at) return res.status(409).json({ error: 'L’envoi de ce devis est en cours' });

  const currencyCodes = new Set(Intl.supportedValuesOf('currency'));
  if (!currencyCodes.has(parsed.data.currency)) {
    return res.status(400).json({ error: 'Code de devise ISO 4217 invalide' });
  }
  if (parsed.data.validUntil && parsed.data.validUntil < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'La date de validité doit être aujourd’hui ou ultérieure' });
  }

  const fractionDigits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: parsed.data.currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const precision = 10 ** fractionDigits;
  const items = parsed.data.items.map((item) => ({
    ...item,
    quantity: Math.round(item.quantity * 10000) / 10000,
    unitPrice: Math.round(item.unitPrice * precision) / precision,
  }));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * precision) / precision;
  const taxAmount = Math.round(subtotal * parsed.data.taxRate / 100 * precision) / precision;
  const total = Math.round((subtotal + taxAmount) * precision) / precision;

  const { data, error } = await supabase
    .from('quotes')
    .update({
      proposal_intro: parsed.data.intro,
      proposal_items: items,
      proposal_currency: parsed.data.currency,
      proposal_tax_rate: parsed.data.taxRate,
      proposal_subtotal: subtotal,
      proposal_tax_amount: taxAmount,
      proposal_total: total,
      proposal_valid_until: parsed.data.validUntil || null,
      proposal_terms: parsed.data.terms,
    })
    .eq('id', req.params.id)
    .eq('artisan_id', user.id)
    .in('status', ['assigned', 'pending', 'accepted'])
    .is('proposal_sending_at', null)
    .is('proposal_sent_at', null)
    .select('id, proposal_template_key, proposal_intro, proposal_items, proposal_currency, proposal_tax_rate, proposal_subtotal, proposal_tax_amount, proposal_total, proposal_valid_until, proposal_terms')
    .maybeSingle();
  if (error) {
    return res.status(500).json({ error: 'Impossible d’enregistrer le devis', details: error.message });
  }
  if (!data) return res.status(409).json({ error: 'L’envoi du devis est en cours ou le devis a déjà été envoyé' });
  return res.json(data);
};

export const sendQuoteProposal = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) return res.status(401).json({ error: 'Utilisateur non authentifié' });
  const quoteId = req.params.id;
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { error: clearStaleError } = await supabase
    .from('quotes')
    .update({ proposal_sending_at: null })
    .eq('id', quoteId)
    .eq('artisan_id', user.id)
    .lt('proposal_sending_at', staleBefore);
  if (clearStaleError) return res.status(500).json({ error: 'Impossible de vérifier l’état d’envoi du devis' });

  const { data: lock, error: lockError } = await supabase
    .from('quotes')
    .update({ proposal_sending_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('artisan_id', user.id)
    .is('proposal_sending_at', null)
    .is('proposal_sent_at', null)
    .in('status', ['assigned', 'pending', 'accepted'])
    .select('id')
    .maybeSingle();
  if (lockError) return res.status(500).json({ error: 'Impossible de verrouiller l’envoi du devis' });
  if (!lock) return res.status(409).json({ error: 'Devis introuvable, déjà envoyé ou en cours d’envoi' });

  let emailSent = false;
  try {
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('id, title, description, client_id, artisan_id, category, proposal_template_key, proposal_intro, proposal_items, proposal_currency, proposal_tax_rate, proposal_subtotal, proposal_tax_amount, proposal_total, proposal_valid_until, proposal_terms')
      .eq('id', quoteId)
      .single();
    if (error || !quote || !quote.client_id || !quote.proposal_template_key || !quote.proposal_currency
      || quote.proposal_subtotal === null || quote.proposal_tax_amount === null || quote.proposal_total === null
      || !Array.isArray(quote.proposal_items) || quote.proposal_items.length === 0) {
      throw new Error('Le devis doit être enregistré et comporter un client avant envoi');
    }

    const [clientResult, artisanResult, templateResult] = await Promise.all([
      supabase.auth.admin.getUserById(quote.client_id),
      supabase.auth.admin.getUserById(user.id),
      supabase.from('quote_templates').select('html_content').eq('template_key', quote.proposal_template_key).single(),
    ]);
    const clientEmail = clientResult.data.user?.email;
    if (clientResult.error || artisanResult.error || templateResult.error || !clientEmail) {
      throw new Error('Coordonnées du client, de l’artisan ou modèle indisponibles');
    }

    const [clientProfile, artisanProfile] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', quote.client_id).maybeSingle(),
      supabase.from('profiles').select('full_name, profession').eq('id', user.id).maybeSingle(),
    ]);
    const clientName = clientProfile.data?.full_name || clientResult.data.user?.user_metadata?.full_name || 'Client';
    const artisanName = artisanProfile.data?.full_name || artisanResult.data.user?.user_metadata?.full_name || 'Artisan';
    const documentItems = (Array.isArray(quote.proposal_items) ? quote.proposal_items : []) as QuoteDocumentItem[];
    const currency = quote.proposal_currency;
    const taxRate = Number(quote.proposal_tax_rate || 0);
    const subtotal = Number(quote.proposal_subtotal);
    const taxAmount = Number(quote.proposal_tax_amount || 0);
    const total = Number(quote.proposal_total || 0);
    const quoteNumber = quote.id.slice(0, 8).toUpperCase();
    const documentData = {
      quoteNumber,
      clientName,
      artisanName,
      profession: artisanProfile.data?.profession || '',
      title: quote.title || quote.category || 'Prestation',
      description: [quote.proposal_intro, quote.description].filter(Boolean).join('\n\n'),
      items: documentItems,
      currency,
      taxRate,
      subtotal,
      taxAmount,
      total,
      validUntil: quote.proposal_valid_until,
      terms: quote.proposal_terms || '',
    };

    const sanitizedTemplate = sanitizeHtml(templateResult.data.html_content, quoteTemplateSanitizeOptions);
    const fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const precision = 10 ** fractionDigits;
    const itemsHtml = `<table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Total</th></tr></thead><tbody>${documentItems.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${formatMoney(item.unitPrice, currency)}</td><td>${formatMoney(Math.round(item.quantity * item.unitPrice * precision) / precision, currency)}</td></tr>`).join('')}</tbody></table>`;
    const replacements: Record<string, string> = {
      quote_number: quoteNumber,
      client_name: clientName,
      artisan_name: artisanName,
      profession: artisanProfile.data?.profession || '',
      title: documentData.title,
      description: documentData.description,
      items_html: itemsHtml,
      subtotal: formatMoney(subtotal, currency),
      tax_rate: String(taxRate),
      tax_amount: formatMoney(taxAmount, currency),
      total: formatMoney(total, currency),
      currency,
      valid_until: quote.proposal_valid_until || 'Sans date limite',
      terms: quote.proposal_terms || '',
    };
    const renderedHtml = sanitizedTemplate.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) =>
      key === 'items_html' ? itemsHtml : escapeHtml(replacements[key] || ''));
    const pdf = await renderQuotePdf(documentData);
    const emailResponse = await sendEmail({
      to: clientEmail,
      subject: `Votre devis ${quoteNumber} — ${documentData.title}`,
      htmlContent: `<html lang="fr"><body>${renderedHtml}</body></html>`,
      textContent: `Votre devis ${quoteNumber} est joint à ce message.`,
      attachment: [{
        name: `devis-${quoteNumber}.pdf`,
        content: pdf.toString('base64'),
      }],
    });
    emailSent = true;

    const { data: sentQuote, error: statusError } = await supabase
      .from('quotes')
      .update({
        status: 'quote_sent',
        proposal_sent_at: new Date().toISOString(),
        proposal_email_id: emailResponse.messageId || null,
        proposal_sending_at: null,
      })
      .eq('id', quoteId)
      .eq('artisan_id', user.id)
      .is('proposal_sent_at', null)
      .select('id, status, proposal_sent_at')
      .single();
    if (statusError || !sentQuote) {
      throw new Error('Email envoyé, mais le statut du devis et la notification client n’ont pas pu être confirmés. Contactez le support avant tout nouvel envoi.');
    }
    await logActivity({ actorId: user.id, action: 'quote.proposal_sent', entityType: 'quote', entityId: quoteId });
    return res.json(sentQuote);
  } catch (error) {
    if (!emailSent) {
      const { error: unlockError } = await supabase
        .from('quotes')
        .update({ proposal_sending_at: null })
        .eq('id', quoteId)
        .eq('artisan_id', user.id);
      if (unlockError) console.error('[quotes] failed to release proposal sending lock:', unlockError.message);
    }
    const message = error instanceof Error ? error.message : 'Échec de l’envoi du devis';
    return res.status(500).json({ error: message });
  }
};

export const getQuoteCurrencies = (_req: Request, res: Response) => {
  return res.json(Intl.supportedValuesOf('currency').sort());
};

export const listQuoteTemplates = async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('quote_templates')
    .select('template_key, name, html_content, updated_at')
    .order('template_key');
  if (error) return res.status(500).json({ error: 'Impossible de charger les modèles de devis', details: error.message });
  return res.json(data);
};

export const updateQuoteTemplate = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const { template_key: templateKey } = req.params;
  if (!['fixed', 'detailed'].includes(templateKey)) return res.status(404).json({ error: 'Modèle introuvable' });
  const parsed = proposalTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Modèle invalide', details: parsed.error.issues });
  const sanitized = sanitizeHtml(parsed.data.html_content, quoteTemplateSanitizeOptions);
  const { data, error } = await supabase
    .from('quote_templates')
    .update({ name: parsed.data.name, html_content: sanitized, updated_at: new Date().toISOString(), updated_by: user?.id })
    .eq('template_key', templateKey)
    .select('template_key, name, html_content, updated_at')
    .single();
  if (error) return res.status(500).json({ error: 'Impossible d’enregistrer le modèle', details: error.message });
  return res.json(data);
};
