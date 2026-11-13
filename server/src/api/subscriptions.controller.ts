import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import {
  getGooglePlayNotificationEmail,
  getGooglePlayPackageName,
  createGooglePlayObfuscatedAccountId,
  verifyGooglePlayNotificationToken,
  verifyGooglePlaySubscription,
  type GooglePlaySubscriptionStatus,
  type VerifiedGooglePlaySubscription,
} from '../lib/google-play';

type AuthenticatedRequest = Request & { user?: { id: string } };

const purchaseSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  purchaseToken: z.string().trim().min(1).max(8192),
});

const notificationSchema = z.object({
  message: z.object({
    data: z.string().min(1),
  }),
  subscription: z.string().optional(),
});

const getUserId = (req: Request) => (req as AuthenticatedRequest).user?.id;

const requireArtisan = async (userId: string) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    logger.error('Impossible de vérifier le rôle pour l’abonnement', { userId, error: error.message });
    return { ok: false as const, status: 500, message: 'Impossible de vérifier le profil artisan.' };
  }
  if (profile?.role !== 'artisan') {
    return { ok: false as const, status: 403, message: 'Cette offre est réservée aux artisans.' };
  }
  return { ok: true as const };
};

const getSummary = async (userId: string) => {
  const { data, error } = await supabase.rpc('get_artisan_subscription_summary_for_user', {
    p_user_id: userId,
  });
  if (error) {
    logger.error('Lecture du récapitulatif d’abonnement impossible', { userId, error: error.message });
    throw new Error('Le récapitulatif de l’abonnement est indisponible.');
  }
  return data;
};

export const getGooglePlayAccountId = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  const permission = await requireArtisan(userId);
  if (!permission.ok) return res.status(permission.status).json({ error: permission.message });

  try {
    const obfuscatedAccountId = createGooglePlayObfuscatedAccountId(userId);
    const { data: existing, error: existingError } = await supabase
      .from('artisan_google_play_accounts')
      .select('obfuscated_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.obfuscated_account_id) {
      return res.json({ obfuscatedAccountId: existing.obfuscated_account_id });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('artisan_google_play_accounts')
      .insert({ user_id: userId, obfuscated_account_id: obfuscatedAccountId })
      .select('obfuscated_account_id')
      .single();
    if (insertError?.code === '23505') {
      const { data: raced, error: racedError } = await supabase
        .from('artisan_google_play_accounts')
        .select('obfuscated_account_id')
        .eq('user_id', userId)
        .single();
      if (racedError) throw new Error(racedError.message);
      return res.json({ obfuscatedAccountId: raced.obfuscated_account_id });
    }
    if (insertError) throw new Error(insertError.message);
    return res.json({ obfuscatedAccountId: inserted.obfuscated_account_id });
  } catch (error) {
    logger.error('Création de l’identifiant Google Play impossible', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({ error: 'Les achats Google Play ne sont pas configurés.' });
  }
};

const getPeriodStart = async (
  userId: string,
  purchaseToken: string,
  verified: VerifiedGooglePlaySubscription,
) => {
  const { data: existing, error } = await supabase
    .from('artisan_subscriptions')
    .select('purchase_token, current_period_start, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Impossible de lire l’abonnement actuel : ${error.message}`);

  const expiry = Date.parse(verified.expiryTime);
  if (existing?.purchase_token === purchaseToken) {
    const previousEnd = Date.parse(existing.current_period_end);
    if (expiry > previousEnd + 60_000 && previousEnd <= Date.now() + 60_000) {
      return new Date(previousEnd).toISOString();
    }
    return existing.current_period_start;
  }

  const start = verified.startTime ? Date.parse(verified.startTime) : Number.NaN;
  const withinOneMonth = Number.isFinite(start) && expiry > start && expiry - start <= 35 * 24 * 60 * 60 * 1000;
  if (withinOneMonth) return new Date(start).toISOString();

  const approximateStart = new Date(expiry);
  const day = approximateStart.getUTCDate();
  approximateStart.setUTCDate(1);
  approximateStart.setUTCMonth(approximateStart.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(
    approximateStart.getUTCFullYear(),
    approximateStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  approximateStart.setUTCDate(Math.min(day, lastDay));
  return approximateStart.toISOString();
};

const persistSubscription = async (
  userId: string,
  purchaseToken: string,
  plan: { tier: string; google_play_product_id: string },
  verified: VerifiedGooglePlaySubscription,
) => {
  const activeStatuses: GooglePlaySubscriptionStatus[] = ['active', 'grace_period', 'canceled'];
  const { data: current, error: currentError } = await supabase
    .from('artisan_subscriptions')
    .select('purchase_token, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (currentError) throw new Error(`Impossible de lire l’abonnement actuel : ${currentError.message}`);

  if (!activeStatuses.includes(verified.status) && current?.purchase_token !== purchaseToken) {
    return false;
  }

  const currentPeriodStart = await getPeriodStart(userId, purchaseToken, verified);
  const { error } = await supabase.from('artisan_subscriptions').upsert({
    user_id: userId,
    tier: plan.tier,
    provider: 'google_play',
    product_id: plan.google_play_product_id,
    purchase_token: purchaseToken,
    status: verified.status,
    current_period_start: currentPeriodStart,
    current_period_end: verified.expiryTime,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) {
    if (error.code === '23505') {
      throw new Error('Cet achat Google Play est déjà associé à un autre compte ARTISANTS.');
    }
    throw new Error(`Impossible d’enregistrer l’abonnement : ${error.message}`);
  }
  return true;
};

export const getMySubscription = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  const permission = await requireArtisan(userId);
  if (!permission.ok) return res.status(permission.status).json({ error: permission.message });

  try {
    return res.json({ subscription: await getSummary(userId) });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Abonnement indisponible.' });
  }
};

export const verifyMyGooglePlaySubscription = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  const permission = await requireArtisan(userId);
  if (!permission.ok) return res.status(permission.status).json({ error: permission.message });

  const validation = purchaseSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Données d’achat invalides.',
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { data: plan, error: planError } = await supabase
    .from('artisan_subscription_plans')
    .select('tier, google_play_product_id')
    .eq('google_play_product_id', validation.data.productId)
    .maybeSingle();
  if (planError) {
    logger.error('Lecture de l’offre Google Play impossible', { userId, error: planError.message });
    return res.status(500).json({ error: 'Les offres d’abonnement sont indisponibles.' });
  }
  if (!plan?.google_play_product_id) {
    return res.status(400).json({ error: 'Produit d’abonnement Google Play inconnu.' });
  }

  try {
    const verified = await verifyGooglePlaySubscription(validation.data.purchaseToken);
    if (!verified.productIds.includes(plan.google_play_product_id)) {
      return res.status(422).json({ error: 'Le produit de l’achat ne correspond pas à l’offre demandée.' });
    }
    const { data: account, error: accountError } = await supabase
      .from('artisan_google_play_accounts')
      .select('obfuscated_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (accountError) throw new Error(`Impossible de vérifier le compte Google Play : ${accountError.message}`);
    if (!account?.obfuscated_account_id || verified.obfuscatedAccountId !== account.obfuscated_account_id) {
      return res.status(403).json({ error: 'Cet achat Google Play n’est pas associé à ce compte ARTISANTS.' });
    }
    if (!['active', 'grace_period', 'canceled'].includes(verified.status)) {
      return res.status(402).json({ error: 'Aucun abonnement Google Play actif n’a été confirmé.' });
    }

    await persistSubscription(userId, validation.data.purchaseToken, plan, verified);
    return res.json({ subscription: await getSummary(userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'La vérification Google Play a échoué.';
    const status = message.includes('not configured') || message.includes('not configured.') ? 503 : 502;
    logger.error('Vérification d’abonnement Google Play impossible', { userId, error: message });
    return res.status(status).json({ error: message });
  }
};

export const handleGooglePlayNotification = async (req: Request, res: Response) => {
  const idToken = req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return res.status(401).json({ error: 'Jeton de notification manquant.' });

  const expectedEmail = getGooglePlayNotificationEmail();
  if (!expectedEmail) {
    return res.status(503).json({ error: 'La vérification des notifications Google Play n’est pas configurée.' });
  }

  try {
    const identity = await verifyGooglePlayNotificationToken(idToken);
    if (identity.email !== expectedEmail) {
      return res.status(401).json({ error: 'Identité de notification Google Play non autorisée.' });
    }

    const notification = notificationSchema.safeParse(req.body);
    if (!notification.success) {
      return res.status(400).json({ error: 'Notification Google Play invalide.' });
    }

    const decoded = Buffer.from(notification.data.message.data, 'base64').toString('utf8');
    let payload: unknown;
    try {
      payload = JSON.parse(decoded);
    } catch {
      return res.status(400).json({ error: 'Contenu de notification Google Play invalide.' });
    }

    const event = z.object({
      packageName: z.string(),
      subscriptionNotification: z.object({
        purchaseToken: z.string().min(1),
      }).optional(),
      testNotification: z.object({}).optional(),
    }).safeParse(payload);
    if (!event.success) return res.status(400).json({ error: 'Événement Google Play invalide.' });
    if (event.data.packageName !== getGooglePlayPackageName()) {
      return res.status(400).json({ error: 'Le paquet de la notification ne correspond pas à l’application.' });
    }
    if (event.data.testNotification || !event.data.subscriptionNotification) {
      return res.status(200).json({ received: true });
    }

    const purchaseToken = event.data.subscriptionNotification.purchaseToken;
    const { data: existing, error: existingError } = await supabase
      .from('artisan_subscriptions')
      .select('user_id')
      .eq('purchase_token', purchaseToken)
      .maybeSingle();
    if (existingError) throw new Error(`Impossible de retrouver l’achat : ${existingError.message}`);

    const verified = await verifyGooglePlaySubscription(purchaseToken);
    let userId = existing?.user_id ?? null;
    if (!userId && verified.obfuscatedAccountId) {
      const { data: account, error: accountError } = await supabase
        .from('artisan_google_play_accounts')
        .select('user_id')
        .eq('obfuscated_account_id', verified.obfuscatedAccountId)
        .maybeSingle();
      if (accountError) throw new Error(`Impossible de retrouver le compte Google Play : ${accountError.message}`);
      userId = account?.user_id ?? null;
    }
    if (!userId || !z.string().uuid().safeParse(userId).success) {
      logger.warn('Notification Google Play reçue sans compte ARTISANTS associé.');
      return res.status(200).json({ received: true });
    }

    const productId = verified.productIds[0];
    const { data: plan, error: planError } = await supabase
      .from('artisan_subscription_plans')
      .select('tier, google_play_product_id')
      .eq('google_play_product_id', productId)
      .maybeSingle();
    if (planError) throw new Error(`Impossible de retrouver l’offre : ${planError.message}`);
    if (!plan?.google_play_product_id) {
      logger.warn('Notification Google Play reçue pour un produit inconnu.', { productId });
      return res.status(200).json({ received: true });
    }

    await persistSubscription(userId, purchaseToken, plan, verified);
    return res.status(200).json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notification Google Play impossible à traiter.';
    logger.error('Traitement de notification Google Play impossible', { error: message });
    return res.status(500).json({ error: 'La notification Google Play n’a pas pu être traitée.' });
  }
};
