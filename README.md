# Basic Pass — coffre personnel

Une petite application responsive pour conserver **tes propres informations de membre** et un QR fourni par l’application Basic-Fit. Le QR peut être ajouté en collant son contenu ou en important une capture d’écran.

L’application ne fabrique pas et ne renouvelle pas de QR Basic-Fit. Les QR de l’application officielle peuvent expirer ; garde l’application Basic-Fit comme moyen d’accès à jour.

## Démarrage

### 1. Préparer Supabase

1. Crée un projet Supabase et récupère son **Project URL** et sa **publishable key** dans le panneau API Keys.
2. Dans l’éditeur SQL de Supabase, exécute [`supabase/migrations/20261014000000_create_member_vault.sql`](supabase/migrations/20261014000000_create_member_vault.sql).
3. Dans Authentication, active le fournisseur **Email**. Tu peux conserver la confirmation d’adresse e-mail activée. Configure aussi l’URL du site et les URL de redirection avec `http://localhost:5173` pour le développement, puis ajoute ton domaine de déploiement.

La migration crée une table avec RLS et un bucket privé. Chaque compte ne peut lire ou modifier que sa propre ligne et ses propres fichiers. La clé `secret` / `service_role` ne doit jamais être mise dans le navigateur.

### 2. Lancer l’application

```sh
npm install
cp .env.example .env.local
```

Renseigne ces variables dans `.env.local` :

```env
VITE_SUPABASE_URL=https://ton-projet.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Puis lance le serveur :

```sh
npm run dev
```

Le navigateur doit être sur `localhost` ou une adresse HTTPS pour utiliser Web Crypto.

Utilise Node.js 20.19 ou plus récent (requis par Vite 8).

## Protection des données

- La connexion à l’application passe par Supabase Auth. Le mot de passe Basic-Fit n’est jamais demandé.
- Au premier accès, crée une **phrase secrète de coffre** d’au moins 12 caractères, différente du mot de passe de connexion. Elle sert à dériver une clé AES-GCM 256 bits dans le navigateur (PBKDF2/SHA-256, 310 000 itérations).
- Le nom, le numéro de membre, le club et le contenu du QR sont chiffrés avant l’envoi vers la base. Les captures d’écran sont chiffrées avant l’envoi dans le bucket privé.
- Le secret de coffre n’est jamais transmis ni sauvegardé. **S’il est oublié, les données chiffrées ne peuvent pas être récupérées.**
- Le coffre se verrouille automatiquement après cinq minutes sans activité. Supabase conserve la session de connexion selon sa configuration ; verrouiller le coffre efface la clé et les données déchiffrées de l’interface.
- La clé publishable est publique par conception ; la sécurité des accès dépend aussi des règles RLS de la migration. N’utilise jamais une clé `secret` ou `service_role` côté navigateur.

> Le chiffrement côté navigateur protège les données stockées au repos contre une lecture directe de la base ou du bucket. Il ne peut pas protéger une session ouverte contre un appareil compromis, une extension malveillante, une faille XSS ou un déploiement du code remplacé. Choisis un hébergeur de confiance et active la MFA sur ton compte Supabase si tu l’utilises.

## QR code

Le contenu collé est seulement affiché sous forme de QR par un encodeur générique. Aucun numéro de carte, identifiant d’appareil, timestamp, hash ou format de QR Basic-Fit n’est calculé par cette application. Une capture d’écran reste une copie statique et peut ne plus fonctionner si le QR officiel a expiré.

## Déploiement

```sh
npm run build
```

Le dossier `dist/` peut être servi comme site statique. Le fichier [`public/_headers`](public/_headers) fournit des en-têtes de sécurité aux hébergeurs compatibles avec ce format ; vérifie que ton hébergeur les applique réellement. La politique CSP autorise les connexions HTTPS/WSS pour le projet Supabase configuré.
