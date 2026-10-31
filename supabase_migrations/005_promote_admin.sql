-- ========================================
-- Promouvoir un utilisateur en ADMIN
-- ========================================
-- Instructions:
-- 1. Va sur supabase.com → Ton projet → SQL Editor
-- 2. Crée une nouvelle requête
-- 3. Remplace 'votre-email@example.com' par VOTRE EMAIL
-- 4. Copie-colle ce script
-- 5. Clique sur "RUN"

UPDATE profiles
SET role = 'admin'
WHERE email = 'votre-email@example.com';

-- Vérifie que c'est correct:
SELECT id, email, role, full_name FROM profiles WHERE email = 'votre-email@example.com';
