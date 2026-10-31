# Configuration Render - Guide Complet

## 🔐 Variables d'Environnement Supabase

Pour que le dashboard Admin fonctionne correctement, tu dois configurer les variables d'environnement sur Render.

### Étape 1 : Récupère tes clés Supabase

1. Va sur [supabase.com](https://supabase.com)
2. Ouvre ton projet Supabase
3. Va dans **Settings → API**
4. Copie les valeurs suivantes :
   - **Project URL** → `SUPABASE_URL`
   - **Service Role secret** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ GARDEZ SECRÈTE)
   - **anon public** → `VITE_SUPABASE_ANON_KEY`

### Étape 2 : Configure les variables sur Render

1. Va sur [render.com](https://render.com)
2. Sélectionne ton service **artisans-api**
3. Clique sur **Environment**
4. Ajoute/Modifie les variables suivantes :

| Variable | Valeur | Type |
|----------|--------|------|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Secrète |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé de service trouvée en Settings → API | Secrète ✔️ |
| `SUPABASE_WEBHOOK_SECRET` | Optionnel (laisse vide si non utilisé) | Secrète |
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` | Publique |
| `VITE_SUPABASE_ANON_KEY` | Clé anon publique | Publique |
| `CORS_ORIGINS` | URL de ton frontend sépaée par des virgules | Publique |

### Étape 3 : Redéploie

1. Clique sur **Manual Deploy** → **Deploy latest commit**
2. Ou pousse une nouvelle version vers `main`

---

## ✅ Vérification

Après le déploiement :
1. Va sur `https://artisant-backend.onrender.com/admin/login`
2. Vérifie les logs pour voir si les erreurs d'authentification disparaissent
3. Essaie de te connecter avec un compte admin

---

## 🐛 Dépannage

### Erreur : "Invalid API key"
- ✓ Vérifie que `SUPABASE_SERVICE_ROLE_KEY` est défini et correct
- ✓ Assure-toi que ce n'est pas la clé anon mais la clé de service
- ✓ Vérifie qu'il n'y a pas d'espaces avant/après

### Erreur : "Cannot Get /login"
- ✓ C'est déjà corrigé dans la dernière version
- ✓ Redéploie pour appliquer le correctif

### Le dashboard se charge mais me déconnecte aussitôt
- ✓ Vérifie que le compte utilisé a le rôle `admin` dans la base de données
- ✓ Exécute : `SELECT * FROM profiles WHERE role = 'admin';` dans Supabase

---

## 📝 Notes

- **SUPABASE_SERVICE_ROLE_KEY** est une clé sensible ! Marque-la toujours comme "Secrète" sur Render
- Les variables publiques (**VITE_***) sont incluses dans le bundle frontend
- **Ne commite jamais** les clés secrètes dans Git !

