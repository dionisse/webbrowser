# Modèle de sécurité de Nimbus

Ce document décrit ce que Nimbus protège, comment, et — tout aussi important — **ce qu'il ne protège
pas**. Les affirmations sont vérifiables dans le code ; les chemins sont indiqués.

---

## 1. Principe directeur : zero-knowledge

Le serveur Nimbus est un **transporteur d'octets chiffrés** et un **moteur de rendu**. Il n'a pas de
base de données de contenu, pas de clé de chiffrement utilisateur, et pas la capacité de lire une
note, un mot de passe ou un numéro de carte.

Trois conséquences de conception :

1. Toute la crypto utilisateur est faite dans le navigateur (`web/src/lib/crypto.ts`, WebCrypto).
2. Le coffre vit sur **l'espace cloud de l'utilisateur**, pas sur le serveur.
3. Le verrouillage détruit la clé ; il n'existe aucun chemin de récupération côté serveur. Un mot de
   passe maître oublié = un coffre illisible. C'est voulu.

---

## 2. Crypto

### Dérivation

```
masterKey = PBKDF2-SHA256(password, kdf.salt, 310 000 itérations)   // local, jamais envoyé
authHash  = SHA-256(masterKey)                                        // envoyé au serveur
```

Le sel est aléatoire par profil et publié dans l'en-tête du profil (il n'est pas secret). 310 000
itérations correspondent au plancher OWASP courant pour PBKDF2-SHA256 côté client.

### Ce que le serveur stocke

```
authVerifier = SHA-256( authHash ‖ HMAC(serverKey, 'nimbus.auth.pepper.v1') )
```

Le serveur ne stocke donc **ni** le mot de passe, **ni** la clé, **ni** même `authHash` en clair : il
stocke un hash poivré. Une fuite de `server/data/accounts.json` ne permet pas de se faire passer pour
un utilisateur sans connaître `serverKey`.

> Sans `NIMBUS_SERVER_KEY`, la clé serveur est **éphémère** (générée au démarrage) : le poivre change
> à chaque redémarrage et les connexions d'espace cloud scellées deviennent illisibles. Le serveur le
> signale explicitement dans ses journaux. En production, cette variable est obligatoire.

### Chiffrement du coffre

- `AES-GCM-256`, IV aléatoire 12 octets par opération, étiquette d'authentification 128 bits.
- Données additionnelles authentifiées (AAD) : le contexte (`'vault'`), pour empêcher le remplacement
  d'un objet chiffré par un autre.
- Chaque écriture renvoie une empreinte SHA-256 : l'interface affiche `integrityOk` et refuse
  silencieusement un coffre dont l'empreinte ne correspond pas.
- Comparaisons d'empreintes en temps constant (`safeEqual`).

### Changement de mot de passe maître (rekey)

`session.rekey()` : déchiffrement local avec l'ancienne clé, re-chiffrement avec la nouvelle, envoi du
nouvel `authHash` et du nouveau coffre en une seule opération atomique côté serveur
(`PUT /api/profiles/:id/rekey`). Le serveur ne voit jamais les deux clés.

---

## 3. Cycle de vie de la session

| Paramètre | Valeur | Où |
| --- | --- | --- |
| Durée de vie | 15 min glissantes (`NIMBUS_SESSION_TTL_MINUTES`) | `server/src/session/store.ts` |
| Cookie | `nimbus_sid`, `HttpOnly`, `SameSite=Lax`, `Secure` derrière HTTPS, `Path=/` | `server/src/session/middleware.ts` |
| Stockage des sessions | mémoire uniquement — rien n'est écrit sur disque | idem |
| Verrouillage automatique | réglable de 0 (jamais) à 60 min dans le coffre | `web/src/state/session.ts` |
| Verrouillage à la perte de focus | option `lockOnBlur` | idem |
| Fermeture de l'onglet | `watchUnload()` verrouille | idem |
| Force brute | 8 tentatives par profil et par IP → 15 min de blocage | `server/src/routes/profiles.ts` |

### Le verrouillage est destructif

`lockSession()` ne se contente pas de changer un drapeau :

```ts
session.phase = 'anonymous';
session.browseToken = null;                       // le jeton de rendu meurt
session.scratch = { cacheKeys: [], downloadIds: [] };  // cache de rendu + fichiers en attente oubliés
```

Côté navigateur : la clé est oubliée (`forgetKey`), le coffre en mémoire est remis à `null`, les
compteurs repartent à zéro. Vérifié : un ancien jeton de rendu renvoie `401` après verrouillage.

---

## 4. Isolation du rendu

C'est le point le plus délicat du produit : afficher une page web hostile **dans** l'application sans
lui donner accès au coffre.

### Le cadre

```html
<iframe
  sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
  referrerpolicy="no-referrer"
  src="/api/browse/view?u=<url>&t=<jeton de session>"
/>
```

**`allow-same-origin` est volontairement absent.** Le document rendu vit donc dans une origine opaque :

- impossible d'atteindre `window.parent.document`, le DOM de la coque, ses stores ou ses `localStorage` ;
- impossible de lire les cookies de session (d'où le jeton dans l'URL) ;
- `allow-scripts` reste nécessaire pour que le shim `postMessage` fonctionne — mais un script dans une
  origine opaque ne peut rien faire d'autre que parler à son parent.

`allow-popups-to-escape-sandbox` laisse `window.open` produire une fenêtre normale ; le shim
l'intercepte de toute façon pour la rouvrir comme onglet Nimbus.

### Le canal remontant

Un seul point d'entrée, dans `features/browser/PageView.tsx` :

```ts
const onMessage = (event: MessageEvent) => {
  const frame = frameRef.current;
  if (!frame || event.source !== frame.contentWindow) return;   // ← le filtre qui compte
  const data = event.data as FrameMessage | null;
  if (!data || typeof data !== 'object' || typeof data.__nimbus !== 'string') return;
  …
};
```

Chaque onglet a **son propre** écouteur, filtré sur `event.source` : ni un cadre imbriqué, ni une autre
fenêtre, ni un autre onglet ne peut se faire passer pour la page. Les cinq messages reconnus sont
`navigate`, `reader`, `ready`, `failed`, `autofill` ; tout le reste est ignoré.

Les URLs remontées passent par `unwrapEngineUrl()` : une page ne peut pas faire croire à la coque
qu'elle navigue vers une adresse Nimbus interne en envoyant une URL enveloppée.

### En-têtes du moteur

```
cache-control: no-store
referrer-policy: no-referrer
x-content-type-options: nosniff
x-nimbus-final-url: <URL canonique encodée>
x-nimbus-blocked: <nombre de traqueurs coupés>
```

`no-store` sur les documents rendus : rien ne s'installe dans un cache disque du navigateur.

### Jeton de rendu

Un cadre à origine opaque n'envoie pas le cookie `SameSite=Lax`. `POST /api/profiles/unlock` renvoie
donc un `browseToken` (`<8 premiers octets de session>.<12 octets aléatoires base64url>`), accepté par
`authorizeBrowse` à la place du cookie. Propriétés :

- porté uniquement par les URLs du moteur, jamais persisté (mémoire du store `session`) ;
- régénéré à chaque déverrouillage ;
- supprimé au verrouillage ;
- limité aux routes de navigation — il n'ouvre **aucun** accès au coffre (`/api/vault` exige la session
  cookie déverrouillée).

### Limitation d'honnêteté

Une page rendue peut appeler `fetch('https://analytics.example/collect')` depuis un script inline :
Nimbus ne réécrit pas le corps des scripts distants. Cette requête part du cadre, échoue le plus
souvent (CORS, réseau), et n'emporte aucune donnée de la coque — mais elle n'est pas comptée comme
« coupée ». Le mode lecture est la parade pour les contenus sensibles.

---

## 5. Garde anti-SSRF et blocage

`server/src/browse/blocklist.ts` refuse, avant tout fetch :

- les schémas non `http(s)` (`file:`, `gopher:`, `data:`…) ;
- les hôtes de loopback et privés : `localhost`, `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `169.254.0.0/16` (dont `169.254.169.254`, la métadonnée cloud) ;
- `metadata.google.internal` et toute la liste `NIMBUS_BLOCKED_HOSTS` ;
- les redirections sont re-vérifiées à chaque saut : une page publique ne peut pas rebondir vers le
  réseau interne.

Un hôte refusé renvoie une page d'erreur stylée (« Accès refusé ») et un message `failed` à la coque —
jamais le contenu.

**Pistage** : les URLs dont l'hôte est dans la liste de traqueurs sont remplacées à la réécriture par
`/api/browse/blocked`, qui répond un GIF 1×1 et incrémente un compteur. Le traqueur n'est **jamais
contacté**. Les entrées de la liste sont des suffixes d'hôtes ; les règles comportant un chemin
(`facebook.com/tr`, `linkedin.com/px`) sont traitées à part, sans quoi elles ne correspondraient jamais.

**Nuisances** : bandeaux de consentement, modales d'abonnement, interstitiels reçoivent un
`display:none !important` injecté, plus une seconde passe par `MutationObserver` pour ceux que la page
ajoute après coup.

**Cadence** : 20 requêtes/s par session avec un réservoir de 240 (`rateLimit` dans
`server/src/routes/browse.ts`) — de quoi naviguer normalement, pas de quoi scanner.

**Plafonds** : 8 Mo par document, 25 s de délai, cache mémoire 120 s borné et jamais persisté.

---

## 6. Ce qui est éphémère, persistant, et jamais stocké

| Catégorie | Contenu | Où |
| --- | --- | --- |
| **Éphémère** (mémoire, détruit au verrouillage) | cache de rendu, téléchargements en attente, jeton de rendu, clé de chiffrement, coffre déchiffré, onglets | serveur + navigateur |
| **Persistant** (chiffré, sur votre espace) | notes, identifiants, cartes, favoris, historique, groupes d'onglets, réglages | `/Nimbus/vault.enc` |
| **Jamais stocké nulle part** | mot de passe maître, clé de chiffrement, cookies des sites visités, fichiers de navigation sur cet appareil | — |

Le seul octet qui touche votre disque est un téléchargement que **vous** avez demandé : le fichier est
mis en scène en mémoire serveur (`POST /api/browse/download`), remis une fois
(`GET /api/browse/downloads/:id`), puis oublié à l'expiration ou au verrouillage.

---

## 7. Jetons des espaces cloud

- Stockés côté serveur, scellés par `crypto/envelope.ts` (AES-GCM, clé `NIMBUS_SERVER_KEY`) dans
  `server/data/connections.json`.
- **Jamais renvoyés au navigateur.** L'interface ne voit que `{ id, providerId, label, accountLabel }`.
  Seule exception : un lien de téléchargement direct OneDrive, pré-authentifié, court et révocable.
- Portée minimale : `drive.file` pour Google (Nimbus ne voit que les fichiers qu'il a créés),
  `Files.ReadWrite.All` + `User.Read` + `offline_access` pour Microsoft, `disk:all` + `login:email`
  pour Yandex.
- **Proton Drive est en lecture/miroir uniquement.** L'écriture exige l'authentification SRP-6a et le
  chiffrement par paquets du SDK officiel ; l'interface n'autorise donc pas Proton comme hôte d'un
  nouveau coffre et le signale comme expérimental.

---

## 8. Modèle de menace

**Protégé**

| Menace | Réponse |
| --- | --- |
| Vol du contenu du coffre sur l'espace cloud | AES-GCM-256, clé jamais sortie du navigateur |
| Fuite de l'index serveur | empreintes poivrées, aucun coffre, aucune clé |
| Une page web hostile qui attaque la coque | cadre à origine opaque, filtre `event.source`, déproxyfication des URLs |
| Un site qui appelle le réseau interne via le moteur | garde SSRF sur l'URL **et** sur chaque redirection |
| Un site qui piste l'utilisateur | réécriture en GIF 1×1, traqueur jamais contacté, `no-referrer` |
| Session laissée ouverte | verrouillage automatique, à la perte de focus, à la fermeture |
| Force brute sur le mot de passe maître | 8 tentatives → 15 min, par profil **et** par IP |
| Empreintes de session volées après verrouillage | jeton détruit, cache et téléchargements effacés |
| Piste de navigation sur le disque de l'utilisateur | `no-store`, cache mémoire uniquement, rien de persisté localement |

**Non protégé — à connaître**

| Menace | Pourquoi |
| --- | --- |
| Un appareil déjà compromis (keylogger, extension malveillante) | aucun logiciel ne peut défendre le mot de passe maître saisi sur une machine hostile |
| Un serveur Nimbus malveillant qui servirait un JavaScript modifié | l'intégrité du code client dépend du déploiement ; à durcir avec SRI/HTTPS strict et un build audité |
| Le fournisseur d'espace cloud qui observe les accès | il voit des écritures/lectures d'un fichier chiffré, leurs tailles et leurs horaires (métadonnées) |
| Une attaque par canal temporel sur le déchiffrement local | hors périmètre pour un client web |
| Les requêtes de pistage émises par du JavaScript inline | voir « Limitation d'honnêteté » §4 |

---

## 9. Durcissement pour une mise en production

1. `NIMBUS_SERVER_KEY=$(openssl rand -hex 32)` — sans lui, la clé serveur est éphémère.
2. Servir exclusivement en HTTPS derrière un proxy qui transmet `x-forwarded-proto` (le cookie passe
   alors en `Secure`) ; `NIMBUS_PUBLIC_URL` doit être l'origine publique exacte, sinon les rappels
   OAuth échouent.
3. Ajouter `Strict-Transport-Security` et une `Content-Security-Policy` au niveau du proxy.
4. `NIMBUS_BLOCKED_HOSTS` : compléter avec le réseau interne réel de l'hébergeur.
5. Sessions en mémoire = un seul processus. Pour plusieurs instances : affinité de session ou magasin
   partagé chiffré (non fourni).
6. Sauvegarder `server/data/connections.json` **et** la clé serveur ensemble — l'un sans l'autre ne
   sert à rien.
7. Considérer un verrouillage plus court que 15 min pour les postes partagés.
