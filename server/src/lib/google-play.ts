import { createHmac } from 'crypto';
import { JWT, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const ANDROID_PUBLISHER_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const subscriptionSchema = z.object({
  subscriptionState: z.string(),
  startTime: z.string().optional(),
  lineItems: z.array(z.object({
    productId: z.string(),
    expiryTime: z.string().optional(),
  })).min(1),
  externalAccountIdentifiers: z.object({
    obfuscatedExternalAccountId: z.string().optional(),
  }).optional(),
});

export type GooglePlaySubscriptionStatus =
  | 'active'
  | 'grace_period'
  | 'canceled'
  | 'on_hold'
  | 'paused'
  | 'expired';

export type VerifiedGooglePlaySubscription = {
  productIds: string[];
  status: GooglePlaySubscriptionStatus;
  startTime: string | null;
  expiryTime: string;
  obfuscatedAccountId: string | null;
};

const getServiceAccountCredentials = () => {
  const rawCredentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new Error('Google Play verification is not configured.');
  }

  let parsedCredentials: unknown;
  try {
    parsedCredentials = JSON.parse(rawCredentials);
  } catch {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must contain valid JSON.');
  }

  const credentials = serviceAccountSchema.safeParse(parsedCredentials);
  if (!credentials.success) {
    throw new Error('Google Play service account credentials are incomplete.');
  }

  return {
    clientEmail: credentials.data.client_email,
    privateKey: credentials.data.private_key.replace(/\\n/g, '\n'),
  };
};

const getGoogleAuth = () => {
  const credentials = getServiceAccountCredentials();
  return new JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: [ANDROID_PUBLISHER_SCOPE],
  });
};

export const getGooglePlayPackageName = () => {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.artisants.app';
  if (!/^[A-Za-z0-9._]+$/.test(packageName)) {
    throw new Error('GOOGLE_PLAY_PACKAGE_NAME is invalid.');
  }
  return packageName;
};

export const createGooglePlayObfuscatedAccountId = (userId: string) => {
  const credentials = getServiceAccountCredentials();
  return createHmac('sha256', credentials.privateKey)
    .update(`${getGooglePlayPackageName()}:${userId}`)
    .digest('hex');
};

export const verifyGooglePlaySubscription = async (
  purchaseToken: string,
): Promise<VerifiedGooglePlaySubscription> => {
  const auth = getGoogleAuth();
  const accessTokenResult = await auth.getAccessToken();
  if (!accessTokenResult.token) {
    throw new Error('Google Play authorization could not be completed.');
  }

  const url = `${ANDROID_PUBLISHER_BASE}/applications/${encodeURIComponent(getGooglePlayPackageName())}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessTokenResult.token}` },
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Google Play verification failed (${response.status}): ${responseBody.slice(0, 500)}`);
  }

  let decodedBody: unknown;
  try {
    decodedBody = JSON.parse(responseBody);
  } catch {
    throw new Error('Google Play returned an unreadable subscription response.');
  }

  const parsed = subscriptionSchema.safeParse(decodedBody);
  if (!parsed.success) {
    throw new Error('Google Play returned incomplete subscription details.');
  }

  const lineItems = parsed.data.lineItems
    .filter((item) => !!item.expiryTime && Number.isFinite(Date.parse(item.expiryTime)));
  const latestLineItem = lineItems.sort((left, right) =>
    Date.parse(right.expiryTime ?? '') - Date.parse(left.expiryTime ?? ''),
  )[0];
  const inactiveStates = [
    'SUBSCRIPTION_STATE_EXPIRED',
    'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
    'SUBSCRIPTION_STATE_PENDING',
  ];
  const expiryTime = latestLineItem?.expiryTime ??
    (inactiveStates.includes(parsed.data.subscriptionState) ? new Date().toISOString() : null);
  if (!expiryTime) {
    throw new Error('Google Play subscription has no valid expiry date.');
  }
  const currentProductIds = latestLineItem
    ? lineItems.filter((item) => item.expiryTime === expiryTime).map((item) => item.productId)
    : parsed.data.lineItems.map((item) => item.productId);

  const states: Record<string, GooglePlaySubscriptionStatus> = {
    SUBSCRIPTION_STATE_ACTIVE: 'active',
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period',
    SUBSCRIPTION_STATE_CANCELED: 'canceled',
    SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
    SUBSCRIPTION_STATE_PAUSED: 'paused',
    SUBSCRIPTION_STATE_EXPIRED: 'expired',
    SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'expired',
    SUBSCRIPTION_STATE_PENDING: 'expired',
  };
  const status = states[parsed.data.subscriptionState];
  if (!status) {
    throw new Error(`Google Play subscription is not ready (${parsed.data.subscriptionState}).`);
  }

  return {
    productIds: currentProductIds,
    status: Date.parse(expiryTime) <= Date.now() ? 'expired' : status,
    startTime: parsed.data.startTime ?? null,
    expiryTime,
    obfuscatedAccountId: parsed.data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
  };
};

export const verifyGooglePlayNotificationToken = async (
  idToken: string,
): Promise<{ email: string }> => {
  const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  if (!audience) {
    throw new Error('GOOGLE_PLAY_RTDN_AUDIENCE is not configured.');
  }

  const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.email_verified || !payload.email) {
    throw new Error('Google Play notification token has no verified service identity.');
  }

  return { email: payload.email };
};

export const getGooglePlayNotificationEmail = () => process.env.GOOGLE_PLAY_RTDN_EMAIL;
