# 🔧 Configuration Supabase - Bugs et Résolution

## 1️⃣ Bug: "Accès réservé aux administrateurs"

### Problème
Quand vous vous connectez au dashboard Admin avec un compte qui devrait être Admin, vous recevez:
```
Accès réservé aux administrateurs : ce compte n'a pas le rôle admin.
```

### Cause
Votre compte utilisateur n'a pas le rôle `admin` dans la table `profiles` de Supabase.

### Solution - 3 étapes simples

#### Étape 1 : Ouvrir le SQL Editor de Supabase
1. Allez sur [supabase.com](https://supabase.com)
2. Sélectionnez votre projet ARTISANTS
3. Cliquez sur **SQL Editor** (à gauche)
4. Cliquez sur **+ New Query**

#### Étape 2 : Exécuter le script de promotion Admin

Remplacez `votre-email@exemple.com` par votre email réel :

```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'votre-email@exemple.com'
);
```

**Exemple concret :**
```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'jean.dupont@gmail.com'
);
```

#### Étape 3 : Vérifier que c'est correct

Exécutez cette requête pour confirmer :

```sql
SELECT p.id, au.email, p.role, p.full_name
FROM profiles p
JOIN auth.users au ON p.id = au.id
WHERE au.email = 'votre-email@exemple.com';
```

Vous devriez voir une ligne avec **`role: admin`** ✓

#### Étape 4 : Rafraîchir le dashboard

1. Allez sur [artisant-backend.onrender.com/admin/login](https://artisant-backend.onrender.com/admin/login)
2. Déconnectez-vous si vous êtes connecté
3. Reconnectez-vous avec votre email
4. Accès au dashboard Admin accordé ! 🎉

---

## 2️⃣ Tables manquantes dans la base de données

### Problème
Quand vous utilisez l'application ou le dashboard, certaines tables SQL peuvent manquer, causant des erreurs.

### Solution - Créer automatiquement les tables

#### Option A : Utiliser le script SQL complet (Recommandé)

1. Ouvrez le fichier **`DATABASE_SETUP.sql`** à la racine du projet
2. Copiez son contenu complet
3. Allez sur Supabase → SQL Editor
4. Collez le script
5. Cliquez sur **RUN** ✓

#### Option B : Utiliser l'endpoint API du dashboard

Si vous êtes Admin, vous pouvez appeler :

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://artisant-backend.onrender.com/api/v1/admin/db-status
```

Cela retournera les instructions complètes pour créer les tables.

---

## 3️⃣ Vérification finale

### Confirmer que tout fonctionne

Exécutez dans Supabase SQL Editor :

```sql
-- Vérifier les tables essentielles
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'categories', 'services', 'quotes', 
                     'employer_requests', 'artisan_services', 'platform_settings')
ORDER BY table_name;
```

Vous devriez voir **7 tables** (ou 8 si `auth.users` compte).

### Tables attendues
- ✓ `profiles` - Profils utilisateurs
- ✓ `categories` - Catégories de services
- ✓ `services` - Services/métiers
- ✓ `quotes` - Devis
- ✓ `employer_requests` - Demandes d'accès employeur
- ✓ `artisan_services` - Services des artisans
- ✓ `platform_settings` - Paramètres admin

---

## 4️⃣ Dépannage

### "Rows updated: 0" lors de la promotion Admin

**Problème** : L'email n'existe pas dans la base

**Solutions** :
1. ✅ Vérifiez l'orthographe exacte de votre email
2. ✅ Cherchez votre utilisateur dans Supabase → Database → profiles
3. ✅ Assurez-vous que vous vous êtes inscrit à au moins une fois

### Toujours "Accès réservé" après le changement

**Solutions** :
1. 🔄 Redéployez sur Render (Settings → Redeploy Latest)
2. 🔄 Videz le cache navigateur (Ctrl+Shift+Delete)
3. 🔄 Essayez un autre navigateur
4. 🔄 Redémarrez votre appareil

### Tables encore manquantes après le script SQL

**Solutions** :
1. ✅ Vérifiez que le script SQL a bien exécuté (regardez "Query executed successfully")
2. ✅ Vérifiez les permissions RLS sur les tables
3. ✅ Assurez-vous que vous avez accès au schéma `public`

---

## 5️⃣ Pour ajouter d'autres admins

Répétez l'Étape 2 ci-dessus avec l'email de chaque administrateur :

```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'autre-admin@exemple.com'
);
```

---

## 🚀 Besoin d'aide ?

- Consultez [Supabase Docs](https://supabase.com/docs)
- Vérifiez les logs Render : Dashboard → Logs
- Vérifiez les logs Supabase : Database → Logs

**Succès !** Votre système est maintenant configuré correctement. 🎉
