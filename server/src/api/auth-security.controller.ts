import { createHash, createHmac } from 'crypto';
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
      let authError: { code?: unknown; error_code?: unknown; message?: unknown } = {};
      try {
        authError = await authResponse.json() as typeof authError;
      } catch {
        logger.warn('Réponse de refus Supabase Auth non JSON lors d’une connexion.');
      }
      const authCode = authError.code ?? authError.error_code;
      if (authCode === 'invalid_api_key' || /invalid api key/i.test(String(authError.message ?? ''))) {
        logger.error('La clé publique Supabase configurée pour la connexion est invalide.');
        return res.status(503).json({ error: 'Le service de connexion n’est pas correctement configuré.' });
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
  logger.info('Alerte de sécurité clôturée par un administrateur', { adminId, eventId });
  return res.json({ success: true });
}

export async function getLoginSecurityEvents(req: Request, res: Response) {
  const status = typeof req.query.status === 'string' ? req.query.status : 'open';
  const search = typeof req.query.search === 'string'
    ? req.query.search.replace(/[(),]/g, ' ').trim().slice(0, 120)
    : '';
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);
  if (!['open', 'resolved', 'all'].includes(status)) {
    return res.status(400).json({ error: 'Filtre d’alerte invalide.' });
  }
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    return res.status(400).json({ error: 'Pagination invalide.' });
  }

  try {
    const from = (page - 1) * pageSize;
    let query = supabase
      .from('auth_login_security_events')
      .select('id, created_at, user_id, masked_identifier, ip_address, platform, device_model, failed_attempts, lock_hours, locked_until, resolved_at, resolved_by', { count: 'exact' });
    if (status === 'open') query = query.is('resolved_at', null);
    if (status === 'resolved') query = query.not('resolved_at', 'is', null);
    if (search) query = query.ilike('masked_identifier', `%${search}%`);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    const rows = data ?? [];
    const userIds = [...new Set(rows.flatMap((event) => event.user_id ? [event.user_id] : []))];
    const profileResult = userIds.length
      ? await supabase.from('profiles').select('id, full_name, role').in('id', userIds)
      : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
    const blockedStatuses = await Promise.all(userIds.map(async (userId) => {
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
      if (authError) throw authError;
      const bannedUntil = authUser.user?.banned_until;
      return [
        userId,
        typeof bannedUntil === 'string' && Date.parse(bannedUntil) > Date.now(),
      ] as const;
    }));
    const blockedById = new Map(blockedStatuses);

    return res.json({
      data: rows.map((event) => ({
        ...event,
        user: event.user_id ? profiles.get(event.user_id) ?? null : null,
        is_blocked: event.user_id ? blockedById.get(event.user_id) ?? false : false,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    });
  } catch (error) {
    logFailure('Chargement du centre de sécurité impossible', error);
    return res.status(500).json({ error: 'Impossible de charger les alertes de sécurité.' });
  }
}

function getDeviceReference(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskPushToken(token: string): string {
  return `••••${token.slice(-4)}`;
}

export async function getUserPushDevices(req: Request, res: Response) {
  const userId = req.params.id;
  if (!UUID_RE.test(userId)) return res.status(400).json({ error: 'Identifiant utilisateur invalide.' });

  try {
    const [devicesResult, revocationsResult] = await Promise.all([
      supabase
        .from('push_devices')
        .select('expo_push_token, platform, created_at, updated_at')
        .eq('user_id', userId),
      supabase
        .from('push_device_revocations')
        .select('token_hash, token_hint, platform, revoked_at')
        .eq('user_id', userId),
    ]);
    if (devicesResult.error) throw devicesResult.error;
    if (revocationsResult.error) throw revocationsResult.error;

    const revocations = revocationsResult.data ?? [];
    const revokedByHash = new Map(revocations.map((item) => [item.token_hash, item]));
    const activeDevices = (devicesResult.data ?? [])
      .filter((device) => !revokedByHash.has(getDeviceReference(device.expo_push_token)))
      .map((device) => ({
        device_ref: getDeviceReference(device.expo_push_token),
        token_hint: maskPushToken(device.expo_push_token),
        platform: device.platform,
        created_at: device.created_at,
        updated_at: device.updated_at,
        revoked_at: null,
      }));
    const revokedDevices = revocations.map((device) => ({
      device_ref: device.token_hash,
      token_hint: device.token_hint,
      platform: device.platform,
      created_at: null,
      updated_at: device.revoked_at,
      revoked_at: device.revoked_at,
    }));
    return res.json({
      data: [...activeDevices, ...revokedDevices]
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    });
  } catch (error) {
    logFailure('Chargement des appareils push impossible', error);
    return res.status(500).json({ error: 'Impossible de charger les appareils enregistrés.' });
  }
}

export async function removeUserPushDevice(req: Request, res: Response) {
  const userId = req.params.id;
  const deviceRef = req.params.deviceRef;
  if (!UUID_RE.test(userId) || !/^[0-9a-f]{64}$/i.test(deviceRef)) {
    return res.status(400).json({ error: 'Identifiant utilisateur ou appareil invalide.' });
  }

  try {
    const { data: devices, error: listError } = await supabase
      .from('push_devices')
      .select('expo_push_token, platform')
      .eq('user_id', userId);
    if (listError) throw listError;
    const device = (devices ?? []).find(
      (item) => getDeviceReference(item.expo_push_token) === deviceRef
    );
    if (!device) return res.status(404).json({ error: 'Appareil enregistré introuvable.' });

    const { error: revokeError } = await supabase
      .from('push_device_revocations')
      .upsert({
        user_id: userId,
        token_hash: deviceRef,
        token_hint: maskPushToken(device.expo_push_token),
        platform: device.platform,
        revoked_at: new Date().toISOString(),
        revoked_by: (req as AuthenticatedRequest).user?.id ?? null,
      }, { onConflict: 'user_id,token_hash' });
    if (revokeError) throw revokeError;

    const { data, error } = await supabase
      .from('push_devices')
      .delete()
      .eq('user_id', userId)
      .eq('expo_push_token', device.expo_push_token)
      .select('expo_push_token')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Appareil enregistré introuvable.' });
    logger.info('Appareil push retiré par un administrateur', {
      adminId: (req as AuthenticatedRequest).user?.id,
      userId,
      deviceRef,
    });
    return res.json({ removed: true, device_ref: deviceRef });
  } catch (error) {
    logFailure('Suppression d’un appareil push impossible', error);
    return res.status(500).json({ error: 'Impossible de supprimer cet appareil enregistré.' });
  }
}

export async function restoreUserPushDevice(req: Request, res: Response) {
  const userId = req.params.id;
  const deviceRef = req.params.deviceRef;
  if (!UUID_RE.test(userId) || !/^[0-9a-f]{64}$/i.test(deviceRef)) {
    return res.status(400).json({ error: 'Identifiant utilisateur ou appareil invalide.' });
  }

  try {
    const { data, error } = await supabase
      .from('push_device_revocations')
      .delete()
      .eq('user_id', userId)
      .eq('token_hash', deviceRef)
      .select('token_hash')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Révocation de cet appareil introuvable.' });
    logger.info('Appareil push réautorisé par un administrateur', {
      adminId: (req as AuthenticatedRequest).user?.id,
      userId,
      deviceRef,
    });
    return res.json({ restored: true, device_ref: deviceRef });
  } catch (error) {
    logFailure('Réautorisation d’un appareil push impossible', error);
    return res.status(500).json({ error: 'Impossible de réautoriser cet appareil.' });
  }
}
