const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '../..');

function getEnvFile(args) {
  const index = args.indexOf('--env-file');
  if (index === -1) return path.join(repositoryRoot, '.env.local');

  const file = args[index + 1];
  if (!file || file.startsWith('--')) {
    throw new Error('Utilisation : npm --prefix server run admin:create -- --env-file <fichier>');
  }

  return path.resolve(repositoryRoot, file);
}

function validateConfiguration() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key || /^(replace_with|your-|placeholder)/i.test(key)) {
    throw new Error(
      'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY est absent ou contient encore une valeur exemple.'
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL doit être une URL valide.');
  }

  if (
    parsedUrl.protocol !== 'https:' &&
    !(parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname))
  ) {
    throw new Error('SUPABASE_URL doit utiliser HTTPS, sauf pour un projet local.');
  }

  if (key.startsWith('sb_secret_')) return { url, key };

  if (!key.startsWith('eyJ')) {
    throw new Error('La clé backend doit être une clé Supabase secret ou service_role, pas une clé anon.');
  }

  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (claims.role !== 'service_role') {
      throw new Error('La clé JWT fournie n’a pas le rôle service_role.');
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY n’est pas un JWT Supabase valide.');
    }
    throw error;
  }

  return { url, key };
}

function ask(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Le mot de passe doit être saisi dans un terminal interactif.'));
  }

  process.stdout.write(question);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Saisie annulée.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    input.on('data', onData);
  });
}

async function findUserByEmail(client, email) {
  const perPage = 1000;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Impossible de rechercher le compte : ${error.message}`);

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) return null;
  }

  throw new Error('La recherche a dépassé 100 000 comptes; arrêt sans modification.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Crée un compte Supabase Auth et lui attribue le rôle admin.\n' +
        'Par défaut, utilise .env.local à la racine du dépôt.\n' +
        'Option : --env-file <fichier relatif à la racine ou chemin absolu>.'
    );
    return;
  }

  const envFile = getEnvFile(args);
  if (!fs.existsSync(envFile)) {
    throw new Error(`Fichier de configuration introuvable : ${envFile}`);
  }
  dotenv.config({ path: envFile });

  if (!args.includes('--env-file')) {
    dotenv.config({ path: path.join(__dirname, '../.env') });
  }

  const { url, key } = validateConfiguration();
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = (await new Promise((resolve) =>
    prompt.question('Email du compte administrateur : ', resolve)
  )).trim().toLowerCase();
  const fullName = (await new Promise((resolve) =>
    prompt.question('Nom affiché : ', resolve)
  )).trim();
  prompt.close();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse email invalide.');
  }
  if (!fullName) throw new Error('Le nom affiché est obligatoire.');

  let user = await findUserByEmail(client, email);
  let created = false;

  if (user && !user.email_confirmed_at) {
    throw new Error(
      'Ce compte existe mais son email n’est pas confirmé. Confirmez-le dans Supabase Auth, puis relancez le script.'
    );
  }

  if (!user) {
    const password = await askHidden('Nouveau mot de passe (12 caractères minimum, saisie masquée) : ');
    if (password.length < 12) throw new Error('Le mot de passe doit contenir au moins 12 caractères.');
    const confirmation = await askHidden('Confirmer le mot de passe : ');
    if (password !== confirmation) throw new Error('Les mots de passe ne correspondent pas.');

    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new Error(`Impossible de créer le compte Auth : ${error.message}`);
    user = data.user;
    created = true;
  }

  const { error } = await client
    .from('profiles')
    .upsert({ id: user.id, full_name: fullName, role: 'admin' }, { onConflict: 'id' });

  if (error) {
    const recovery = created
      ? ` Le compte Auth ${user.id} a été créé; relancez le script après avoir corrigé la table profiles.`
      : '';
    throw new Error(
      `Impossible d’attribuer le rôle admin au profil : ${error.message}. Vérifiez que la migration 001_admin_role.sql a été appliquée.${recovery}`
    );
  }

  console.log(`Compte administrateur prêt : ${email}`);
  console.log('Connectez-vous sur le dashboard Admin avec cet email et son mot de passe.');
}

main().catch((error) => {
  console.error(`Échec : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
