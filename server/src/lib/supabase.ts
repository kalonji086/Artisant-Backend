import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERREUR CRITIQUE: Variables Supabase manquantes!');
  console.error('- SUPABASE_URL:', supabaseUrl ? '✓ Défini' : '✗ MANQUANT');
  console.error('- SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓ Défini' : '✗ MANQUANT');
  console.error('');
  console.error('Pour configurer sur Render:');
  console.error('1. Va dans Render Dashboard → Select Service → Environment');
  console.error('2. Ajoute les variables d\'environnement:');
  console.error('   - SUPABASE_URL: https://xxxxx.supabase.co');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY: (ta clé de service trouvée dans Supabase Settings > API)');
  console.error('3. Clique sur "Save" et redéploie');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
