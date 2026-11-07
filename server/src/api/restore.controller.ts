import { Request, Response, NextFunction } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { firstRpcRow, formatLoginLockout } from '../lib/login-lockout';

const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.artisants.app';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'ARTISANTS';

type AuthenticatedRequest = Request & { user?: { id: string } };

// Empreinte(s) SHA-256 du/des certificats de signature Android (format Play Console : AA:BB:...)
// Ex : ANDROID_CERT_SHA256=AA:BB:...,CC:DD:... (upload key + Play App Signing key)
const getCertFingerprints = (): string[] =>
  (process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((s) => s.trim().replace(/:/g, '').toLowerCase())
    .filter(Boolean);

const toBase64Url = (hex: string) => Buffer.from(hex, 'hex').toString('base64url');

const getRpId = (): string => {
  if (process.env.RESTORE_RP_ID) return process.env.RESTORE_RP_ID;
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';
  return base ? new URL(base).hostname : 'localhost';
};

// Origines Android attendues par WebAuthn : android:apk-key-hash:<base64url(sha256(cert))>
const getExpectedOrigins = (): string[] =>
  getCertFingerprints().map((hex) => `android:apk-key-hash:${toBase64Url(hex)}`);

const b64uToBytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
const bytesToB64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

const challengeFromResponse = (response: { response: { clientDataJSON: string } }): string | null => {
  try {
    const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
    return typeof clientData.challenge === 'string' ? clientData.challenge : null;
  } catch {
    return null;
  }
};

const saveChallenge = async (challenge: string, purpose: 'registration' | 'authentication', userId: string | null) => {
  await supabase.from('webauthn_challenges').delete().lt('expires_at', new Date().toISOString());
  const { error } = await supabase.from('webauthn_challenges').insert({
    challenge,
    purpose,
    user_id: userId,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Sauvegarde du challenge impossible: ${error.message}`);
};

// Un challenge n'est utilisable qu'une seule fois (anti-rejeu).
const consumeChallenge = async (challenge: string, purpose: 'registration' | 'authentication') => {
  const { data, error } = await supabase
    .from('webauthn_challenges')
    .delete()
    .eq('challenge', challenge)
    .eq('purpose', purpose)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

const requireConfig = (res: Response): boolean => {
  if (getExpectedOrigins().length === 0) {
    res.status(503).json({ error: 'Restauration non configurée (ANDROID_CERT_SHA256 manquant)' });
    return false;
  }
  return true;
};

/** POST /auth/restore/registration-options (authentifié) */
export const getRegistrationOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireConfig(res)) return;
    const userId = (req as AuthenticatedRequest).user!.id;
    const { data: user } = await supabase.auth.admin.getUserById(userId);
    if (!user?.user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const { data: existing } = await supabase
      .from('restore_credentials')
      .select('credential_id, transports')
      .eq('user_id', userId);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(),
      userName: user.user.email || userId,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      excludeCredentials: (existing || []).map((c) => ({
        id: c.credential_id,
        transports: (c.transports || undefined) as any,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
    });

    await saveChallenge(options.challenge, 'registration', userId);
    res.json(options);
  } catch (err) {
    next(err);
  }
};

/** POST /auth/restore/register (authentifié) */
export const registerRestoreCredential = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireConfig(res)) return;
    const userId = (req as AuthenticatedRequest).user!.id;
    const response = req.body as RegistrationResponseJSON;
    const challenge = challengeFromResponse(response);
    const stored = challenge ? await consumeChallenge(challenge, 'registration') : null;
    if (!stored || stored.user_id !== userId) {
      return res.status(400).json({ error: 'Challenge invalide ou expiré' });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge!,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Vérification de la clé impossible' });
    }

    const { credential } = verification.registrationInfo;
    const { error } = await supabase.from('restore_credentials').insert({
      user_id: userId,
      credential_id: credential.id,
      public_key: bytesToB64u(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
    });
    if (error) throw new Error(error.message);

    logger.info('Clé de restauration enregistrée', { userId });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};

/** POST /auth/restore/authentication-options (public) */
export const getAuthenticationOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireConfig(res)) return;
    const options = await generateAuthenticationOptions({
      rpID: getRpId(),
      userVerification: 'required',
      allowCredentials: [],
    });
    await saveChallenge(options.challenge, 'authentication', null);
    res.json(options);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/restore/authenticate (public)
 * Vérifie la signature de la clé restaurée puis renvoie un token magic link à usage unique.
 * Le client l'échange via supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }).
 */
export const authenticateWithRestoreCredential = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!requireConfig(res)) return;
    const response = req.body as AuthenticationResponseJSON;
    const invalid = () => res.status(401).json({ error: 'Restauration impossible' });

    const challenge = challengeFromResponse(response);
    const stored = challenge ? await consumeChallenge(challenge, 'authentication') : null;
    if (!stored) return invalid();

    const { data: row } = await supabase
      .from('restore_credentials')
      .select('id, user_id, credential_id, public_key, counter, transports')
      .eq('credential_id', response.id)
      .maybeSingle();
    if (!row) return invalid();

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge!,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: b64uToBytes(row.public_key),
        counter: Number(row.counter),
        transports: (row.transports || undefined) as any,
      },
    });
    if (!verification.verified) return invalid();

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_suspended')
      .eq('id', row.user_id)
      .maybeSingle();
    if (profile?.is_suspended) {
      return res.status(403).json({ error: 'Compte suspendu' });
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(row.user_id);
    const email = authUser?.user?.email;
    if (!email) return invalid();

    const { data: lockoutData, error: lockoutError } = await supabase.rpc('get_auth_login_lockout', {
      p_email: email,
    });
    if (lockoutError) throw new Error(`Vérification du verrouillage impossible: ${lockoutError.message}`);
    const lockout = firstRpcRow(lockoutData);
    if (lockout?.locked_until && Date.parse(lockout.locked_until) > Date.now()) {
      const { data: retryData, error: retryError } = await supabase.rpc('record_auth_login_failure', {
        p_email: email,
      });
      if (retryError) throw new Error(`Mise à jour du verrouillage impossible: ${retryError.message}`);
      const retryState = firstRpcRow(retryData);
      return res.status(423).json({
        error: formatLoginLockout(retryState?.locked_until ?? lockout.locked_until),
      });
    }

    const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkError || !link?.properties?.hashed_token) throw new Error(linkError?.message || 'Lien indisponible');

    await supabase
      .from('restore_credentials')
      .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
      .eq('id', row.id);

    res.json({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  } catch (err) {
    next(err);
  }
};

/** GET /.well-known/assetlinks.json : lie le domaine (RP ID) à l'application Android */
export const getAssetLinks = (_req: Request, res: Response) => {
  const fingerprints = getCertFingerprints().map((hex) =>
    hex.match(/.{2}/g)!.join(':').toUpperCase()
  );
  res.json([
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
};
