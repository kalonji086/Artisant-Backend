import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { sendPushNotification } from '../services/notification.service';
import { createQuoteSchema, updateQuoteStatusSchema, ValidatedRequest } from '../lib/validation';

type AuthenticatedRequest = Request & { user?: { id: string } };

export const createQuoteRequest = async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;

  if (!user?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  // Validation Zod du corps de requête
  const validationResult = createQuoteSchema.safeParse(req);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: validationResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  const { artisan_id, service_id, description } = validationResult.data.body;

  // Vérifier que l'artisan n'est pas le client lui-même
  if (artisan_id === user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez pas créer un devis pour votre propre profil' });
  }

  try {
    const { data: quote, error } = await supabase
      .from('quotes')
      .insert({
        client_id: user.id,
        artisan_id,
        service_id,
        description: String(description).trim(),
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Récupérer le token push de l'artisan
    const { data: artisan } = await supabase
      .from('profiles')
      .select('full_name, expo_push_token')
      .eq('id', artisan_id)
      .single();

    if (artisan?.expo_push_token) {
      await sendPushNotification(
        artisan.expo_push_token,
        'Nouveau devis !',
        `Vous avez reçu une nouvelle demande de devis de la part d'un client.`,
        { quoteId: quote.id }
      );
    }

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
  const validationResult = updateQuoteStatusSchema.safeParse(req);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: validationResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  const { status, price } = validationResult.data.body;

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
