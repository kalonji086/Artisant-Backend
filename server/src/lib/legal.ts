import { escapeHtml, PUBLISHER_NAME, type Branding } from './branding';

interface Section {
  title: string;
  html: string;
}

const DEFAULT_UPDATED = '3 novembre 2026';

export interface CustomDoc {
  html: string;
  updatedAt: string;
}

/** Nettoyage minimal du HTML saisi par l'admin : pas de scripts, de gestionnaires d'événements ni d'URL javascript:. */
export const sanitizeLegalHtml = (html: string): string =>
  html
    .replace(/<(script|style|iframe|object|embed|form|meta|link)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\2/gi, ' $1="#"');

const stripTags = (v: string): string => v.replace(/<[^>]*>/g, '').trim();

/** Découpe le HTML personnalisé en sections à chaque <h2> pour conserver sommaire et numérotation. */
const sectionsFromHtml = (html: string): Section[] => {
  const parts = html.split(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const sections: Section[] = [];
  if (parts[0].trim()) sections.push({ title: 'Introduction', html: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    sections.push({ title: stripTags(parts[i]) || `Section ${sections.length + 1}`, html: parts[i + 1] ?? '' });
  }
  return sections;
};

const formatDate = (iso?: string): string => {
  if (!iso) return DEFAULT_UPDATED;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DEFAULT_UPDATED
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
};

const layout = (opts: {
  title: string;
  intro: string;
  sections: Section[];
  updated?: string;
  branding: Branding;
  baseUrl: string;
  other: { href: string; label: string };
}): string => {
  const { title, intro, sections, branding, baseUrl, other } = opts;
  const email = escapeHtml(branding.contactEmail);
  const name = escapeHtml(branding.platformName);

  const toc = sections.map((s, i) => `<li><a href="#s${i + 1}">${i + 1}. ${s.title}</a></li>`).join('');
  const body = sections
    .map((s, i) => `<section id="s${i + 1}"><h2><span>${i + 1}</span>${s.title}</h2>${s.html}</section>`)
    .join('');
  const socials = branding.socials
    .map((s) => `<a class="soc" style="background:${s.color}" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${s.label}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>${title} — ${name}</title>
<link rel="icon" href="${baseUrl}/logo.png">
<style>
  :root { --brand:#208aef; --brand-dark:#1871c4; --ink:#101828; --muted:#60646c; --line:#e5e7eb; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color:var(--ink); background:#f0f4f9; line-height:1.7; }
  header.hero { background: linear-gradient(135deg,#0b1b33 0%,#0d2548 55%,#1871c4 100%); color:#fff; padding:40px 20px 90px; }
  .wrap { max-width: 1040px; margin: 0 auto; }
  .brand { display:flex; align-items:center; gap:14px; }
  .brand img { width:52px; height:52px; border-radius:14px; background:#fff; }
  .brand b { display:block; font-size:20px; letter-spacing:1px; }
  .brand small { color:#9db8dc; letter-spacing:2px; font-size:11px; text-transform:uppercase; }
  .hero h1 { font-size:clamp(28px,5vw,42px); margin:34px 0 10px; line-height:1.2; }
  .hero p { margin:0; color:#c9d8ee; max-width:680px; }
  .badge { display:inline-block; margin-top:18px; padding:6px 14px; border-radius:999px; background:rgba(255,255,255,.12); font-size:12px; font-weight:600; }
  main.wrap { display:grid; grid-template-columns: 260px 1fr; gap:28px; margin-top:-56px; padding:0 20px 60px; }
  nav.toc { position:sticky; top:20px; align-self:start; background:#fff; border-radius:18px; padding:22px; box-shadow:0 10px 30px rgba(16,24,40,.08); }
  nav.toc h3 { margin:0 0 12px; font-size:12px; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); }
  nav.toc ol { list-style:none; margin:0; padding:0; }
  nav.toc a { display:block; padding:7px 10px; border-radius:10px; color:var(--ink); text-decoration:none; font-size:14px; }
  nav.toc a:hover { background:#e8f4fe; color:var(--brand-dark); }
  article { background:#fff; border-radius:18px; padding:40px; box-shadow:0 10px 30px rgba(16,24,40,.08); }
  section { padding-bottom:26px; margin-bottom:26px; border-bottom:1px solid var(--line); scroll-margin-top:20px; }
  section:last-of-type { border-bottom:0; margin-bottom:0; }
  h2 { display:flex; align-items:center; gap:12px; font-size:22px; margin:0 0 14px; }
  h2 span { flex:none; width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--brand),#38bdf8); color:#fff; font-size:15px; display:flex; align-items:center; justify-content:center; }
  h3.sub { font-size:16px; margin:18px 0 6px; color:var(--brand-dark); }
  p { margin:0 0 12px; color:#344054; }
  ul { padding-left:22px; margin:0 0 12px; color:#344054; }
  li { margin-bottom:6px; }
  a { color:var(--brand-dark); }
  .note { background:#e8f4fe; border-left:4px solid var(--brand); padding:14px 18px; border-radius:10px; margin:14px 0; color:#1b4a78; }
  .contact { background:linear-gradient(135deg,#0b1b33,#0d2548); color:#fff; border-radius:16px; padding:24px; margin-top:8px; }
  .contact p { color:#c9d8ee; margin:0 0 6px; }
  .contact a { color:#7cc4ff; font-weight:700; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin:10px 0 14px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:#f5f9ff; font-size:12px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); }
  footer { background:#0b1b33; color:#9db8dc; text-align:center; padding:34px 20px; font-size:13px; }
  footer a { color:#c9d8ee; margin:0 8px; text-decoration:none; }
  footer a:hover { text-decoration:underline; }
  .soc { display:inline-block; margin:0 4px 10px; padding:7px 15px; border-radius:999px; color:#fff !important; font-weight:700; font-size:12px; text-decoration:none !important; }
  @media (max-width: 860px) { main.wrap { grid-template-columns:1fr; } nav.toc { position:static; } article { padding:24px; } }
  @media print { header.hero, nav.toc, footer { display:none; } body { background:#fff; } main.wrap { display:block; margin:0; } article { box-shadow:none; padding:0; } }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <div class="brand"><img src="${baseUrl}/logo.png" alt="${name}"><div><b>${name}</b><small>Plateforme d'artisans</small></div></div>
    <h1>${title}</h1>
    <p>${intro}</p>
    <span class="badge">Dernière mise à jour : ${formatDate(opts.updated)}</span>
  </div>
</header>
<main class="wrap">
  <nav class="toc" aria-label="Sommaire"><h3>Sommaire</h3><ol>${toc}</ol></nav>
  <article>
    ${body}
    <div class="contact">
      <p><b>Une question ou une demande ?</b></p>
      <p>Écrivez-nous : <a href="mailto:${email}">${email}</a></p>
    </div>
  </article>
</main>
<footer>
  ${socials ? `<div>${socials}</div>` : ''}
  <div>
    <a href="${baseUrl}/legal/privacy">Politique de confidentialité</a>·
    <a href="${baseUrl}/legal/terms">Conditions d'utilisation</a>
  </div>
  <p>© ${new Date().getFullYear()} ${name} — édité par ${escapeHtml(PUBLISHER_NAME)}. Tous droits réservés.</p>
  <p><a href="${other.href}">${other.label}</a></p>
</footer>
</body>
</html>`;
};

const privacySections = (branding: Branding, baseUrl: string): Section[] => {
  const email = escapeHtml(branding.contactEmail);
  const name = escapeHtml(branding.platformName);
  const sections: Section[] = [
    {
      title: 'Introduction',
      html: `<p>Cette politique explique comment <b>${name}</b> (« nous »), édité par ${escapeHtml(PUBLISHER_NAME)}, collecte, utilise, partage et protège vos données personnelles lorsque vous utilisez l'application mobile et le site ${name}. Elle est conforme au Règlement général sur la protection des données (RGPD), au CCPA/CPRA et aux exigences de Google Play.</p>
<div class="note">En créant un compte, vous reconnaissez avoir lu cette politique.</div>`,
    },
    {
      title: 'Responsable du traitement',
      html: `<p>Le responsable du traitement est ${escapeHtml(PUBLISHER_NAME)}, éditeur de ${name}. Pour toute question relative à vos données : <a href="mailto:${email}">${email}</a>.</p>`,
    },
    {
      title: 'Données que nous collectons',
      html: `<table>
<tr><th>Catégorie</th><th>Exemples</th><th>Source</th></tr>
<tr><td>Compte</td><td>Nom, adresse email, mot de passe (chiffré), rôle (client ou artisan)</td><td>Vous</td></tr>
<tr><td>Profil</td><td>Téléphone, adresse, ville, métier, disponibilité, photo</td><td>Vous</td></tr>
<tr><td>Localisation</td><td>Position GPS approximative ou précise pour afficher les artisans proches et assigner les devis</td><td>Votre appareil, avec votre autorisation</td></tr>
<tr><td>Activité</td><td>Demandes de devis, statuts, messages liés aux devis</td><td>Vous</td></tr>
<tr><td>Technique</td><td>Type d'appareil, version de l'app, journaux d'erreurs, adresse IP</td><td>Automatique</td></tr>
</table>
<p>Nous ne collectons pas de données de paiement : aucune carte bancaire n'est traitée dans l'application.</p>`,
    },
    {
      title: 'Finalités et bases légales',
      html: `<ul>
<li><b>Fournir le service</b> (création de compte, mise en relation, devis, carte en direct) — exécution du contrat.</li>
<li><b>Localisation</b> — votre consentement, que vous pouvez retirer à tout moment dans les réglages de l'appareil.</li>
<li><b>Sécurité et prévention de la fraude</b> — intérêt légitime.</li>
<li><b>Communications de service et marketing</b> — exécution du contrat, ou consentement/intérêt légitime pour les emails promotionnels, avec lien de désinscription dans chaque message.</li>
<li><b>Obligations légales</b> — respect des lois applicables.</li>
</ul>`,
    },
    {
      title: 'Partage des données',
      html: `<p>Nous ne vendons jamais vos données personnelles. Elles sont partagées uniquement :</p>
<ul>
<li>avec les <b>autres utilisateurs</b> concernés par une mise en relation (par exemple, un artisan assigné voit le nom et la zone du client d'un devis) ;</li>
<li>avec nos <b>sous-traitants techniques</b> : Supabase (base de données et authentification), Brevo (envoi d'emails), Render (hébergement), OpenStreetMap (cartes) ;</li>
<li>avec les <b>autorités</b>, lorsque la loi l'exige.</li>
</ul>`,
    },
    {
      title: 'Transferts internationaux',
      html: `<p>Vos données peuvent être traitées hors de votre pays de résidence. Dans ce cas, nous nous appuyons sur des garanties appropriées (clauses contractuelles types de la Commission européenne ou équivalent).</p>`,
    },
    {
      title: 'Durée de conservation',
      html: `<ul>
<li>Données de compte : tant que le compte est actif, puis supprimées ou anonymisées dans un délai raisonnable après sa fermeture.</li>
<li>Position GPS : conservée uniquement pour afficher la position actuelle, et remplacée à chaque mise à jour.</li>
<li>Journaux techniques : au maximum 12 mois.</li>
<li>Données soumises à une obligation légale : durée imposée par la loi.</li>
</ul>`,
    },
    {
      title: 'Vos droits',
      html: `<p>Selon votre lieu de résidence, vous disposez des droits suivants : accès, rectification, effacement, limitation, opposition, portabilité, retrait du consentement, et droit de ne pas faire l'objet d'une décision automatisée. Les résidents de Californie ont aussi le droit de savoir, de supprimer et de refuser la vente ou le partage de leurs données (nous ne vendons pas de données).</p>
<p>Pour exercer vos droits, écrivez à <a href="mailto:${email}">${email}</a>. Nous répondons dans un délai d'un mois. Vous pouvez aussi saisir votre autorité de protection des données.</p>
<div class="note"><b>Suppression du compte :</b> envoyez une demande à <a href="mailto:${email}">${email}</a> depuis l'adresse email de votre compte. Vos données seront supprimées, sauf celles que la loi nous oblige à conserver.</div>`,
    },
    {
      title: 'Sécurité',
      html: `<p>Nous protégeons vos données par le chiffrement des échanges (HTTPS/TLS), le chiffrement des mots de passe, des règles d'accès strictes par rôle (sécurité au niveau des lignes), la limitation du débit des requêtes et la journalisation. Aucune méthode n'étant infaillible, nous vous invitons à choisir un mot de passe robuste et unique.</p>`,
    },
    {
      title: 'Autorisations de l\'application',
      html: `<ul>
<li><b>Localisation</b> : pour afficher les artisans proches et localiser une demande. Refusable ; certaines fonctions seront alors limitées.</li>
<li><b>Internet</b> : pour communiquer avec nos serveurs.</li>
</ul>
<p>L'application n'accède ni à vos contacts, ni à votre micro, ni à vos SMS.</p>`,
    },
    {
      title: 'Cookies et traceurs',
      html: `<p>L'application mobile n'utilise pas de cookies publicitaires. Le tableau de bord web utilise uniquement des éléments de stockage strictement nécessaires à la connexion et à la sécurité.</p>`,
    },
    {
      title: 'Mineurs',
      html: `<p>${name} s'adresse aux personnes de 16 ans et plus. Nous ne collectons pas sciemment de données concernant des enfants. Si vous pensez qu'un mineur nous a transmis des données, contactez-nous pour les supprimer.</p>`,
    },
    {
      title: 'Modifications de cette politique',
      html: `<p>Nous pouvons mettre à jour cette politique. La date de dernière mise à jour figure en haut de la page ; en cas de changement important, nous vous en informerons dans l'application ou par email.</p>`,
    },
  ];
  return sections;
};

export const renderPrivacyPage = (branding: Branding, baseUrl: string, custom?: CustomDoc | null): string =>
  layout({
    title: 'Politique de confidentialité',
    intro: 'Comment nous collectons, utilisons et protégeons vos données personnelles.',
    sections: custom ? sectionsFromHtml(custom.html) : privacySections(branding, baseUrl),
    updated: custom?.updatedAt,
    branding,
    baseUrl,
    other: { href: `${baseUrl}/legal/terms`, label: 'Lire les conditions d\'utilisation →' },
  });

export type LegalSlug = 'privacy' | 'terms';

/** HTML modifiable par défaut : chaque section devient un <h2> suivi de son contenu. */
export const defaultLegalHtml = (slug: LegalSlug, branding: Branding, baseUrl: string): string =>
  (slug === 'privacy' ? privacySections(branding, baseUrl) : termsSections(branding, baseUrl))
    .map((s) => `<h2>${s.title}</h2>\n${s.html}`)
    .join('\n');

const termsSections = (branding: Branding, baseUrl: string): Section[] => {
  const email = escapeHtml(branding.contactEmail);
  const name = escapeHtml(branding.platformName);
  const sections: Section[] = [
    {
      title: 'Acceptation des conditions',
      html: `<p>En créant un compte ou en utilisant ${name}, vous acceptez les présentes conditions d'utilisation ainsi que notre <a href="${baseUrl}/legal/privacy">politique de confidentialité</a>. Si vous les refusez, n'utilisez pas le service.</p>`,
    },
    {
      title: 'Le service',
      html: `<p>${name} est une plateforme de mise en relation entre des <b>clients</b> qui recherchent un service et des <b>artisans</b> qui le proposent. Le service comprend notamment la recherche d'artisans à proximité, la demande de devis, l'assignation des devis par l'équipe d'administration et un tableau de bord pour les artisans.</p>
<div class="note">${name} agit comme intermédiaire technique. Nous ne sommes pas partie au contrat conclu entre un client et un artisan et nous ne fournissons pas nous-mêmes les prestations.</div>`,
    },
    {
      title: 'Comptes et éligibilité',
      html: `<ul>
<li>Vous devez avoir 16 ans minimum et la capacité de contracter.</li>
<li>Les informations fournies doivent être exactes et tenues à jour.</li>
<li>Vous êtes responsable de la confidentialité de vos identifiants et de toute activité réalisée depuis votre compte.</li>
<li>Un compte est personnel et ne peut pas être cédé.</li>
</ul>`,
    },
    {
      title: 'Obligations des clients',
      html: `<ul>
<li>Décrire fidèlement le besoin et fournir une localisation exacte.</li>
<li>Traiter les artisans avec respect et régler les prestations convenues directement avec eux.</li>
</ul>`,
    },
    {
      title: 'Obligations des artisans',
      html: `<ul>
<li>Disposer des qualifications, assurances et autorisations exigées par la loi pour leur activité.</li>
<li>Fournir des devis honnêtes et réaliser les travaux acceptés avec diligence et professionnalisme.</li>
<li>Respecter la législation applicable (consommation, fiscalité, sécurité).</li>
</ul>`,
    },
    {
      title: 'Devis et prestations',
      html: `<p>Les devis sont établis par les artisans et ne deviennent contractuels qu'après acceptation par le client. Le prix, les délais et les modalités de paiement relèvent exclusivement de l'accord entre le client et l'artisan. ${name} n'encaisse aucun paiement et ne garantit pas la qualité des prestations.</p>`,
    },
    {
      title: 'Comportements interdits',
      html: `<ul>
<li>Publier des informations fausses, trompeuses ou illicites, ou usurper l'identité d'autrui.</li>
<li>Harceler, menacer ou discriminer un autre utilisateur.</li>
<li>Tenter de contourner la sécurité, d'accéder sans autorisation aux systèmes ou d'extraire les données de manière automatisée.</li>
<li>Utiliser le service à des fins frauduleuses ou contraires à la loi.</li>
</ul>`,
    },
    {
      title: 'Propriété intellectuelle',
      html: `<p>La marque ${name}, le logo, l'application et leur contenu sont protégés. Aucun droit ne vous est cédé en dehors d'un droit personnel, non exclusif et révocable d'utiliser le service. Vous conservez vos droits sur les contenus que vous publiez et nous accordez une licence limitée pour les afficher dans le cadre du service.</p>`,
    },
    {
      title: 'Données personnelles',
      html: `<p>Le traitement de vos données est décrit dans notre <a href="${baseUrl}/legal/privacy">politique de confidentialité</a>.</p>`,
    },
    {
      title: 'Disponibilité et modifications du service',
      html: `<p>Nous nous efforçons d'assurer un service continu, sans garantie d'absence d'interruption (maintenance, incident, force majeure). Nous pouvons faire évoluer, suspendre ou arrêter certaines fonctionnalités.</p>`,
    },
    {
      title: 'Limitation de responsabilité',
      html: `<p>Dans la limite permise par la loi, ${name} et son éditeur ne sont pas responsables des dommages indirects, de la perte de profits ou de données, ni des litiges entre utilisateurs ou des défauts d'exécution d'une prestation. Rien dans ces conditions n'exclut une responsabilité qui ne peut l'être légalement, notamment en cas de dol ou de faute lourde.</p>`,
    },
    {
      title: 'Suspension et résiliation',
      html: `<p>Vous pouvez fermer votre compte à tout moment en nous écrivant. Nous pouvons suspendre ou supprimer un compte en cas de non-respect de ces conditions, de fraude ou d'obligation légale, avec un préavis lorsque cela est possible.</p>`,
    },
    {
      title: 'Droit applicable et litiges',
      html: `<p>Ces conditions sont régies par le droit applicable au lieu d'établissement de l'éditeur, sans préjudice des règles impératives de protection des consommateurs de votre pays de résidence. Avant toute action, nous vous invitons à nous contacter afin de rechercher une solution amiable.</p>`,
    },
    {
      title: 'Modifications des conditions',
      html: `<p>Nous pouvons modifier ces conditions. Les changements importants vous seront notifiés ; la poursuite de l'utilisation du service après leur entrée en vigueur vaut acceptation.</p>`,
    },
  ];
  return sections;
};

export const renderTermsPage = (branding: Branding, baseUrl: string, custom?: CustomDoc | null): string =>
  layout({
    title: 'Conditions d\'utilisation',
    intro: 'Les règles qui encadrent l\'utilisation de la plateforme par les clients et les artisans.',
    sections: custom ? sectionsFromHtml(custom.html) : termsSections(branding, baseUrl),
    updated: custom?.updatedAt,
    branding,
    baseUrl,
    other: { href: `${baseUrl}/legal/privacy`, label: 'Lire la politique de confidentialité →' },
  });
