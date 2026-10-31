# Promouvoir un Compte en Administrateur

## 🎯 Problème
Tu recois : **"Accès réservé aux administrateurs"**

Cela signifie que ton compte utilisateur n'a pas le rôle `admin` dans la base de données.

---

## ✅ Solution

### Étape 1 : Va dans Supabase SQL Editor

1. Ouvre [supabase.com](https://supabase.com)
2. Sélectionne ton projet
3. Va dans **SQL Editor** (à gauche)
4. Clique sur **+ New Query**

### Étape 2 : Copie ce script

```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'TON_EMAIL_ICI'
);
```

**Remplace `TON_EMAIL_ICI` par ton vrai email** (celui que tu utilises pour te connecter)

Exemple :
```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'jean.dupont@example.com'
);
```

### Étape 3 : Exécute le script

1. Clique sur le bouton bleu **RUN** (en haut à droite)
2. Tu devrais voir : `Rows Updated: 1`

### Étape 4 : Vérifie que c'est correct

Exécute cette requête pour vérifier :

```sql
SELECT p.id, au.email, p.role, p.full_name
FROM profiles p
JOIN auth.users au ON p.id = au.id
WHERE au.email = 'TON_EMAIL_ICI';
```

Tu devrais voir une ligne avec `role: admin` ✓

### Étape 5 : Recharge le dashboard

1. Va sur https://artisant-backend.onrender.com/admin/login
2. Déconnecte-toi si tu es connecté
3. Reconnecte-toi avec le même email
4. Tu devrais avoir accès au dashboard Admin ! 🎉

---

## 🔍 Dépannage

### "Rows Updated: 0" 
- ✗ Cela signifie que l'email n'existe pas dans la base
- ✓ Assure-toi que tu utilises le bon email
- ✓ Vérifie dans l'onglet **Profiles** de Supabase

### Toujours "Accès réservé aux administrateurs"
- ✓ Redéploie le backend sur Render (le changement de rôle peut prendre quelques secondes)
- ✓ Vide le cache de ton navigateur (Ctrl+Shift+Delete)
- ✓ Essaie un autre navigateur

---

## 📝 Créer d'autres admins

Pour promouvoir un autre utilisateur en admin, répète simplement l'étape 2-3 avec son email :

```sql
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'autre.utilisateur@example.com'
);
```

