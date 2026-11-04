import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { sendPushNotification } from '../services/notification.service';
import { createQuoteSchema, updateQuoteStatusSchema, ValidatedRequest } from '../lib/validation';
import { buildQuoteRequestEmail, sendEmail } from '../lib/email';

type AuthenticatedRequest = Request & { user?: { id: string } };

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

    // Notifier le client du changement de statut
    const { data: client } = await supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', data.client_id)
      .single();

    if (client?.expo_push_token) {
      await sendPushNotification(
        client.expo_push_token,
        'Mise à jour de votre devis',
        `Votre demande de devis est maintenant : ${status}${price ? ` (Prix: ${price}€)` : ''}`,
        { quoteId: id }
      );
    }

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la mise à jour du devis';
    res.status(500).json({ error: message });
  }
};
