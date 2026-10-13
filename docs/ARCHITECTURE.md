# Architecture de Nimbus

Nimbus tient en deux processus et un seul système de design.

```
┌─────────────────────────── navigateur de l'utilisateur ───────────────────────────┐
│  React 18 · Vite 6 · TypeScript                                                   │
│  WebCrypto : PBKDF2-SHA256 (310 000) → AES-GCM-256                                 │
│  coque desktop (rail + onglets + écran partagé)  ·  compagnon mobile (PWA)         │
│  cadre <iframe sandbox> sans allow-same-origin pour chaque page rendue             │
└───────────────┬───────────────────────────────────────────────┬───────────────────┘
                │ /api (JSON, enveloppe ok/error)                │ /api/browse/view?t=…
┌───────────────▼───────────────────────────────────────────────▼───────────────────┐
│  Express 4 · TypeScript — le moteur cloud                                         │
│  sessions en mémoire · moteur de rendu (fetch + réécriture) · blocklist · cache    │
│  coffre zero-knowledge (transport d'octets chiffrés) · adaptateurs d'espaces cloud │
└───────────────┬───────────────────────────────────────────────────────────────────┘
                │ HTTPS
   ┌────────────▼────────────┐        ┌──────────────────────────────────────────────┐
   │  le web ouvert          │        │  l'espace cloud de l'utilisateur             │
   │  (HTML/CSS/JS fetchés)  │        │  Drive · OneDrive · Yandex · Proton · WebDAV │
   └─────────────────────────┘        └──────────────────────────────────────────────┘
```

Le serveur ne possède **aucune** base de données de contenu : l'index des profils
(`server/data/accounts.json`) ne contient que des en-têtes publics (identifiant, sel KDF, empreinte
d'authentification, espace cible). Tout le reste vit sur l'espace cloud de l'utilisateur, chiffré.

---

## 1. Monorepo

| Chemin | Rôle |
| --- | --- |
| `server/src/browse/engine.ts` | fetch d'un document, garde SSRF, limite de taille, cache mémoire |
| `server/src/browse/rewrite.ts` | réécriture HTML/CSS + shim `postMessage` + extraction mode lecture |
| `server/src/browse/blocklist.ts` | hôtes de pistage, nuisances (bandeaux, interstitiels), garde réseau privé |
| `server/src/browse/downloads.ts` | mise en scène des fichiers en mémoire, remise unique |
| `server/src/browse/demo-sites.ts` | les cinq pages `nimbus://` servies par le moteur |
| `server/src/providers/*` | `CloudProvider` / `CloudClient` par espace cloud |
| `server/src/vault/*` | lecture/écriture du coffre chiffré, instantanés, garde de révision |
| `server/src/session/*` | sessions glissantes 15 min, jeton de rendu, verrouillage destructif |
| `web/src/lib/crypto.ts` | dérivation de clé, chiffrement, robustesse, TOTP, Luhn |
| `web/src/state/*` | cinq stores zustand |
| `web/src/design/*` | tokens, styles globaux, composants, `theme.ts` |
| `web/src/features/*` | un dossier par fonction (lock, shell, browser, notes, …) |

---

## 2. Flux — ouverture de session

```
main.tsx → App.boot()
  assertCrypto()            WebCrypto exige un contexte sécurisé
  GET /api/meta             capacités du moteur, fournisseurs, état de session
  phase = 'locked'  →  LockScreen (puces de profils + mot de passe maître)
  unlock(profileId, password)
    deriveMasterKey()       PBKDF2-SHA256(password, kdf.salt, 310 000) — local uniquement
    deriveAuthHash()        SHA-256 de la clé  →  envoyé au serveur
    POST /api/profiles/unlock
      serveur : authVerifier = SHA256(authHash ‖ HMAC(serverKey, 'nimbus.auth.pepper.v1'))
      → session déverrouillée, jeton de rendu émis, coffre chiffré renvoyé
    browseToken stocké en mémoire (jamais persisté)
  vault.hydrate(envelope)   déchiffrement AES-GCM local
  armIdle(autoLockMinutes)  verrouillage automatique
  watchActivity()           chaque interaction repousse l'échéance
  watchUnload()             fermer l'onglet verrouille
```

Le mot de passe maître ne quitte jamais le navigateur. Le serveur ne voit qu'un hash de la clé, et
n'en stocke qu'un hash poivré : une fuite du fichier d'index ne permet ni de déchiffrer un coffre ni
de rejouer un déverrouillage.

---

## 3. Flux — navigation

```
Toolbar (omnibox)                     PageView                       moteur cloud
─────────────────                     ────────                       ──────────────
resolveOmnibox(input, engine)
  'nimbus://…'  → page interne
  hôte plausible → https://
  sinon         → moteur de recherche
        │
        ▼
browser.navigate(tabId, url)          <iframe sandbox=
  pile historique par onglet            "allow-scripts allow-forms
  recordVisit() → coffre                 allow-popups
        │                                allow-popups-to-escape-sandbox">
        ▼                               sans allow-same-origin
                                        src = /api/browse/view?u=…&t=<jeton>
                                                                       │
                                                        engine.browse() : garde SSRF,
                                                        taille max 8 Mo, délai 25 s,
                                                        cache 120 s
                                                                       │
                                                        rewriteHtml() : <base>, liens,
                                                        images, CSS, srcset, formulaires,
                                                        traqueurs → /api/browse/blocked,
                                                        nuisances masquées, shim injecté
                                                                       │
                                        message { __nimbus: … } ◄──────┘
                                        filtré sur event.source === frame.contentWindow
                                          navigate → browser.navigate (URL déproxyfiée)
                                          reader   → mode lecture
                                          ready    → titre, URL finale, historique
                                          failed   → ErrorView (kind, status)
                                          autofill → AutofillPrompt → coffre
```

Deux détails qui comptent :

- **Le jeton de rendu.** Un cadre `sandbox` sans `allow-same-origin` a une origine opaque : le cookie
  de session `SameSite=Lax` n'y est pas envoyé. `POST /api/profiles/unlock` renvoie donc un
  `browseToken` de session, passé en query string. Il meurt au verrouillage. Les URLs de
  sous-ressources générées par la réécriture le portent déjà, côté serveur.
- **La déproxyfication.** Le shim remonte des URLs déjà réécrites (`/api/browse/view?u=…`).
  `unwrapEngineUrl()` retrouve l'adresse canonique avant de l'afficher ou de la rejouer, sinon les
  enveloppes s'empileraient.

Les pages `nimbus://start|notes|passwords|cards|cloud|privacy|settings|bookmarks|history|downloads`
sont rendues **par la coque** (`features/browser/InternalPage.tsx`) : aucune requête ne part. Les
pages `nimbus://index|news|shop|mail|docs` sont servies **par le moteur** : ce sont de vraies pages
HTML avec traqueurs et bandeaux, pour démontrer le blocage.

---

## 4. Flux — coffre

```
vault.update(mutator)            état local chiffré en mémoire, dirty = true
        │  (debounce 1 400 ms)
        ▼
PUT /api/vault { vault, baseRevision, snapshot }
        │  garde de révision : 409 revision_conflict si l'espace a changé
        ▼
CloudClient.write('/Nimbus/vault.enc')        votre espace cloud
CloudClient.write('/Nimbus/snapshots/<rev>.enc')   25 instantanés conservés
```

Le serveur manipule du texte chiffré : il ne connaît ni la clé ni le contenu. `baseRevision` évite
qu'un appareil en écrase un autre silencieusement ; en cas de conflit l'interface demande de
recharger.

Arborescence sur l'espace :

```
/Nimbus/
├── vault.enc                 coffre chiffré (AES-GCM-256)
├── account.json              en-tête public (profil, sel KDF, empreinte) — permet la découverte
├── attachments/<id>          pièces jointes chiffrées
└── snapshots/<revision>.enc  historique chiffré, 25 révisions
```

---

## 5. Stores (zustand) et bus

Le graphe d'import reste **acyclique** — c'est la règle qui empêche les boucles de rendu :

```
ui  ◄── session ◄── vault ◄── cloud
              ▲          ▲
              └─ browser ┘        (rien n'importe cloud)
```

| Store | Contenu |
| --- | --- |
| `ui` | langue + `t()`, toasts, panneau latéral, écran partagé, facteur de forme, modal, densité |
| `session` | phase, profils, clé maître, KDF, jeton de rendu, verrouillage automatique, rekey |
| `vault` | coffre déchiffré, révision, dirty/syncing, CRUD notes/mots de passe/cartes/favoris/historique/téléchargements, réglages |
| `browser` | onglets (pile, épinglage, lecteur, groupe), écran partagé, omnibox, compteurs moteur |
| `cloud` | fournisseurs, connexions, statut, instantanés, migration, restauration |

`lib/bus.ts` est un pub/sub typé (`session:unlocked`, `session:locked`, `browser:navigate`, …) : il
permet à un store de réagir à un autre sans l'importer.

---

## 6. Système de design

Tout part de `web/src/design/tokens.css` — **aucune couleur en dur** dans les composants, uniquement
des `var(--…)`.

Palette reprise de *Hume — Mobile App Design for Smart Home* (Phenomenon Studio) :

| Token | Valeur | Usage |
| --- | --- | --- |
| `--ink-900` / `--bg` | `#0E0E0F` | fond général |
| `--surface-1` | `#17181B` | cartes |
| `--border` | `#232429` | filets |
| `--slate-600` | `#393D43` | texte tertiaire, neutres |
| `--mist-300` | `#D3D3D3` | texte courant |
| `--ember-600` | `#B81908` | accent principal (marque, sélection) |
| `--clay-600` | `#52392C` | dégradés chauds |
| `--sage-500` | `#74A266` | succès, protection active |

Structure héritée du même design : **cartes d'appareil par pièce** → panneaux et tuiles par section ;
**scènes** → groupes d'onglets ; **surveillance en direct** → barre d'état et compteurs du moteur ;
**hub central** → rail de navigation. Ton général : intuitif, calme, chaleureux plutôt que
« technique froid » — grands rayons (`--r-lg`, `--r-pill`), puces, mouvements courts.

Inventaire :

- `design/ui.css` — `.nb-btn`, `.nb-iconbtn`, `.nb-card`, `.nb-chip`, `.nb-badge`, `.nb-dot`,
  `.nb-meter`, `.nb-field`, `.nb-input`, `.nb-select`, `.nb-switch`, `.nb-segmented`, `.nb-slider`,
  `.nb-modal`, `.nb-sheet`, `.nb-popover`, `.nb-toast`, `.nb-list`, `.nb-table`, `.nb-empty`
- `design/global.css` — reset, keyframes, `.truncate`, `.clamp-2`, `.tiny`, `.micro`, `.mono`,
  `.nimbus-backdrop`, `.nimbus-grain`
- `features/shell/shell.css` — coque desktop (`.rail`, `.tabstrip`, `.toolbar`, `.omnibox`,
  `.suggest`, `.content`, `.statusbar`, `.sidebar`, `.reader`, `.error-card`) et coque mobile
  (`.m-shell`, `.m-topbar`, `.m-omnibox`, `.m-tabs`, `.m-tabbar`, `.m-hero`, `.m-grid`, `.m-tile`)
- `features/shell/panels.css` — panneaux (notes, mots de passe, cartes, groupes d'onglets)
- `design/components/` — `Primitives.tsx`, `Fields.tsx`, `Overlays.tsx`, `theme.ts` (teintes, formats
  d'octets, temps relatifs, hôtes courts)

La densité (`cozy` / `compact`) est un attribut `data-density` sur la coque : les espacements changent,
pas la structure.

---

## 7. Deux facteurs de forme, une logique

`Shell.tsx` choisit selon `useUi.mobileView` (largeur de viewport, `watchViewport()`), et l'utilisateur
peut forcer l'un ou l'autre.

| Desktop | Mobile |
| --- | --- |
| rail 62 px + barre d'onglets + barre d'outils | barre supérieure + barre d'onglets défilante + barre d'onglets d'appui (4 entrées) |
| écran partagé, panneau latéral droit | hub « Coffre » en tuiles, feuilles modales (adresse, profil) |
| barre d'état vivante | puces d'état dans le héros |
| raccourcis clavier (`Ctrl+T/W/R/L/B/H/J`, `Alt+←/→`) | gestes et boutons |

Les deux lisent les mêmes stores : rien n'est dupliqué, seul le chrome change.

---

## 8. Moteur de rendu

1. **Garde** — `blocklist.assertAllowed(url)` : schémas autorisés, refus des hôtes privés / loopback /
   liaison locale / métadonnées cloud, liste interne.
2. **Fetch** — `engine.browse()` : User-Agent configurable, délai 25 s, plafond 8 Mo par document,
   cache mémoire 120 s (borné, jamais persisté).
3. **Réécriture** — `rewriteHtml()` : `<base>`, liens, images, `srcset`, feuilles de style, styles
   inline, `@import`, formulaires ; les hôtes de pistage deviennent `/api/browse/blocked` (GIF 1×1
   compté, jamais contacté) ; les nuisances reçoivent un `display:none !important` et une seconde
   passe par `MutationObserver`.
4. **Shim** — un script injecté remonte `navigate`, `ready`, `failed`, `reader`, `autofill` à la coque
   et intercepte `window.open` pour le transformer en ouverture d'onglet Nimbus.
5. **Mode lecture** — `extractReadable()` : score par bloc de texte, suppression du bruit, article
   reconstruit en blocs typés servis par l'interface.

Ce que le moteur **ne fait pas** : exécuter le JavaScript des pages distantes. C'est un proxy
HTML/CSS, pas un navigateur distant complet — voir « Limites assumées » dans le README.

---

## 9. Fournisseurs d'espace cloud

Chaque adaptateur implémente deux interfaces (`server/src/providers/types.ts`) :

```ts
interface CloudProvider {
  readonly descriptor: ProviderDescriptor;             // capacités publiées à l'interface
  beginAuth(redirectUri): Promise<OAuthStart>;         // OAuth 2 + PKCE quand applicable
  completeAuth({ code, state, redirectUri }): Promise<OAuthResult>;
  client(credentials, hooks?): CloudClient;
}

interface CloudClient {
  accountInfo(); quota(); list(dir); exists(path);
  read(path); readText(path); write(path, data, mimeType?); remove(path); ensureDir(path);
  downloadUrl(path);                                   // lien direct court, ou null → streaming API
}
```

Les identifiants de connexion sont scellés par `server/src/crypto/envelope.ts` (AES-GCM, clé
`NIMBUS_SERVER_KEY`) dans `server/data/connections.json`. **Les jetons de fournisseurs ne remontent
jamais au navigateur** — seule exception : un lien de téléchargement pré-authentifié OneDrive, court
et révocable.

Une connexion « simulée » (bouton *Essayer la démo*) retombe sur le client `local` : elle permet de
parcourir l'interface de connexion sans credentials réels.

Détail par espace : [`CLOUD-PROVIDERS.md`](CLOUD-PROVIDERS.md).

---

## 10. Outillage

- `npm run dev` — `concurrently` : `tsx watch` (API, :8787) + `vite` (:5173, proxy `/api`).
- `server/scripts/with-ca.mjs` — démarre Node avec `NODE_EXTRA_CA_CERTS` pointé sur le premier bundle
  CA trouvé (utile derrière un proxy TLS d'entreprise ou de sandbox).
- `npm run build` — `tsc` côté serveur, `vite build` côté web.
- `npm start` — Express sert l'API **et** `web/dist` (déploiement mono-process).
- `npm run typecheck` — les deux workspaces.
