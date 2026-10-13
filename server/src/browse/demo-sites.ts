import { rewriteHtml, viewUrl } from './rewrite.js';

/**
 * Demo sites served by the cloud engine itself (`nimbus://…`).
 *
 * They exist for two reasons. First, they exercise the *real* pipeline — the
 * markup goes through the same rewriter, so URL rewriting, tracker severing,
 * nuisance hiding and the postMessage shim are all genuinely at work. Second,
 * they make Nimbus demonstrable anywhere: a deployment whose network can only
 * reach a handful of hosts still shows a full browsing experience.
 *
 * Every page deliberately embeds third-party trackers so the privacy engine has
 * something visible to cut.
 */

export interface DemoPage {
  id: string;
  title: string;
  site: string;
  blurb: string;
  hue: number;
  html: string;
}

const TRACKERS = `
<script src="https://www.google-analytics.com/analytics.js" async></script>
<script src="https://www.googletagmanager.com/gtag/js?id=G-DEMO123" async></script>
<script src="https://connect.facebook.net/en_US/fbevents.js" async></script>
<script src="https://static.hotjar.com/c/hotjar-123456.js" async></script>
<img src="https://www.facebook.com/tr?id=1234567890&ev=PageView" width="1" height="1" alt="">
<img src="https://stats.g.doubleclick.net/g/collect?v=2&tid=G-DEMO" width="1" height="1" alt="">
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date()); gtag('config', 'G-DEMO123');
  fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-DEMO123', {mode:'no-cors'}).catch(function(){});
</script>`;

const CHROME = `
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0E0E0F;color:#D3D3D3;font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6}
a{color:#F0644F;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 72px}
header.site{position:sticky;top:0;z-index:5;background:rgba(14,14,15,.86);backdrop-filter:blur(18px);border-bottom:1px solid #212226}
.bar{max-width:1080px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:18px}
.brand{font-weight:700;letter-spacing:-.02em;font-size:17px;color:#F5F5F5;display:flex;align-items:center;gap:9px}
.dot{width:9px;height:9px;border-radius:50%}
nav.links{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
nav.links a{padding:7px 13px;border-radius:999px;font-size:13px;font-weight:500;color:#9A9CA0}
nav.links a:hover{background:#1A1B1F;color:#EDEDED;text-decoration:none}
h1{font-size:clamp(26px,4vw,40px);line-height:1.12;letter-spacing:-.03em;color:#F7F7F7;margin:36px 0 12px;font-weight:600}
h2{font-size:19px;letter-spacing:-.01em;color:#F0F0F0;margin:38px 0 14px;font-weight:600}
p.lede{font-size:17px;color:#A9ABAF;max-width:62ch;margin:0 0 28px}
.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.card{background:#17181B;border:1px solid #232429;border-radius:22px;padding:22px;transition:.18s}
.card:hover{border-color:#33353C;background:#1A1B1F;transform:translateY(-2px)}
.tag{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:999px;margin-bottom:12px}
.card h3{margin:0 0 8px;font-size:16px;color:#F2F2F2;letter-spacing:-.01em;font-weight:600}
.card p{margin:0;font-size:13.5px;color:#8E9095}
.pill{display:inline-flex;align-items:center;gap:8px;background:#1E2024;border:1px solid #2A2C32;border-radius:999px;padding:9px 16px;font-size:13px;font-weight:600;color:#E4E4E6}
.big{background:linear-gradient(150deg,#1B1D21,#141518);border:1px solid #26282D;border-radius:28px;padding:34px;margin:26px 0}
.stat{font-size:34px;font-weight:600;letter-spacing:-.03em;color:#F7F7F7}
.stat.small{font-size:22px}
.muted{color:#6E7075;font-size:12.5px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;color:#6E7075;font-weight:600;font-size:11px;letter-spacing:.07em;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid #232429}
td{padding:12px;border-bottom:1px solid #1C1D21;color:#B9BBBF}
tr:hover td{background:#151619}
form .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
input,select,textarea{font:inherit;background:#101114;border:1px solid #26282D;color:#E8E8EA;border-radius:14px;padding:12px 14px;font-size:14px;min-width:0}
input:focus,textarea:focus,select:focus{outline:none;border-color:#B81908}
label{display:block;font-size:12px;color:#8E9095;margin:14px 0 6px;font-weight:500}
.btn{font:inherit;font-weight:600;font-size:13.5px;padding:12px 20px;border-radius:999px;border:0;cursor:pointer;background:#B81908;color:#fff}
.btn.ghost{background:#22242A;color:#D3D3D3}
footer.site{margin-top:56px;padding-top:22px;border-top:1px solid #1C1D21;font-size:12.5px;color:#5F6165;display:flex;gap:18px;flex-wrap:wrap}
figure{margin:0 0 26px}
img.hero{width:100%;height:210px;object-fit:cover;border-radius:20px;background:linear-gradient(120deg,#2A1E17,#52392C 45%,#B81908)}
blockquote{margin:22px 0;padding:18px 22px;border-left:3px solid #B81908;background:#15161A;border-radius:0 18px 18px 0;color:#C9CBCE;font-size:15px}
ul.clean{padding-left:20px;color:#A9ABAF;font-size:14.5px}ul.clean li{margin-bottom:8px}
.cookie-banner{position:fixed;bottom:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:#1E2024;border:1px solid #2E3037;border-radius:20px;padding:18px;z-index:50;font-size:13px;color:#B9BBBF}
</style>`;

const wrap = (opts: { title: string; brand: string; hue: number; nav: [string, string][]; body: string; footer?: string }) => `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<meta name="description" content="${opts.title} — page de démonstration rendue par le moteur cloud Nimbus.">
<meta property="og:title" content="${opts.title}">
<meta property="og:description" content="Rendu 100 % cloud, aucun octet écrit sur votre appareil.">
<meta property="og:site_name" content="${opts.brand}">
${CHROME}
</head><body>
<header class="site"><div class="bar">
  <span class="brand"><span class="dot" style="background:hsl(${opts.hue} 62% 52%)"></span>${opts.brand}</span>
  <nav class="links">${opts.nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}</nav>
</div></header>
<div class="wrap">
${opts.body}
<footer class="site">
  <span>${opts.footer ?? opts.brand}</span>
  <span>·</span>
  <span>Page servie par le moteur cloud Nimbus</span>
  <span>·</span>
  <a href="nimbus://index">Retour à l’index de démo</a>
</footer>
</div>
<div class="cookie-banner" id="cookie-banner">🍪 Ce bandeau de consentement est un appât : le moteur de confidentialité Nimbus le masque automatiquement et coupe les 6 traqueurs embarqués dans cette page.</div>
${TRACKERS}
</body></html>`;

const nav = (current: string): [string, string][] =>
  (
    [
      ['Index', 'nimbus://index'],
      ['Le Fil', 'nimbus://news'],
      ['Boutique', 'nimbus://shop'],
      ['Courriel', 'nimbus://mail'],
      ['Docs', 'nimbus://docs'],
      ['GitHub', 'https://github.com/'],
    ] as [string, string][]
  ).map(([l, h]) => [l, h] as [string, string]);

const index: DemoPage = {
  id: 'index',
  title: 'Sites de démonstration',
  site: 'Nimbus',
  blurb: 'Quatre pages servies par le moteur cloud pour valider le rendu, le blocage et le mode lecture.',
  hue: 22,
  html: wrap({
    title: 'Nimbus — Sites de démonstration',
    brand: 'Nimbus Demo',
    hue: 22,
    nav: nav('index'),
    footer: 'Nimbus Demo — contenu généré par le moteur cloud',
    body: `
<h1>Le rendu se passe dans le cloud,<br>pas sur votre machine.</h1>
<p class="lede">Chaque page ci-dessous est téléchargée, réécrite et servie par le moteur Nimbus. Votre navigateur
n'établit aucune connexion directe avec le site, n'écrit aucun cookie, aucun cache et aucun fichier. Fermez l'onglet
ou verrouillez la session : tout disparaît.</p>

<div class="big grid g3">
  <div><div class="stat">100 %</div><div class="muted">des requêtes passent par le moteur cloud</div></div>
  <div><div class="stat">0</div><div class="muted">octet écrit sur votre appareil</div></div>
  <div><div class="stat">6</div><div class="muted">traqueurs coupés sur chaque page de démo</div></div>
</div>

<h2>Pages disponibles</h2>
<div class="grid g2">
  <a class="card" href="nimbus://news"><span class="tag" style="background:rgba(184,25,8,.16);color:#F0644F">Presse</span>
    <h3>Le Fil — quotidien généraliste</h3><p>Article long avec images, citations et liens externes : idéal pour tester le mode lecture et la navigation entre onglets.</p></a>
  <a class="card" href="nimbus://shop"><span class="tag" style="background:rgba(116,162,102,.16);color:#8FBE80">Commerce</span>
    <h3>Maison Objet — catalogue</h3><p>Grille produits, tableau de prix, filtres et un formulaire de commande en POST pour valider la soumission de formulaires.</p></a>
  <a class="card" href="nimbus://mail"><span class="tag" style="background:rgba(82,57,44,.4);color:#D2A98C">Courriel</span>
    <h3>Courriel — boîte de réception</h3><p>Liste de messages, panneau de lecture et gestionnaires de mots de passe simulés : le remplissage automatique depuis le coffre y est testable.</p></a>
  <a class="card" href="nimbus://docs"><span class="tag" style="background:rgba(57,61,67,.6);color:#B9BBBF">Technique</span>
    <h3>Docs — référence API</h3><p>Contenu dense, blocs de code et navigation latérale : vérifie la réécriture des ancres et des ressources.</p></a>
</div>

<h2>Et aussi</h2>
<div class="grid g3">
  <a class="card" href="https://github.com/"><h3>github.com</h3><p>Site réel, chargé à travers le moteur cloud.</p></a>
  <a class="card" href="https://pypi.org/"><h3>pypi.org</h3><p>Index de paquets Python, rendu côté serveur.</p></a>
  <a class="card" href="nimbus://news"><h3>Mode lecture</h3><p>Ouvrez Le Fil puis basculez en lecture pour l'extraction typographique.</p></a>
</div>`,
  }),
};

const news: DemoPage = {
  id: 'news',
  title: 'Le cloud souverain progresse',
  site: 'Le Fil',
  blurb: 'Article long pour tester le mode lecture.',
  hue: 12,
  html: wrap({
    title: 'Le Fil — Le cloud souverain progresse',
    brand: 'Le Fil',
    hue: 12,
    nav: nav('news'),
    footer: 'Le Fil · édition du jour',
    body: `
<figure><div class="hero" role="img" aria-label="Illustration d'un centre de données"></div></figure>
<span class="tag" style="background:rgba(184,25,8,.16);color:#F0644F">Technologie</span>
<h1>Le cloud souverain progresse, mais le coffre reste le point faible</h1>
<p class="lede">Les navigateurs distants promettent de ne rien laisser sur la machine de l'utilisateur. Encore faut-il
que les données qu'ils synchronisent — mots de passe, notes, cartes — ne transitent jamais en clair.</p>
<p class="muted">Par la rédaction · 6 min de lecture · <a href="nimbus://docs">voir la note technique</a></p>

<p>La promesse est simple : le rendu se fait ailleurs. L'onglet affiche une page dont aucun octet n'a été téléchargé par
votre ordinateur. Pas de cookie déposé, pas de cache, pas d'historique local. En contrepartie, tout ce que le navigateur
retient de vous doit bien exister quelque part — et c'est là que la conception devient intéressante.</p>

<h2>Le problème du coffre</h2>
<p>Un navigateur qui vous suit partout transporte trois choses sensibles : vos identifiants, vos cartes et vos notes.
Les confier au serveur qui rend les pages reviendrait à donner à un opérateur de rendu la clé de votre vie numérique.</p>
<blockquote>Le bon modèle est asymétrique : le serveur déplace des octets qu'il ne sait pas lire, l'utilisateur détient
une clé qu'il ne partage jamais.</blockquote>
<p>C'est exactement ce que fait un chiffrement de bout en bout correctement implémenté. La clé est dérivée du mot de
passe maître dans le navigateur, par PBKDF2-SHA256 avec plusieurs centaines de milliers d'itérations. Elle n'est jamais
transmise. Le serveur ne manipule qu'un texte chiffré en AES-GCM-256, qu'il écrit ensuite sur l'espace de stockage que
l'utilisateur a choisi.</p>

<h2>Votre Drive, pas le leur</h2>
<p>Reste la question du lieu. Un coffre chiffré hébergé par l'éditeur du navigateur recrée une dépendance. Le faire
reposer sur Google Drive, Yandex Disk, OneDrive, un WebDAV ou Proton Drive déplace la confiance vers un fournisseur que
l'utilisateur a déjà choisi — et rend la fuite de données exploitable nulle, puisque le contenu est illisible sans la clé.</p>

<ul class="clean">
  <li>Le mot de passe maître n'est jamais envoyé au serveur.</li>
  <li>La clé de chiffrement vit en mémoire, le temps de la session.</li>
  <li>Le verrouillage automatique efface la clé et tout l'état éphémère.</li>
  <li>Le fichier stocké sur votre Drive est inutilisable sans la clé.</li>
</ul>

<h2>Ce que change le rendu distant</h2>
<p>Un proxy de rendu coupe aussi, par construction, une bonne partie du pistage : la requête vers le site est émise par
le moteur, pas par vous. Les traqueurs embarqués dans cette page — six au total — n'ont même pas été contactés. Leur URL
a été remplacée, au moment de la réécriture, par une impasse.</p>
<p>Ce n'est pas une protection absolue. Un moteur de rendu reste un point de passage unique, et sa journalisation devient
un enjeu de confiance majeur. D'où l'intérêt de le rendre auditable : politique d'hôtes bloqués, durée de vie du cache,
effacement au verrouillage, tout cela doit être visible et vérifiable.</p>

<h2>En pratique</h2>
<p>Pour l'utilisateur, le quotidien ressemble à un navigateur ordinaire : onglets, favoris, historique, panneau latéral.
La différence tient à deux détails. Le premier, c'est le mot de passe demandé à chaque ouverture de session. Le second,
c'est que l'historique, les favoris et le coffre sont stockés sur votre espace cloud, et qu'ils vous suivent d'une
machine à l'autre sans jamais se poser sur aucune d'elles.</p>

<div class="big grid g2">
  <div><div class="stat small">PBKDF2-SHA256</div><div class="muted">dérivation côté navigateur, 310 000 itérations</div></div>
  <div><div class="stat small">AES-GCM-256</div><div class="muted">chiffrement du coffre, IV unique par enregistrement</div></div>
</div>

<p><a href="nimbus://shop">Lire la suite : le commerce en ligne passe au rendu distant →</a></p>`,
  }),
};

const shop: DemoPage = {
  id: 'shop',
  title: 'Maison Objet',
  site: 'Maison Objet',
  blurb: 'Catalogue + formulaire POST.',
  hue: 96,
  html: wrap({
    title: 'Maison Objet — Catalogue',
    brand: 'Maison Objet',
    hue: 96,
    nav: nav('shop'),
    footer: 'Maison Objet · livraison offerte dès 80 €',
    body: `
<h1>Objets pour la maison</h1>
<p class="lede">Catalogue de démonstration : grille produits, tableau comparatif et formulaire de commande en POST.</p>

<div class="grid g3">
  <div class="card"><span class="tag" style="background:rgba(116,162,102,.16);color:#8FBE80">Nouveau</span>
    <h3>Lampe Halo</h3><p>Laiton brossé, abat-jour lin. 3 températures de blanc.</p>
    <div class="stat small" style="margin-top:14px">189 €</div>
    <div class="row"><button class="btn">Ajouter</button><button class="btn ghost">Détails</button></div></div>
  <div class="card"><span class="tag" style="background:rgba(57,61,67,.6);color:#B9BBBF">Classique</span>
    <h3>Chauffe-eau Argile</h3><p>Céramique émaillée, contenance 1,2 L.</p>
    <div class="stat small" style="margin-top:14px">64 €</div>
    <div class="row"><button class="btn">Ajouter</button><button class="btn ghost">Détails</button></div></div>
  <div class="card"><span class="tag" style="background:rgba(184,25,8,.16);color:#F0644F">-20 %</span>
    <h3>Fauteuil Nimbus</h3><p>Structure frêne, tissu bouclette sable.</p>
    <div class="stat small" style="margin-top:14px">512 €</div>
    <div class="row"><button class="btn">Ajouter</button><button class="btn ghost">Détails</button></div></div>
</div>

<h2>Comparer</h2>
<div class="card" style="padding:6px 10px">
<table>
<thead><tr><th>Référence</th><th>Matière</th><th>Délai</th><th style="text-align:right">Prix</th></tr></thead>
<tbody>
<tr><td><a href="nimbus://docs">HAL-01</a></td><td>Laiton / lin</td><td>3 jours</td><td style="text-align:right">189 €</td></tr>
<tr><td>ARG-02</td><td>Céramique</td><td>2 jours</td><td style="text-align:right">64 €</td></tr>
<tr><td>NIM-03</td><td>Frêne / bouclette</td><td>4 semaines</td><td style="text-align:right">512 €</td></tr>
<tr><td>TER-04</td><td>Terre cuite</td><td>5 jours</td><td style="text-align:right">38 €</td></tr>
</tbody></table>
</div>

<h2>Commander</h2>
<p class="muted">Ce formulaire part en POST à travers le moteur cloud. Les champs carte sont remplis automatiquement
depuis le coffre si vous en avez enregistré un.</p>
<form action="nimbus://shop" method="POST" class="card">
  <label for="email">Courriel</label>
  <input id="email" name="email" type="email" placeholder="vous@exemple.fr" autocomplete="email" style="width:100%">
  <label for="pass">Mot de passe</label>
  <input id="pass" name="password" type="password" placeholder="••••••••" autocomplete="current-password" style="width:100%">
  <div class="row">
    <div style="flex:1;min-width:200px"><label for="card">Numéro de carte</label>
      <input id="card" name="card" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" style="width:100%"></div>
    <div style="width:110px"><label for="exp">Expiration</label>
      <input id="exp" name="exp" type="text" autocomplete="cc-exp" placeholder="09/29" style="width:100%"></div>
    <div style="width:90px"><label for="cvc">CVC</label>
      <input id="cvc" name="cvc" type="text" autocomplete="cc-csc" placeholder="123" style="width:100%"></div>
  </div>
  <label for="note">Note de livraison</label>
  <textarea id="note" name="note" rows="2" placeholder="Code portail, étage…" style="width:100%"></textarea>
  <div class="row"><button class="btn" type="submit">Passer la commande</button>
  <a class="pill" href="nimbus://mail">Annuler</a></div>
</form>`,
  }),
};

const mail: DemoPage = {
  id: 'mail',
  title: 'Courriel',
  site: 'Courriel',
  blurb: 'Boîte de réception et formulaire de connexion.',
  hue: 28,
  html: wrap({
    title: 'Courriel — Boîte de réception',
    brand: 'Courriel',
    hue: 28,
    nav: nav('mail'),
    footer: 'Courriel · 4 messages non lus',
    body: `
<h1>Boîte de réception</h1>
<p class="lede">Démo de connexion : Nimbus propose le remplissage automatique depuis le gestionnaire de mots de passe,
sans jamais exposer la clé au site.</p>

<div class="grid g2" style="align-items:start">
  <form action="nimbus://mail" method="POST" class="card">
    <h3 style="margin-top:0">Se connecter</h3>
    <label for="m-user">Identifiant</label>
    <input id="m-user" name="username" type="text" autocomplete="username" placeholder="marie@exemple.fr" style="width:100%">
    <label for="m-pass">Mot de passe</label>
    <input id="m-pass" name="password" type="password" autocomplete="current-password" placeholder="••••••••" style="width:100%">
    <div class="row"><button class="btn" type="submit">Connexion</button>
    <button class="btn ghost" type="button" onclick="window.parent.postMessage({__nimbus:'autofill'},'*')">Remplir depuis le coffre</button></div>
    <p class="muted" style="margin-top:12px">Le bouton de droite émet un message vers le shell Nimbus : c'est ainsi que
    l'invite de remplissage automatique apparaît sans que le site n'accède au coffre.</p>
  </form>

  <div class="card" style="padding:6px 10px">
  <table>
  <thead><tr><th>Expéditeur</th><th>Objet</th><th style="text-align:right">Heure</th></tr></thead>
  <tbody>
  <tr><td>Banque Accord</td><td>Votre relevé de septembre est disponible</td><td style="text-align:right">09:12</td></tr>
  <tr><td>Le Fil</td><td>Le cloud souverain progresse</td><td style="text-align:right">08:40</td></tr>
  <tr><td>Maison Objet</td><td>Commande HAL-01 confirmée</td><td style="text-align:right">Hier</td></tr>
  <tr><td>Yandex Disk</td><td>Votre espace de stockage est synchronisé</td><td style="text-align:right">Hier</td></tr>
  <tr><td>Sécurité Nimbus</td><td>Nouvelle connexion depuis Rotterdam</td><td style="text-align:right">Lun.</td></tr>
  </tbody></table>
  </div>
</div>

<h2>Extrait du dernier message</h2>
<blockquote>Bonjour Marie, votre coffre a été synchronisé avec votre espace cloud à 07:58. Révision 42, 218 Ko chiffrés.
Aucune donnée en clair n'a transité par nos serveurs.</blockquote>
<p><a href="nimbus://docs">Consulter la documentation technique →</a></p>`,
  }),
};

const docs: DemoPage = {
  id: 'docs',
  title: 'Référence du moteur',
  site: 'Nimbus Docs',
  blurb: 'Contenu technique dense avec ancres et code.',
  hue: 210,
  html: wrap({
    title: 'Nimbus Docs — Référence du moteur',
    brand: 'Nimbus Docs',
    hue: 210,
    nav: nav('docs'),
    footer: 'Nimbus Docs · v0.1.0',
    body: `
<h1>Référence du moteur cloud</h1>
<p class="lede">Comment une requête traverse Nimbus, ce qui est réécrit, ce qui est coupé, et ce qui est effacé.</p>

<h2 id="pipeline">Pipeline de rendu</h2>
<div class="card" style="padding:6px 10px">
<table>
<thead><tr><th>Étape</th><th>Où</th><th>Effet</th></tr></thead>
<tbody>
<tr><td>1. Saisie</td><td>shell</td><td>URL ou recherche, résolution des <code>nimbus://</code></td></tr>
<tr><td>2. Garde</td><td>moteur</td><td>hôte privé / métadonnées refusés (anti-SSRF)</td></tr>
<tr><td>3. Récupération</td><td>moteur</td><td>requête émise depuis le cloud, jamais depuis votre machine</td></tr>
<tr><td>4. Réécriture</td><td>moteur</td><td><code>href</code>, <code>src</code>, <code>srcset</code>, <code>action</code>, <code>url()</code>, <code>@import</code>, meta refresh</td></tr>
<tr><td>5. Coupure</td><td>moteur</td><td>les traqueurs deviennent une impasse, jamais contactés</td></tr>
<tr><td>6. Injection</td><td>moteur</td><td>shim de navigation + masquage des bandeaux</td></tr>
<tr><td>7. Affichage</td><td>shell</td><td>cadre sandboxé <em>sans</em> <code>allow-same-origin</code></td></tr>
</tbody></table>
</div>

<h2 id="isolation">Isolation du cadre</h2>
<p>La page rendue est affichée dans un cadre dont l'attribut <code>sandbox</code> omet volontairement
<code>allow-same-origin</code>. Le document obtient une origine opaque : il ne peut ni lire les cookies de session, ni
accéder au stockage local, ni appeler l'API du coffre — le CORS le lui refuse. Ses sous-ressources atteignent le moteur
grâce à un jeton par session, gravé dans chaque URL réécrite, et qui meurt avec elle.</p>
<pre style="background:#101114;border:1px solid #232429;border-radius:16px;padding:16px;overflow:auto;font-size:12.5px;color:#C9CBCE">sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
// pas d'allow-same-origin  →  origine opaque, aucune portée sur Nimbus</pre>

<h2 id="erasure">Effacement</h2>
<ul class="clean">
  <li><strong>Cache</strong> — mémoire uniquement, TTL court, jamais de disque.</li>
  <li><strong>Téléchargements</strong> — mis en scène en mémoire, remis une seule fois, puis oubliés.</li>
  <li><strong>Verrouillage</strong> — clé AES détruite, jeton de rendu révoqué, état éphémère purgé.</li>
  <li><strong>Persistant</strong> — uniquement le coffre chiffré, écrit sur <em>votre</em> espace cloud.</li>
</ul>

<h2 id="limits">Limites connues</h2>
<p>Une réécriture d'URL ne couvre pas le JavaScript : une application monopage qui construit ses requêtes à la volée peut
échapper au proxy. Le mode lecture est alors le repli naturel — il extrait le contenu typographique et ignore tout le
reste. Les sites exigeant une exécution complète nécessitent un moteur à distance (CDP) ; l'interface est prévue pour.</p>

<h2 id="providers">Espaces pris en charge</h2>
<div class="grid g2">
  <div class="card"><h3>Google Drive</h3><p>OAuth2 + PKCE, portée <code>drive.file</code> : Nimbus ne voit que le dossier qu'il crée.</p></div>
  <div class="card"><h3>Yandex Disk</h3><p>OAuth2, API REST Disk v1, dossiers et quotas.</p></div>
  <div class="card"><h3>Microsoft OneDrive</h3><p>Graph API, téléversement reprenable au-delà de 4 Mo, liens de téléchargement pré-authentifiés.</p></div>
  <div class="card"><h3>WebDAV</h3><p>pCloud, Nextcloud, ownCloud, kDrive, Baikal — authentification Basic, MKCOL/PROPFIND.</p></div>
  <div class="card"><h3>Proton Drive</h3><p>Lecture, liste, quota et suppression. L'écriture exige le chiffrement par paquets du SDK officiel : espace proposé en lecture seule.</p></div>
  <div class="card"><h3>Nimbus Cloud</h3><p>Repli chiffré sans configuration, migrable en un clic vers votre propre espace.</p></div>
</div>

<p style="margin-top:28px"><a href="nimbus://news">← Retour à l'article</a> · <a href="https://github.com/">Dépôt GitHub</a></p>`,
  }),
};

const PAGES: Record<string, DemoPage> = {
  index,
  news,
  shop,
  mail,
  docs,
};

export const DEMO_SCHEME = 'nimbus:';

export const isDemoUrl = (raw: string): boolean => raw.trim().toLowerCase().startsWith(DEMO_SCHEME);

export const demoIds = (): string[] => Object.keys(PAGES);

export const demoCatalogue = (): { id: string; title: string; site: string; blurb: string; hue: number; url: string }[] =>
  Object.values(PAGES).map((p) => ({ id: p.id, title: p.title, site: p.site, blurb: p.blurb, hue: p.hue, url: `${DEMO_SCHEME}//${p.id}` }));

export function resolveDemo(raw: string): { page: DemoPage; url: URL } | null {
  const trimmed = raw.trim();
  if (!isDemoUrl(trimmed)) return null;
  let id = trimmed.slice(DEMO_SCHEME.length).replace(/^\/+/, '').split(/[/?#]/)[0] ?? '';
  id = id.toLowerCase();
  if (!id) id = 'index';
  const page = PAGES[id] ?? PAGES.index!;
  return { page, url: new URL(`https://demo.nimbus.app/${page.id}`) };
}

/**
 * Render a demo page through the *same* rewriter used for real sites, so the
 * privacy engine, URL rewriting and shim injection are exercised for real.
 */
export function renderDemo(raw: string, opts: { token?: string; blockTrackers: boolean; hideNuisance: boolean }): { html: string; title: string; stats: { urlsRewritten: number; trackersBlocked: number; blockedHosts: string[] } } | null {
  const resolved = resolveDemo(raw);
  if (!resolved) return null;
  const out = rewriteHtml(resolved.page.html, {
    pageUrl: resolved.url,
    blockTrackers: opts.blockTrackers,
    hideNuisance: opts.hideNuisance,
    injectRuntime: true,
    token: opts.token,
  });
  // `nimbus:` is in the rewriter's skip list, so internal links survive intact
  // and the shell resolves them on the next navigation.
  return { html: out.html, title: resolved.page.title, stats: out.stats };
}

export { viewUrl as demoViewUrl };
