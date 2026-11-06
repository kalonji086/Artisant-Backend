import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_MONITOR_URL = 'https://artisant-backend.onrender.com/api/v1/health';
const ALERT_RECIPIENT = 'togethertechsupport@gmail.com';
const REQUEST_TIMEOUT_MS = 10_000;

const monitorUrl = process.env.MONITOR_URL || DEFAULT_MONITOR_URL;
const brevoApiKey = process.env.BREVO_API_KEY;
const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@artisants.com';
const stateFile = process.env.MONITOR_STATE_FILE || '.monitor-state/state.json';

function requireEnvironment(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function getPreviousState() {
  let contents;
  try {
    contents = await readFile(stateFile, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const { value } = JSON.parse(contents);
  if (value !== 'up' && value !== 'down') {
    throw new Error(`Unexpected value in monitor state file ${stateFile}`);
  }
  return value;
}

async function saveState(state) {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify({ value: state }), 'utf8');
  await rename(temporaryFile, stateFile);
}

async function checkApi() {
  const url = new URL(monitorUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('MONITOR_URL must use HTTP or HTTPS');
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Health endpoint returned HTTP ${response.status}`);
  }

  let health;
  try {
    health = await response.json();
  } catch {
    throw new Error('Health endpoint did not return valid JSON');
  }
  if (health.status !== 'ok') {
    throw new Error('Health endpoint returned an unexpected status');
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendAlert(state, detail) {
  const isDown = state === 'down';
  const subject = isDown
    ? '[ARTISANTS] API indisponible'
    : '[ARTISANTS] API de nouveau disponible';
  const message = isDown
    ? `L’API ARTISANTS ne répond pas correctement. Détail : ${detail}`
    : 'L’API ARTISANTS répond de nouveau correctement.';
  const safeMessage = escapeHtml(message);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'ARTISANTS Monitor', email: senderEmail },
      to: [{ email: ALERT_RECIPIENT }],
      subject,
      textContent: `${message}\nURL surveillée : ${monitorUrl}\nDate : ${new Date().toISOString()}`,
      htmlContent: `<p>${safeMessage}</p><p>URL surveillée : ${escapeHtml(monitorUrl)}</p><p>Date : ${new Date().toISOString()}</p>`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo returned HTTP ${response.status}: ${body}`);
  }
}

async function main() {
  requireEnvironment('BREVO_API_KEY', brevoApiKey);

  const previousState = await getPreviousState();
  let currentState = 'up';
  let detail = 'API répond normalement.';

  try {
    await checkApi();
  } catch (error) {
    currentState = 'down';
    detail = error instanceof Error ? error.message : String(error);
    console.error(`API check failed: ${detail}`);
  }

  const shouldNotify = previousState === null
    ? currentState === 'down'
    : previousState !== currentState;

  if (shouldNotify) {
    await sendAlert(currentState, detail);
    console.log(`Sent ${currentState} notification to ${ALERT_RECIPIENT}.`);
  } else {
    console.log(`API state unchanged: ${currentState}.`);
  }

  if (previousState !== currentState) {
    await saveState(currentState);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
