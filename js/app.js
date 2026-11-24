/* =========================================================
   Jonas International — Site de commande B2B
   Application en JavaScript natif, sans dépendance.

   - Les données viennent de produits.json (à régénérer chaque
     soir à 20 h depuis l'ERP).
   - Le routage se fait par l'ancre de l'URL (#/rayon/menage…),
     ce qui permet d'héberger le site sur n'importe quel serveur
     de fichiers statiques.
   - Le panier est gardé en mémoire (variable `panier`).
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Réglages à adapter ---------- */
  const CONFIG = {
    // Numéro WhatsApp du commercial, au format international sans « + » (ex. 33612345678).
    numeroWhatsApp: '[NUMÉRO]',
    // Remise palette : prix palette = prix colis unitaire × 0,95.
    coefPalette: 0.95,
    // TVA utilisée pour calculer la marge à partir du PVC TTC.
    tva: 0.20,
    // Durée d'affichage de chaque visuel du carrousel (ms).
    dureeCarrousel: 5000,
    // Panier de départ (démo) : 2 colis de vinaigre = 16,80 € HT, comme sur la maquette.
    panierInitial: [{ ref: 'MG076', type: 'colis', qte: 2 }],
    // Historique client utilisé par « Réassort Express » (démo, à brancher sur l'ERP).
    historique: [
      { ref: 'MG076', type: 'colis', qte: 4 },
      { ref: '12385', type: 'colis', qte: 2 },
      { ref: '18885', type: 'colis', qte: 3 },
      { ref: '2748', type: 'colis', qte: 2 },
      { ref: '2750', type: 'colis', qte: 1 }
    ],
    // Reliquats (démo, à brancher sur l'ERP).
    reliquats: [
      { ref: '2752', commande: 'CDE-[N°]', colis: 3, prevu: 'Prochain arrivage' },
      { ref: 'JO077', commande: 'CDE-[N°]', colis: 2, prevu: 'Prochain arrivage' }
    ]
  };

  /* ---------- État de l'application ---------- */
  let data = null;               // contenu de produits.json
  let produitsParRef = new Map(); // accès rapide par référence
  const panier = new Map();      // clé « REF|colis » ou « REF|palette » → quantité
  let minuterieCarrousel = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app');

  /* =========================================================
     Outils de calcul et de mise en forme
     ========================================================= */
  const fmtEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

  /** Affiche un prix, ou « X,XX € » si la donnée manque. */
  function prix(n) {
    return n == null ? 'X,XX €' : fmtEuro.format(n);
  }

  /** Affiche un nombre de pièces (1 152), ou « X » si la donnée manque. */
  function pieces(n) {
    return n == null ? 'X' : n.toLocaleString('fr-FR');
  }

  /** Prix palette = prix colis × 0,95, arrondi au centime (calcul en centimes pour éviter les erreurs d'arrondi). */
  function prixPalette(p) {
    if (p.prixUnitaire == null) return null;
    const centimes = Math.round(p.prixUnitaire * 100);
    return Math.round(centimes * CONFIG.coefPalette) / 100;
  }

  /** Marge magasin (%) = (PVC HT − prix d'achat) / PVC HT. */
  function marge(p) {
    if (p.pvc == null || p.prixUnitaire == null) return null;
    const pvcHT = p.pvc / (1 + CONFIG.tva);
    return ((pvcHT - p.prixUnitaire) / pvcHT) * 100;
  }

  /**
   * Le produit peut-il être ajouté au colis / à la palette ?
   * Seule la rupture palette bloque l'ajout. Un produit dont le prix ou le colisage
   * manque reste commandable : sa ligne est marquée « prix à confirmer ».
   */
  function peutAjouter(p, type) {
    return type === 'colis' || p.paletteDisponible;
  }

  /** Montant d'une ligne de panier, ou null si le prix ou le nombre de pièces manque. */
  function montantLigne(p, type, qte) {
    const nbPieces = type === 'colis' ? p.piecesColis : p.piecesPalette;
    const pu = type === 'colis' ? p.prixUnitaire : prixPalette(p);
    if (nbPieces == null || pu == null) return null;
    return qte * nbPieces * pu;
  }

  /**
   * Total du panier = Σ colis × pièces/colis × prix unitaire + Σ palettes × pièces/palette × prix palette.
   * Les lignes sans prix connu ne sont pas comptées : elles sont signalées à part (aConfirmer).
   */
  function totalPanier() {
    let total = 0, aConfirmer = 0;
    for (const [cle, qte] of panier) {
      const [ref, type] = cle.split('|');
      const m = montantLigne(produitsParRef.get(ref), type, qte);
      if (m == null) aConfirmer++; else total += m;
    }
    return { total: Math.round(total * 100) / 100, aConfirmer };
  }

  function comptePanier() {
    let colis = 0, palettes = 0;
    for (const [cle, qte] of panier) {
      if (cle.endsWith('|colis')) colis += qte; else palettes += qte;
    }
    return { colis, palettes };
  }

  function libelleQuantite(qte, type) {
    if (type === 'colis') return `${qte} colis`;
    return `${qte} palette${qte > 1 ? 's' : ''}`;
  }

  /** Normalise un texte pour la recherche (minuscules, sans accents). */
  function normaliser(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /** Échappe le HTML des données (sécurité). */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* =========================================================
     Icônes SVG (dessinées à la main, sans dépendance)
     ========================================================= */
  const ICONES = {
    carton: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/><path d="m7.5 5.2 9 4.6"/></svg>',
    palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="7" height="6" rx=".5"/><rect x="13" y="3" width="7" height="6" rx=".5"/><rect x="4" y="10" width="16" height="5" rx=".5"/><path d="M2 17h20M2 20h20M4 17v3M12 17v3M20 17v3"/></svg>',
    panier: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-8H6.3"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>',
    reassort: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    excel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    fleche: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    coche: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>'
  };

  /* =========================================================
     Carte produit (modèle validé)
     ========================================================= */
  function stepper(p, type) {
    const qte = panier.get(`${p.ref}|${type}`) || 0;
    const ok = peutAjouter(p, type);
    const nom = type === 'colis' ? 'colis' : 'palette';
    return `
      <div class="stepper">
        <button type="button" class="minus" data-step="-1" data-ref="${esc(p.ref)}" data-type="${type}"
          aria-label="Retirer un ${nom} — ${esc(p.designation)}" ${qte === 0 ? 'disabled' : ''}>−</button>
        <output data-qte="${esc(p.ref)}|${type}" aria-live="polite">${qte}</output>
        <button type="button" class="plus" data-step="1" data-ref="${esc(p.ref)}" data-type="${type}"
          aria-label="Ajouter un ${nom} — ${esc(p.designation)}" ${ok ? '' : 'disabled'}>+</button>
      </div>`;
  }

  function carteProduit(p) {
    const m = marge(p);
    const pPal = prixPalette(p);
    const ruptPalette = !p.paletteDisponible;
    const refEan = `Réf. ${esc(p.ref)} · EAN ${p.ean ? esc(p.ean) : 'X'}`;
    return `
      <article class="card">
        <div class="card__photo">
          ${p.badge ? `<span class="badge badge--${esc(p.badge)}">${esc(p.badge)}</span>` : ''}
          <img src="images/produits/${encodeURIComponent(p.ref)}.jpg" alt="${esc(p.designation)}" loading="lazy" width="700" height="700">
        </div>
        <div class="card__body">
          <p class="card__brand">${esc(p.marque)}</p>
          <h3 class="card__name">${esc(p.designation)}</h3>
          <p class="card__ref">${refEan}</p>
          <p class="card__pvc">PVC ${prix(p.pvc)} <span>·</span> Marge ${m == null ? 'X' : m.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}&nbsp;%</p>

          <div class="buy">
            <div class="buy__block buy__block--colis">
              <div class="buy__head">
                <span class="buy__qty" title="Colis">${ICONES.carton}<span>${pieces(p.piecesColis)} <small>pces</small></span></span>
                <span class="buy__price">${prix(p.prixUnitaire)}<small>/pce</small></span>
              </div>
              <span class="sr-only">Colis de ${pieces(p.piecesColis)} pièces</span>
              ${stepper(p, 'colis')}
            </div>
            <div class="buy__block buy__block--palette">
              <div class="buy__head">
                <span class="buy__qty" title="Palette">${ICONES.palette}<span>${pieces(p.piecesPalette)} <small>pces</small></span></span>
                ${ruptPalette
                  ? '<span class="buy__note">Rupture</span>'
                  : `<span class="buy__price">${prix(pPal)}<small>/pce</small></span>`}
              </div>
              <span class="sr-only">Palette de ${pieces(p.piecesPalette)} pièces${ruptPalette ? ', en rupture' : ''}</span>
              ${stepper(p, 'palette')}
            </div>
          </div>
        </div>
      </article>`;
  }

  /* =========================================================
     Panier
     ========================================================= */
  function changerQuantite(ref, type, delta, { silencieux = false } = {}) {
    const p = produitsParRef.get(ref);
    if (!p) return;
    if (delta > 0 && !peutAjouter(p, type)) return;
    const cle = `${ref}|${type}`;
    const qte = Math.max(0, (panier.get(cle) || 0) + delta);
    if (qte === 0) panier.delete(cle); else panier.set(cle, qte);
    majPanier(ref);
    if (!silencieux && delta > 0) toast(`${libelleQuantite(qte, type)} · ${p.designation}`);
  }

  /** Met à jour tous les affichages liés au panier. */
  function majPanier(ref) {
    const { total: montant, aConfirmer } = totalPanier();
    const total = prix(montant) + ' HT';
    $('#cart-total-header').textContent = total;
    $('#cart-bar-total').textContent = total;
    $('#drawer-total').textContent = total;
    const { colis, palettes } = comptePanier();
    const parts = [];
    if (colis) parts.push(libelleQuantite(colis, 'colis'));
    if (palettes) parts.push(libelleQuantite(palettes, 'palette'));
    if (aConfirmer) parts.push(`${aConfirmer} prix à confirmer`);
    $('#cart-bar-count').textContent = parts.length ? parts.join(' · ') : 'Panier vide';
    $('#drawer-note').hidden = !aConfirmer;
    $('#drawer-note').textContent = `+ ${aConfirmer} ligne${aConfirmer > 1 ? 's' : ''} au prix à confirmer par votre commercial`;

    // Sélecteurs des cartes visibles
    const refs = ref ? [ref] : [...produitsParRef.keys()];
    refs.forEach(r => {
      ['colis', 'palette'].forEach(type => {
        const qte = panier.get(`${r}|${type}`) || 0;
        document.querySelectorAll(`output[data-qte="${CSS.escape(r + '|' + type)}"]`).forEach(o => {
          o.textContent = qte;
          const moins = o.previousElementSibling;
          if (moins) moins.disabled = qte === 0;
        });
      });
    });

    const btn = $('#cart-btn');
    btn.classList.remove('is-bump'); void btn.offsetWidth; btn.classList.add('is-bump');
    if (!$('#drawer').hidden) rendreTiroir();
  }

  function rendreTiroir() {
    const corps = $('#drawer-body');
    if (panier.size === 0) {
      corps.innerHTML = '<div class="empty"><strong>Votre panier est vide</strong>Ajoutez des colis ou des palettes depuis le catalogue.</div>';
      $('#checkout-btn').disabled = true;
      return;
    }
    $('#checkout-btn').disabled = false;
    corps.innerHTML = [...panier].map(([cle, qte]) => {
      const [ref, type] = cle.split('|');
      const p = produitsParRef.get(ref);
      const pu = type === 'colis' ? p.prixUnitaire : prixPalette(p);
      const nbPces = type === 'colis' ? p.piecesColis : p.piecesPalette;
      const m = montantLigne(p, type, qte);
      return `
        <div class="line">
          <img src="images/produits/${encodeURIComponent(ref)}.jpg" alt="">
          <div>
            <p class="line__name">${esc(p.designation)}</p>
            <p class="line__detail">${libelleQuantite(qte, type)} × ${pieces(nbPces)} pces × ${prix(pu)}</p>
            <button type="button" class="line__remove" data-remove="${esc(cle)}">Retirer</button>
          </div>
          <div class="line__total">${m == null ? '<span class="line__tbc">Prix à<br>confirmer</span>' : prix(m)}</div>
        </div>`;
    }).join('');
  }

  function ouvrirTiroir() {
    rendreTiroir();
    $('#drawer').hidden = false;
    $('#drawer-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#drawer-close').focus();
  }
  function fermerTiroir() {
    $('#drawer').hidden = true;
    $('#drawer-overlay').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- Toast ---------- */
  let minuterieToast = null;
  function toast(texte) {
    const t = $('#toast');
    t.textContent = texte;
    t.classList.add('is-visible');
    clearTimeout(minuterieToast);
    minuterieToast = setTimeout(() => t.classList.remove('is-visible'), 2200);
  }

  /* =========================================================
     Pages
     ========================================================= */
  const SELECTIONS = {
    nouveautes: { kicker: 'Arrivages', titre: 'Les Nouveautés', couleur: 'noir', image: 'images/selections/nouveautes.jpg' },
    imbattables: { kicker: 'Prix bas toute l\'année', titre: 'Les Imbattables', couleur: 'jaune', image: 'images/selections/imbattables.jpg' },
    'top-ub': { kicker: 'Meilleures rotations', titre: 'Les Top UB', couleur: 'rouge', image: 'images/selections/top-ub.jpg' }
  };

  const OFFRES = [
    { marque: 'Ultranet', titre: 'Ménage malin', fond: '#1F4D3A', texte: '#FFFFFF', image: 'images/hero/hero-tampons.jpg', lien: '#/rayon/menage?sc=' + encodeURIComponent('Tampons & éponges') },
    { marque: 'Ultranet', titre: 'Sols nickel', fond: '#7A1630', texte: '#FFFFFF', image: 'images/hero/hero-housse-sol.jpg', lien: '#/rayon/menage?sc=Microfibre' },
    { marque: 'Mamie Georgette', titre: 'Recettes de grand-mère', fond: '#2A2A2A', texte: '#FFFFFF', image: 'images/produits/MG076.jpg', contain: true, lien: '#/marque/' + encodeURIComponent('Les Secrets de Mamie Georgette') },
    { marque: 'Jardin d\'Orient', titre: 'Brosserie', fond: '#2B2118', texte: '#E9D7B5', image: 'images/hero/hero-brosserie.jpg', lien: '#/rayon/menage?sc=Brosserie' },
    { marque: 'Jardin d\'Orient', titre: 'Dubai style, parfums de linge', fond: '#5A3A1E', texte: '#FFFFFF', image: 'images/produits/JO013.jpg', contain: true, lien: '#/rayon/maison?sc=' + encodeURIComponent('Parfums de linge') },
    { marque: 'Biguine Paris', titre: 'Beauté cheveux', fond: '#111111', texte: '#E8C77A', image: 'images/produits/JCB015.jpg', contain: true, lien: '#/rayon/beaute' }
  ];

  const MARQUES = [
    { nom: 'Jardin d\'Orient', sous: 'Entretien', cls: 'jo', filtre: 'Jardin d\'Orient' },
    { nom: 'Mamie Georgette', sous: 'Naturel', cls: 'mg', filtre: 'Les Secrets de Mamie Georgette' },
    { nom: 'ULTRAnet', sous: 'Ménage', cls: 'ul', filtre: 'Ultranet' },
    { nom: 'BIGUINE', sous: 'Paris', cls: 'bg', filtre: 'Biguine Paris' },
    { nom: 'Lilas', sous: 'Hygiène', cls: 'li', filtre: 'Lilas' },
    { nom: 'KYUFI', sous: 'Thés', cls: 'ky', filtre: 'Kyufi' }
  ];

  /* ---------- Accueil ---------- */
  function pageAccueil() {
    const c = data.client;
    app.innerHTML = `
      <div class="container">
        <p class="welcome"><strong>Bienvenue ${esc(c.civilite)} ${esc(c.nom)},</strong><span>ravi de vous revoir.</span></p>

        <!-- Carrousel principal -->
        <section class="hero" aria-roledescription="carrousel" aria-label="À la une">
          <div class="hero__track" id="hero-track">
            <div class="slide slide--jaune" role="group" aria-roledescription="diapositive" aria-label="1 sur 3">
              <div class="slide__text">
                <span class="slide__tag">TOP UB</span>
                <h2 class="slide__title">Le ménage à prix choc</h2>
                <div class="slide__pastille" aria-label="À partir de 0,50 € HT par pièce"><small>À PARTIR DE</small><b>0,50&nbsp;€</b><small>HT / PIÈCE</small></div>
              </div>
              <div class="slide__img"><img src="images/hero/hero-tampons.jpg" alt="Tampon à récurer inox en action"></div>
              <a href="#/selection/top-ub" class="btn btn--red slide__cta">DÉCOUVRIR ${ICONES.fleche}</a>
            </div>
            <div class="slide slide--noir" role="group" aria-roledescription="diapositive" aria-label="2 sur 3">
              <div class="slide__text">
                <span class="slide__tag">IMBATTABLES</span>
                <h2 class="slide__title">Prix bas toute l'année</h2>
              </div>
              <div class="slide__img"><img src="images/hero/hero-housse-sol.jpg" alt="Housse de balai microfibre" loading="lazy"></div>
              <a href="#/selection/imbattables" class="btn btn--red slide__cta">DÉCOUVRIR ${ICONES.fleche}</a>
            </div>
            <div class="slide slide--rouge" role="group" aria-roledescription="diapositive" aria-label="3 sur 3">
              <div class="slide__text">
                <span class="slide__tag">NOUVEAUTÉ</span>
                <h2 class="slide__title">Vinaigre ménager citron</h2>
                <p class="slide__sub">Les Secrets de Mamie Georgette</p>
              </div>
              <div class="slide__img slide__img--contain"><img src="images/produits/MG076.jpg" alt="Vinaigre ménager citron 1 L" loading="lazy"></div>
              <a href="#/recherche?q=MG076" class="btn btn--red slide__cta">DÉCOUVRIR ${ICONES.fleche}</a>
            </div>
          </div>
          <div class="hero__dots" id="hero-dots" role="tablist" aria-label="Choisir un visuel">
            ${[0, 1, 2].map(i => `<button type="button" role="tab" aria-label="Visuel ${i + 1}" data-slide="${i}"></button>`).join('')}
          </div>
        </section>

        <!-- Cartes d'action -->
        <div class="actions">
          <a href="#/catalogue" class="action action--wide">
            <span class="action__icon">${ICONES.panier}</span>
            <span><span class="action__title">Je commande</span><br><span class="action__sub">Parcourir le catalogue</span></span>
            <span class="action__chev">${ICONES.chevron}</span>
          </a>
          <a href="#/reassort" class="action action--red">
            <span class="action__icon">${ICONES.reassort}</span>
            <span class="action__title">Réassort Express</span>
            <span class="action__sub">Depuis mon historique</span>
          </a>
          <a href="#/import" class="action">
            <span class="action__icon">${ICONES.excel}</span>
            <span class="action__title">Import Excel</span>
            <span class="action__sub">Références → panier</span>
          </a>
        </div>

        <!-- Points de confiance -->
        <ul class="trust">
          ${['Stock à jour chaque soir', 'Prix colis & palette', 'Livraison France & Europe', 'Commercial dédié']
            .map(t => `<li><span class="trust__check">${ICONES.coche}</span>${t}</li>`).join('')}
        </ul>

        <!-- Le discount du quotidien -->
        <section class="section">
          <h2 class="section__title">Le discount du quotidien</h2>
          <div class="tiles">
            ${Object.entries(SELECTIONS).map(([id, s]) => `
              <a href="#/selection/${id}" class="tile tile--${s.couleur}" style="background-image:url('${s.image}')">
                <div class="tile__text">
                  <p class="tile__kicker">${esc(s.kicker)}</p>
                  <h3 class="tile__title">${esc(s.titre)}</h3>
                  <span class="btn tile__btn">Voir ${ICONES.fleche}</span>
                </div>
              </a>`).join('')}
          </div>
        </section>

        <!-- Nos offres du moment -->
        <section class="section">
          <h2 class="section__title">Nos offres du moment</h2>
          <div class="offers">
            ${OFFRES.map(o => `
              <a href="${o.lien}" class="offer" style="background:${o.fond};color:${o.texte}">
                <div class="offer__text">
                  <span class="offer__brand">${esc(o.marque)}</span>
                  <h3 class="offer__title">${esc(o.titre)}</h3>
                  <span class="offer__cta">Découvrir →</span>
                </div>
                <div class="offer__img ${o.contain ? 'offer__img--contain' : ''}"><img src="${o.image}" alt="" loading="lazy"></div>
              </a>`).join('')}
          </div>
        </section>

        <!-- Nos marques -->
        <section class="section">
          <h2 class="section__title">Nos marques</h2>
          <div class="brands">
            ${MARQUES.map(m => `
              <a href="#/marque/${encodeURIComponent(m.filtre)}" class="brand brand--${m.cls}">
                <span class="brand__name">${esc(m.nom)}</span>
                <span class="brand__sub">${esc(m.sous)}</span>
              </a>`).join('')}
          </div>
        </section>
      </div>`;
    demarrerCarrousel();
  }

  /* ---------- Carrousel (défilement auto toutes les 5 s) ---------- */
  function demarrerCarrousel() {
    const piste = $('#hero-track');
    const points = [...document.querySelectorAll('#hero-dots button')];
    const nb = points.length;
    let index = 0;

    const aller = i => {
      index = (i + nb) % nb;
      piste.style.transform = `translateX(-${index * 100}%)`;
      points.forEach((b, j) => b.setAttribute('aria-current', j === index ? 'true' : 'false'));
      [...piste.children].forEach((s, j) => s.setAttribute('aria-hidden', j === index ? 'false' : 'true'));
    };
    const relancer = () => {
      clearInterval(minuterieCarrousel);
      minuterieCarrousel = setInterval(() => aller(index + 1), CONFIG.dureeCarrousel);
    };
    points.forEach(b => b.addEventListener('click', () => { aller(+b.dataset.slide); relancer(); }));

    // Glisser du doigt sur téléphone
    let x0 = null;
    piste.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    piste.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { aller(index + (dx < 0 ? 1 : -1)); relancer(); }
      x0 = null;
    });

    aller(0);
    relancer();
  }

  /* ---------- Liste de produits (rayon, sélection, recherche, marque) ---------- */
  const TRIS = {
    pertinence: { libelle: 'Pertinence', fn: null },
    'prix-asc': { libelle: 'Prix croissant', fn: (a, b) => (a.prixUnitaire ?? Infinity) - (b.prixUnitaire ?? Infinity) },
    'prix-desc': { libelle: 'Prix décroissant', fn: (a, b) => (b.prixUnitaire ?? -Infinity) - (a.prixUnitaire ?? -Infinity) },
    nom: { libelle: 'Désignation A → Z', fn: (a, b) => a.designation.localeCompare(b.designation, 'fr') },
    ref: { libelle: 'Référence', fn: (a, b) => a.ref.localeCompare(b.ref, 'fr', { numeric: true }) }
  };

  /**
   * Affiche une page de liste : bandeau + pastilles + tri + grille.
   * @param {object} o  { bandeau (HTML), produits, sousCategories, sc (pastille active), vide (message) }
   */
  function pageListe(o) {
    let sc = o.sc && o.sousCategories.includes(o.sc) ? o.sc : 'Tout';
    let tri = 'pertinence';

    app.innerHTML = `
      <div class="container">
        ${o.bandeau}
        <div class="toolbar">
          ${o.sousCategories.length ? `<div class="chips" role="group" aria-label="Sous-catégories">
            ${['Tout', ...o.sousCategories].map(s => `<button type="button" class="chip" data-sc="${esc(s)}" aria-pressed="${s === sc}">${esc(s)}</button>`).join('')}
          </div>` : '<div></div>'}
          <div class="toolbar__right">
            <span class="toolbar__count" id="count"></span>
            <label class="sort"><span class="sr-only">Trier par</span>
              <select id="sort">${Object.entries(TRIS).map(([k, t]) => `<option value="${k}">${t.libelle}</option>`).join('')}</select>
            </label>
          </div>
        </div>
        <div id="grid"></div>
      </div>`;

    const rendre = () => {
      let liste = o.produits.filter(p => sc === 'Tout' || p.sousCategorie === sc);
      if (TRIS[tri].fn) liste = [...liste].sort(TRIS[tri].fn);
      $('#count').textContent = `${liste.length} produit${liste.length > 1 ? 's' : ''}`;
      $('#grid').innerHTML = liste.length
        ? `<div class="grid">${liste.map(carteProduit).join('')}</div>`
        : `<div class="empty"><strong>${o.vide || 'Aucun produit pour le moment'}</strong>Votre commercial peut vous renseigner sur les prochains arrivages.</div>`;
    };

    app.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      sc = b.dataset.sc;
      app.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      rendre();
    }));
    $('#sort').addEventListener('change', e => { tri = e.target.value; rendre(); });
    rendre();
  }

  function bandeauSimple(kicker, titre, couleur = '') {
    return `<div class="rayon-banner rayon-banner--plain ${couleur ? 'rayon-banner--' + couleur : ''}">
      <div class="rayon-banner__text"><p class="rayon-banner__kicker">${esc(kicker)}</p><h1>${esc(titre)}</h1></div>
    </div>`;
  }

  function pageRayon(id, params) {
    const r = data.rayons.find(x => x.id === id);
    if (!r) return pageIntrouvable();
    // Bandeau photo : image dédiée si elle existe (images/rayons/<id>-ordinateur.jpg / -telephone.jpg)
    const avecPhoto = id === 'menage';
    const bandeau = avecPhoto
      ? `<div class="rayon-banner">
          <picture>
            <source media="(min-width: 720px)" srcset="images/rayons/${id}-ordinateur.jpg">
            <img src="images/rayons/${id}-telephone.jpg" alt="">
          </picture>
          <div class="rayon-banner__text"><p class="rayon-banner__kicker">Rayon</p><h1>${esc(r.nom)}</h1></div>
        </div>`
      : bandeauSimple('Rayon', r.nom);
    pageListe({
      bandeau,
      produits: data.produits.filter(p => p.rayon === id),
      sousCategories: r.sousCategories,
      sc: params.get('sc'),
      vide: 'Ce rayon arrive bientôt'
    });
  }

  function pageSelection(id) {
    const s = SELECTIONS[id];
    if (!s) return pageIntrouvable();
    pageListe({
      bandeau: bandeauSimple(s.kicker, s.titre, s.couleur === 'noir' ? '' : s.couleur),
      produits: data.selections[id].map(r => produitsParRef.get(r)).filter(Boolean),
      sousCategories: []
    });
  }

  function pageCatalogue() {
    pageListe({
      bandeau: bandeauSimple('Je commande', 'Tout le catalogue'),
      produits: data.produits,
      sousCategories: []
    });
  }

  function rechercher(q) {
    const n = normaliser(q);
    if (!n) return [];
    const mots = n.split(/\s+/);
    return data.produits.filter(p => {
      const texte = normaliser([p.designation, p.ref, p.ean, p.marque, p.sousCategorie].join(' '));
      return mots.every(m => texte.includes(m));
    });
  }

  function pageRecherche(q) {
    $('#search-input').value = q;
    pageListe({
      bandeau: bandeauSimple('Recherche', `« ${q} »`),
      produits: rechercher(q),
      sousCategories: [],
      vide: 'Aucun produit ne correspond à votre recherche'
    });
  }

  function pageMarque(nom) {
    pageListe({
      bandeau: bandeauSimple('Marque', nom),
      produits: data.produits.filter(p => normaliser(p.marque) === normaliser(nom)),
      sousCategories: [],
      vide: 'Les produits de cette marque arrivent bientôt'
    });
  }

  /* ---------- Réassort Express ---------- */
  function pageReassort() {
    const lignes = CONFIG.historique.filter(h => produitsParRef.has(h.ref));
    app.innerHTML = `
      <div class="container">
        <div class="page-head">
          <h1>Réassort Express</h1>
          <p>Vos produits habituels, prêts à recommander en un geste.</p>
        </div>
        <div class="panel">
          <div class="panel__row" style="margin-top:0;justify-content:space-between">
            <span><strong>Ma dernière commande</strong> — ${lignes.length} références</span>
            <button type="button" class="btn btn--red" id="reassort-all">Tout recommander</button>
          </div>
        </div>
        <div class="grid">${lignes.map(h => carteProduit(produitsParRef.get(h.ref))).join('')}</div>
      </div>`;
    $('#reassort-all').addEventListener('click', () => {
      let n = 0;
      lignes.forEach(h => {
        if (peutAjouter(produitsParRef.get(h.ref), h.type)) { changerQuantite(h.ref, h.type, h.qte, { silencieux: true }); n++; }
      });
      toast(`${n} références ajoutées au panier`);
    });
  }

  /* ---------- Mes reliquats ---------- */
  function pageReliquats() {
    app.innerHTML = `
      <div class="container">
        <div class="page-head">
          <h1>Mes Reliquats</h1>
          <p>Les produits commandés pas encore livrés. Ils partiront automatiquement dès leur arrivée.</p>
        </div>
        <div class="panel table-wrap">
          <table class="table">
            <thead><tr><th>Produit</th><th>Commande</th><th>Reste à livrer</th><th>Prévu</th></tr></thead>
            <tbody>
              ${CONFIG.reliquats.map(r => {
                const p = produitsParRef.get(r.ref);
                return `<tr>
                  <td><strong>${esc(p ? p.designation : r.ref)}</strong><br><small style="color:var(--gris-texte)">Réf. ${esc(r.ref)}</small></td>
                  <td>${esc(r.commande)}</td>
                  <td><strong>${libelleQuantite(r.colis, 'colis')}</strong></td>
                  <td>${esc(r.prevu)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---------- Import Excel ---------- */
  function pageImport() {
    app.innerHTML = `
      <div class="container">
        <div class="page-head">
          <h1>Import Excel</h1>
          <p>Collez vos lignes ou chargez un fichier (.xlsx, .csv) : <strong>référence</strong> ou <strong>EAN</strong>, <strong>quantité</strong>, et éventuellement <strong>colis</strong> ou <strong>palette</strong> (colis par défaut).</p>
        </div>
        <div class="panel">
          <label for="import-text">Vos références</label>
          <textarea id="import-text" placeholder="MG076;4&#10;12385;2;colis&#10;18885;1;palette&#10;3303210937485;3"></textarea>
          <div class="panel__row">
            <button type="button" class="btn btn--red" id="import-go">Ajouter au panier</button>
            <label class="btn btn--outline file-btn">Choisir un fichier
              <input type="file" id="import-file" accept=".xlsx,.xls,.csv,.txt">
            </label>
          </div>
          <div class="report" id="import-report" aria-live="polite"></div>
        </div>
      </div>`;

    $('#import-go').addEventListener('click', () => importerLignes($('#import-text').value.split(/\r?\n/).map(l => l.split(/[;,\t]/))));
    $('#import-file').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        if (/\.xlsx?$/i.test(f.name)) {
          // Lecture Excel : la bibliothèque SheetJS n'est chargée qu'à la demande.
          await chargerScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
          const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
          const lignes = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
          importerLignes(lignes);
        } else {
          importerLignes((await f.text()).split(/\r?\n/).map(l => l.split(/[;,\t]/)));
        }
      } catch (err) {
        $('#import-report').innerHTML = `<p class="ko">Impossible de lire ce fichier (${esc(err.message)}).</p>`;
      }
      e.target.value = '';
    });
  }

  function chargerScript(src) {
    return new Promise((ok, ko) => {
      if (window.XLSX) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => ko(new Error('bibliothèque Excel indisponible'));
      document.head.appendChild(s);
    });
  }

  /** Ajoute au panier des lignes [ref|EAN, quantité, type]. */
  function importerLignes(lignes) {
    const rapport = [];
    let ajouts = 0;
    lignes.forEach(cols => {
      const [code, qteTxt, typeTxt] = (cols || []).map(c => String(c ?? '').trim());
      if (!code) return;
      const qte = parseInt(qteTxt, 10);
      if (!Number.isFinite(qte)) return; // ligne d'en-tête ou vide
      const type = /pal/i.test(typeTxt || '') ? 'palette' : 'colis';
      const p = produitsParRef.get(code.toUpperCase()) || produitsParRef.get(code) || data.produits.find(x => x.ean === code);
      if (!p) { rapport.push(`<p class="ko">✗ ${esc(code)} : référence inconnue</p>`); return; }
      if (qte <= 0) return;
      if (!peutAjouter(p, type)) { rapport.push(`<p class="ko">✗ ${esc(p.ref)} : palette en rupture</p>`); return; }
      changerQuantite(p.ref, type, qte, { silencieux: true });
      ajouts++;
      rapport.push(`<p>✓ ${libelleQuantite(qte, type)} · ${esc(p.designation)}</p>`);
    });
    $('#import-report').innerHTML = rapport.join('') || '<p class="ko">Aucune ligne reconnue.</p>';
    if (ajouts) toast(`${ajouts} ligne${ajouts > 1 ? 's' : ''} ajoutée${ajouts > 1 ? 's' : ''} au panier`);
  }

  /* ---------- Espace client ---------- */
  function pageCompte() {
    const c = data.client;
    app.innerHTML = `
      <div class="container">
        <div class="page-head"><h1>Espace client</h1><p>${esc(c.civilite)} ${esc(c.nom)}</p></div>
        <div class="panel">
          <div class="info-list">
            <div><span>Commercial dédié</span><strong>[NOM DU COMMERCIAL]</strong></div>
            <div><span>Conditions</span><strong>Prix colis & palette HT</strong></div>
            <div><span>Mise à jour du stock</span><strong>Chaque soir à 20 h</strong></div>
          </div>
          <div class="panel__row">
            <a href="#/reassort" class="btn btn--red">Réassort Express</a>
            <a href="#/reliquats" class="btn btn--outline">Mes Reliquats</a>
          </div>
        </div>
      </div>`;
  }

  function pageTexte(titre) {
    app.innerHTML = `<div class="container"><div class="page-head"><h1>${esc(titre)}</h1></div>
      <div class="prose"><p>Jonas France — 189 rue d'Aubervilliers, 75018 Paris.</p><p>[CONTENU À COMPLÉTER]</p></div></div>`;
  }

  function pageIntrouvable() {
    app.innerHTML = `<div class="container"><div class="empty"><strong>Page introuvable</strong><a href="#/" class="btn btn--red" style="margin-top:12px">Retour à l'accueil</a></div></div>`;
  }

  /* =========================================================
     Routage par ancre (#/…)
     ========================================================= */
  function router() {
    clearInterval(minuterieCarrousel);
    if (!$('#drawer').hidden) fermerTiroir();
    const brut = location.hash.replace(/^#/, '') || '/';
    const [chemin, qs] = brut.split('?');
    const params = new URLSearchParams(qs || '');
    const seg = chemin.split('/').filter(Boolean).map(decodeURIComponent);
    let pageProduits = false;

    switch (seg[0]) {
      case undefined: pageAccueil(); break;
      case 'rayon': pageRayon(seg[1], params); pageProduits = true; break;
      case 'selection': pageSelection(seg[1]); pageProduits = true; break;
      case 'catalogue': pageCatalogue(); pageProduits = true; break;
      case 'recherche': pageRecherche(params.get('q') || ''); pageProduits = true; break;
      case 'marque': pageMarque(seg[1] || ''); pageProduits = true; break;
      case 'reassort': pageReassort(); pageProduits = true; break;
      case 'reliquats': pageReliquats(); break;
      case 'import': pageImport(); break;
      case 'compte': pageCompte(); break;
      case 'mentions': pageTexte('Mentions légales'); break;
      case 'cgv': pageTexte('Conditions générales de vente'); break;
      default: pageIntrouvable();
    }

    // Rayon actif dans le menu
    document.querySelectorAll('#rayons-nav a').forEach(a => {
      a.classList.toggle('is-active', seg[0] === 'rayon' && a.dataset.rayon === seg[1]);
    });

    // Barre panier fixe sur téléphone : uniquement sur les pages produits
    $('#cart-bar').hidden = !pageProduits;
    document.body.classList.toggle('has-cart-bar', pageProduits);

    window.scrollTo(0, 0);
  }

  /* =========================================================
     Assistant IA (réponses locales à partir du catalogue).
     Pour brancher un vrai assistant, remplacer repondre()
     par un appel à votre API.
     ========================================================= */
  const QUESTIONS_RAPIDES = [
    'Le vinaigre MG076 est-il en stock ?',
    'Quel est le prix palette ?',
    'Où en est ma commande ?',
    'Quelles sont les nouveautés ?'
  ];

  function repondre(question) {
    const q = normaliser(question);
    const p = data.produits.find(x => q.includes(normaliser(x.ref)) || (x.ean && q.includes(x.ean)));

    if (p) {
      const lignes = [`${p.designation} (réf. ${p.ref}, ${p.marque})`];
      lignes.push(`• Colis de ${pieces(p.piecesColis)} pces à ${prix(p.prixUnitaire)} HT / pce`);
      lignes.push(p.paletteDisponible
        ? `• Palette de ${pieces(p.piecesPalette)} pces à ${prix(prixPalette(p))} HT / pce`
        : '• Palette : actuellement en rupture');
      if (/stock|dispo/.test(q)) lignes.push('Le stock est mis à jour chaque soir à 20 h. Pour réserver une quantité précise, votre commercial vous répond sur WhatsApp.');
      return lignes.join('\n');
    }
    if (/palette/.test(q)) {
      return 'Le prix palette est 5 % moins cher que le prix colis (prix unitaire × 0,95, arrondi au centime).\nExemple : 0,70 € au colis → 0,67 € à la palette.\nDonnez-moi une référence et je vous calcule le prix exact.';
    }
    if (/commande|suivi|livr|reliquat/.test(q)) {
      return 'Vos produits en attente sont dans « Mes Reliquats ». Pour le suivi d\'une livraison, votre commercial vous répond sur WhatsApp (bouton « Mon commercial »).';
    }
    if (/nouveau|arrivage/.test(q)) {
      return 'Nouveautés : ' + data.selections.nouveautes.map(r => produitsParRef.get(r)?.designation).filter(Boolean).join(', ') + '.\nRetrouvez-les dans « Les Nouveautés » sur l\'accueil.';
    }
    const resultats = rechercher(question).slice(0, 3);
    if (resultats.length) {
      return 'Voici ce que j\'ai trouvé :\n' + resultats.map(x => `• ${x.designation} (réf. ${x.ref}) — ${prix(x.prixUnitaire)} HT / pce`).join('\n');
    }
    return 'Je n\'ai pas trouvé de réponse précise. Indiquez-moi une référence ou un gencod, ou contactez votre commercial via le bouton WhatsApp.';
  }

  function ajouterMessage(texte, auteur) {
    const div = document.createElement('div');
    div.className = `msg msg--${auteur}`;
    div.textContent = texte;
    $('#chat-body').appendChild(div);
    $('#chat-body').scrollTop = $('#chat-body').scrollHeight;
  }

  function poser(question) {
    if (!question.trim()) return;
    ajouterMessage(question, 'user');
    setTimeout(() => ajouterMessage(repondre(question), 'bot'), 350);
  }

  function initAssistant() {
    ajouterMessage('Bonjour ! Je suis l\'assistant Jonas, disponible 24h/24. Stock, prix colis et palette, suivi de commande : je vous réponds tout de suite.', 'bot');
    $('#chat-quick').innerHTML = QUESTIONS_RAPIDES.map(q => `<button type="button">${esc(q)}</button>`).join('');
    $('#chat-quick').addEventListener('click', e => { if (e.target.matches('button')) poser(e.target.textContent); });
    $('#chat-form').addEventListener('submit', e => {
      e.preventDefault();
      const champ = $('#chat-input');
      poser(champ.value);
      champ.value = '';
    });
    $('#ia-open').addEventListener('click', () => {
      $('#chat').hidden = false;
      $('#floating').hidden = true;
      $('#chat-input').focus();
    });
    $('#chat-close').addEventListener('click', () => {
      $('#chat').hidden = true;
      $('#floating').hidden = false;
      $('#ia-open').focus();
    });
  }

  /* =========================================================
     Démarrage
     ========================================================= */
  function initEvenements() {
    // Boutons − / + des cartes (délégation)
    app.addEventListener('click', e => {
      const b = e.target.closest('button[data-step]');
      if (b && !b.disabled) changerQuantite(b.dataset.ref, b.dataset.type, +b.dataset.step);
    });

    // Recherche
    $('#search-form').addEventListener('submit', e => {
      e.preventDefault();
      const q = $('#search-input').value.trim();
      if (q) location.hash = '#/recherche?q=' + encodeURIComponent(q);
    });

    // Panier
    $('#cart-btn').addEventListener('click', ouvrirTiroir);
    $('#cart-bar-btn').addEventListener('click', ouvrirTiroir);
    $('#drawer-close').addEventListener('click', fermerTiroir);
    $('#drawer-overlay').addEventListener('click', fermerTiroir);
    $('#drawer-body').addEventListener('click', e => {
      const cle = e.target.dataset.remove;
      if (!cle) return;
      panier.delete(cle);
      majPanier(cle.split('|')[0]);
    });
    $('#checkout-btn').addEventListener('click', () => {
      // À brancher : envoi de la commande à l'ERP / au commercial.
      panier.clear();
      majPanier();
      fermerTiroir();
      toast('Commande transmise à votre commercial');
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#drawer').hidden) fermerTiroir();
      else if (!$('#chat').hidden) $('#chat-close').click();
    });

    // Boutons flottants réduits à l'icône quand on défile (téléphone)
    window.addEventListener('scroll', () => document.body.classList.toggle('is-scrolled', window.scrollY > 300), { passive: true });

    // WhatsApp
    $('#wa-link').href = `https://wa.me/${CONFIG.numeroWhatsApp}`;
    $('#wa-link').setAttribute('aria-label', 'Contacter mon commercial sur WhatsApp');

    window.addEventListener('hashchange', router);
  }

  async function demarrer() {
    try {
      const rep = await fetch('produits.json', { cache: 'no-cache' });
      if (!rep.ok) throw new Error(rep.status);
      data = await rep.json();
    } catch (err) {
      app.innerHTML = `<div class="container"><div class="empty"><strong>Catalogue indisponible</strong>
        Le fichier produits.json n'a pas pu être chargé. Ouvrez le site via un serveur web (voir README).</div></div>`;
      return;
    }
    produitsParRef = new Map(data.produits.map(p => [p.ref, p]));

    // Menu des rayons
    $('#rayons-nav').innerHTML = data.rayons
      .map(r => `<li><a href="#/rayon/${r.id}" data-rayon="${r.id}">${esc(r.nom)}</a></li>`).join('');

    CONFIG.panierInitial.forEach(l => { if (produitsParRef.has(l.ref)) panier.set(`${l.ref}|${l.type}`, l.qte); });

    initEvenements();
    initAssistant();
    majPanier();
    $('#cart-btn').classList.remove('is-bump');
    router();
  }

  demarrer();
})();
