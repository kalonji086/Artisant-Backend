# 🐛 Dépannage - Bug du Dashboard Admin

## Problème : "Accès réservé aux administrateurs" sur le Dashboard

### Symptômes
- ✓ Vous pouvez vous connecter au dashboard admin
- ✓ Vous voyez votre rôle "Admin" en haut de la page
- ✗ Le dashboard affiche l'erreur: "Accès réservé aux administrateurs"
- ✗ Aucun graphique ou statistique n'apparaît

### Causes possibles

#### 1. **Colonne 'role' manquante dans la table 'profiles'**
Le serveur ne peut pas vérifier votre rôle car la table `profiles` n'a pas la colonne `role`.

**Vérification** : Dans Supabase SQL Editor, exécutez :
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' AND column_name = 'role';
```
Vous devriez voir une ligne avec `role`.

**Solution** : Exécutez le **DATABASE_SETUP.sql** fourni (voir section 3 ci-dessous).

---

#### 2. **Politique RLS (Row Level Security) qui bloque le serveur**
La table `profiles` a une politique RLS qui empêche le service-role du serveur d'accéder à votre profil.

**Vérification** : Consultez les logs Supabase :
1. Allez sur supabase.com → Votre projet → Logs → Recent events
2. Cherchez des erreurs "permission denied"

**Solution** : Exécutez le **DATABASE_SETUP.sql** qui corrige les politiques RLS.

---

#### 3. **Profil Admin absent de la base de données**
Vous avez un compte de connexion (`auth.users`) mais pas de profil correspondant dans la table `profiles`.

**Vérification** : Exécutez dans Supabase SQL Editor :
```sql
SELECT au.email, p.id, p.role, p.full_name
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE au.email = 'votre-email@exemple.com';
```

Vous devriez voir une ligne avec votre email et un `role = admin`.

**Solution** : Si le profil est vide (NULL pour les colonnes du profil) :
```sql
INSERT INTO public.profiles (id, full_name, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'votre-email@exemple.com'),
  'Votre Nom',
  'admin'
)
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

---

## ✅ Solution complète en 3 étapes

### Étape 1 : Exécuter le script SQL de configuration

1. Ouvrez [supabase.com](https://supabase.com) → Votre projet → **SQL Editor**
2. Cliquez sur **+ New Query**
3. Copiez-collez **tout le contenu** du fichier `DATABASE_SETUP.sql`
4. Cliquez sur **RUN** (bouton bleu en haut à droite)
5. Vérifiez que vous voyez `executed successfully` ✓

### Étape 2 : Promouvoir votre compte en Admin (si ce n'est pas fait)

Exécutez cette requête pour vérifier/mettre à jour votre rôle :

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'votre-email@exemple.com'
);
```

Puis vérifiez :
```sql
SELECT role, full_name FROM public.profiles 
WHERE id = (SELECT id FROM auth.users WHERE email = 'votre-email@exemple.com');
```

### Étape 3 : Redéployer et rafraîchir

1. **Redéployez le backend** sur Render :
   - Allez sur Render → Select Service → Manual Deploy
   - Cliquez sur **Redeploy Latest**
   - Attendez que le statut passe à **"Live"**

2. **Videz le cache du navigateur** :
   - Appuyez sur `Ctrl+Shift+Delete` (Windows) ou `Cmd+Shift+Delete` (Mac)
   - Sélectionnez "All time"
   - Cliquez sur "Clear data"

3. **Reconnectez-vous** :
   - Allez sur https://artisant-backend.onrender.com/admin/login
   - Entrez vos identifiants
   - Le dashboard devrait maintenant fonctionner ✓

---

## 📋 Vérification - Checklist complète

### ✓ Frontend (Dashboard Admin Web)
- [ ] Je peux me connecter avec mon email
- [ ] Je vois mon rôle "Admin" en haut de la page
- [ ] Je peux naviguer vers d'autres pages (Utilisateurs, Devis, etc.)

### ✓ Backend (Serveur API)
- [ ] La table `profiles` existe dans Supabase
- [ ] La table `profiles` a la colonne `role`
- [ ] Mon profil a `role = 'admin'`
- [ ] Les politiques RLS permettent au service-role d'accéder à `profiles`

### ✓ API Responses
- [ ] `GET /api/v1/admin/stats` retourne 200 (pas 403)
- [ ] `GET /api/v1/admin/users` retourne 200
- [ ] `GET /api/v1/admin/quotes` retourne 200

---

## 🔍 Debugging - Vérifier les erreurs réelles

### Lire les logs du serveur (Render)

1. Allez sur [render.com](https://render.com)
2. Sélectionnez votre service API
3. Cliquez sur **Logs**
4. Cherchez les erreurs avec le mot-clé "admin" ou votre email
5. Vérifiez le message d'erreur exact

**Erreurs courantes** :
- `relation "profiles" does not exist` → La table n'existe pas
- `column "role" does not exist` → La colonne manque
- `permission denied` → Problème RLS

### Tester l'API directement

Ouvrez Postman ou curl et testez :

```bash
# 1. Récupérez votre token (copié depuis le dashboard)
TOKEN="your_session_token"

# 2. Testez la requête stats
curl -H "Authorization: Bearer $TOKEN" \
  https://artisant-backend.onrender.com/api/v1/admin/stats
```

Vous devriez voir les statistiques (200 OK) ou une erreur spécifique.

---

## 🆘 Besoin d'aide supplémentaire?

Si le problème persiste après avoir suivi ces étapes :

1. **Vérifiez les variables d'environnement** sur Render :
   - `SUPABASE_URL` est-elle correcte?
   - `SUPABASE_SERVICE_ROLE_KEY` est-elle correcte?

2. **Vérifiez les permissions Supabase** :
   - Avez-vous accès au SQL Editor de Supabase?
   - Votre projet est-il actif (pas en trial expiré)?

3. **Consult les logs** :
   - Logs Render : Dashboard → Logs
   - Logs Supabase : Database → Logs

4. **Redémarrez le serveur** :
   - Render → Select Service → Settings → Restart
