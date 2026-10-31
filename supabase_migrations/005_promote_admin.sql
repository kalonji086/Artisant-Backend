-- ========================================
-- Promouvoir un utilisateur en ADMIN
-- ========================================
-- Instructions:
-- 1. Va sur supabase.com → Ton projet → SQL Editor
-- 2. Crée une nouvelle requête
-- 3. Remplace 'wecanconcept@gmail.com' par TON EMAIL
-- 4. Copie-colle ce script
-- 5. Clique sur "RUN"

UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'wecanconcept@gmail.com'
);

-- Vérifie que c'est correct:
SELECT p.id, au.email, p.role, p.full_name
FROM profiles p
JOIN auth.users au ON p.id = au.id
WHERE au.email = 'wecanconcept@gmail.com';
