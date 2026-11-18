import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

type AuthenticatedRequest = Request & { user?: { id: string; email?: string } };
type DeviceMetadata = { platform: string | null; model: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_SECRET = process.env.AUTH_ATTEMPT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function getBucketHash(email: string, ip: string): string {
  if (!HASH_SECRET) throw new Error('Missing secret for login attempt hashing');
  return createHmac('sha256', HASH_SECRET).update(`${email}\0${ip}`).digest('hex');
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function getDeviceMetadata(value: unknown): DeviceMetadata {
  const device = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const platform = ['ios', 'android', 'web'].includes(String(device.platform))
    ? String(device.platform)
    : null;
  const model = typeof device.model === 'string'
    ? device.model.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || null
    : null;
  return { platform, model };
}

async function findUserId(email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_auth_user_for_login', { p_email: email });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || '';
}

function logFailure(message: string, error: unknown) {
  logger.error(message, { error: error instanceof Error ? error.message : String(error) });
}

export async function loginWithSecurity(req: Request, res: Response) {
  const email = getEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    return res.status(400).json({ error: 'Identifiants invalides.' });
  }
  const ip = getClientIp(req);
  const device = getDeviceMetadata(req.body?.device);

  try {
    const userId = await findUserId(email);
    const bucketHash = getBucketHash(email, ip);
    const rpcParameters = {
      p_bucket_hash: bucketHash,
      p_user_id: userId,
      p_masked_identifier: maskEmail(email),
      p_ip: ip,
      p_platform: device.platform,
      p_device_model: device.model,
    };
    const { data: lockData, error: lockError } = await supabase.rpc(
      'check_auth_login_lock',
      rpcParameters
    );
    if (lockError) throw lockError;
    const lock = Array.isArray(lockData) ? lockData[0] : lockData;
    if (lock?.is_locked === true) {
      return res.status(429).json({
        error: 'Trop de tentatives. Réessayez après le délai indiqué.',
        locked: true,
        retry_after_seconds: Number(lock.retry_after_seconds ?? 0),
        lock_hours: Number(lock.lock_hours ?? 0),
        locked_until: lock.locked_until ?? null,
      });
    }

    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!anonKey) {
      logger.error('Clé publique Supabase manquante pour le service de connexion.');
      return res.status(503).json({ error: 'Le service de connexion n’est pas configuré.' });
    }
    const authUrl = `${(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (authResponse.status === 400 || authResponse.status === 401) {
      const authError = await authResponse.json() as { code?: unknown };
      if (authError.code === 'invalid_api_key') {
        logger.error('La clé publique Supabase configurée pour la connexion est invalide.');
        return res.status(503).json({ error: 'Le service de connexion n’est pas correctement configuré.' });
      }
      if (authError.code !== 'invalid_credentials' && authError.code !== 'invalid_grant') {
        return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
      }
      const { data: attemptData, error: attemptError } = await supabase.rpc(
        'record_auth_login_failure',
        rpcParameters
      );
      if (attemptError) throw attemptError;
      const attempt = Array.isArray(attemptData) ? attemptData[0] : attemptData;
      const lockedUntil = attempt?.locked_until ?? null;
      return res.status(lockedUntil ? 429 : 401).json({
        error: lockedUntil
          ? 'Trop de tentatives. Réessayez après le délai indiqué.'
          : 'Adresse e-mail ou mot de passe incorrect.',
        locked: Boolean(lockedUntil),
        failed_attempts: Number(attempt?.failed_attempts ?? 0),
        lock_hours: Number(attempt?.lock_hours ?? 0),
        locked_until: lockedUntil,
      });
    }
    if (authResponse.status === 429) {
      return res.status(429).json({
        error: 'Trop de tentatives. Réessayez plus tard.',
        locked: true,
        retry_after_seconds: Number(authResponse.headers.get('retry-after') ?? 0),
      });
    }
    if (!authResponse.ok) {
      logger.error('Le service Supabase Auth a refusé la connexion', { status: authResponse.status });
      return res.status(502).json({ error: 'Le service de connexion est momentanément indisponible.' });
    }

    const session = await authResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      [key: string]: unknown;
    };
    if (!session.access_token || !session.refresh_token) {
      logger.error('Réponse de connexion Supabase incomplète.');
      return res.status(502).json({ error: 'Le service de connexion a renvoyé une réponse invalide.' });
    }

    const { error: clearError } = await supabase.rpc('clear_auth_login_lock', {
      p_bucket_hash: bucketHash,
    });
    if (clearError) {
      logger.error('Connexion réussie, mais réinitialisation du compteur impossible', {
        error: clearError.message,
      });
    }
    return res.json({ session });
  } catch (error) {
    logFailure('Authentification sécurisée impossible', error);
    return res.status(503).json({ error: 'Impossible de vérifier temporairement la sécurité de la connexion.' });
  }
}

export async function resolveLoginSecurityEvent(req: Request, res: Response) {
  const eventId = req.params.id;
  const adminId = (req as AuthenticatedRequest).user?.id;
  if (!UUID_RE.test(eventId) || !adminId) {
    return res.status(400).json({ error: 'Identifiant d’alerte invalide.' });
  }

  const { data, error } = await supabase
    .from('auth_login_security_events')
    .update({ resolved_at: new Date().toISOString(), resolved_by: adminId })
    .eq('id', eventId)
    .is('resolved_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    logFailure('Clôture d’une alerte de connexion impossible', error);
    return res.status(500).json({ error: 'Impossible de clôturer cette alerte.' });
  }
  if (!data) return res.status(404).json({ error: 'Alerte introuvable ou déjà clôturée.' });
  return res.json({ success: true });
}
