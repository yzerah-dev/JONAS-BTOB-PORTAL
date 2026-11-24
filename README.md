# Jonas International — Site de commande B2B

Site de commande pour les magasins et enseignes clients de Jonas France (commande **au colis ou à la palette**).
HTML + CSS + JavaScript natif, sans compilation. Responsive : téléphone (390 px) → ordinateur (1400 px).

## Lancer le site

Le catalogue est chargé depuis `produits.json` : il faut passer par un serveur web (un double-clic sur `index.html` ne suffit pas).

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

N'importe quel hébergement de fichiers statiques convient (Netlify, OVH, serveur interne…).

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Gabarit commun : bande noire, en-tête, menu des rayons, pied de page, boutons flottants, panier, assistant |
| `css/styles.css` | Charte (noir #111, rouge #E2321F, jaune #F2C230, fond blanc), mobile d'abord |
| `js/app.js` | Pages, carte produit, panier, carrousel, recherche, import Excel, assistant. Réglages en haut du fichier (`CONFIG`) |
| `produits.json` | Client connecté, rayons, sélections et produits |
| `images/` | Logos, visuels, photos produits (`images/produits/<réf>.jpg`) |

## Pages (adresse après `#`)

- `#/` accueil · `#/rayon/menage` page rayon · `#/selection/nouveautes` (`imbattables`, `top-ub`)
- `#/catalogue` · `#/recherche?q=…` · `#/marque/Ultranet`
- `#/reassort` Réassort Express · `#/reliquats` Mes Reliquats · `#/import` Import Excel · `#/compte` Espace client

## Règles de calcul

- Prix palette = prix colis unitaire × 0,95, arrondi au centime (calculé, pas stocké).
- Total panier = Σ (colis × pièces/colis × prix unitaire) + Σ (palettes × pièces/palette × prix palette).
- Marge = (PVC HT − prix unitaire) / PVC HT, avec PVC HT = PVC TTC / 1,20.
- Donnée manquante (`null` dans `produits.json`) : affichage « X,XX € » / « X pces ». Le produit reste commandable ; sa ligne est marquée « prix à confirmer » et n'entre pas dans le total.
- `paletteDisponible: false` : le + palette est désactivé (« Rupture »).

## Modes d'achat

Sélecteur en haut de toutes les pages (dans l'en-tête, et dans la barre compacte au défilement sur ordinateur) :

- **Standard** : au colis ou à la palette, cartes avec les deux blocs.
- **Trade Pal** : achat à la palette uniquement. Seul le bloc palette est affiché, et les produits en rupture palette sont masqués. Le panier montre le remplissage du camion (palettes / 33).
- **Trade Truck** (camion complet, MOQ 1 camion) : seuls les produits `eligibleCamion: true` sont affichés. 1 camion = `palettesParCamion` palettes (33 par défaut, `CONFIG.palettesParCamion`) × pièces par palette, au prix `prixCamion`.

Champs ajoutés dans `produits.json` : `eligibleCamion` (désigné par Jonas ; activé pour la démo sur 12385, MG076, 18885, JO095, JO094, JO098), `prixCamion` (grille tarifaire à fournir ; vide = « prix à confirmer »), `palettesParCamion` (facultatif).

## À compléter / brancher

- `produits.json` : les champs `null` (prix, EAN, pièces par palette…). À régénérer chaque soir à 20 h depuis l'ERP.
- `js/app.js` → `CONFIG.numeroWhatsApp` (lien `wa.me`), `CONFIG.historique` (Réassort Express) et `CONFIG.reliquats` : données de démonstration à remplacer par l'ERP.
- `CONFIG.panierInitial` : panier de démonstration (2 colis MG076 = 16,80 € HT, comme la maquette). Mettre `[]` en production.
- Bouton « Valider la commande » : envoi vers l'ERP ou le commercial (voir `checkout-btn` dans `app.js`).
- Assistant IA : la fonction `repondre()` répond à partir du catalogue local. La remplacer par un appel à un vrai assistant.
- Pied de page : adresses `[EMAIL]`, pages Mentions légales et CGV.
- Bandeau photo de rayon : seul Ménage en a un (`images/rayons/menage-*.jpg`). Pour un autre rayon, ajouter `<id>-ordinateur.jpg` / `<id>-telephone.jpg` et l'activer dans `pageRayon()`.
- Import Excel : les fichiers `.xlsx` sont lus avec SheetJS, chargé à la demande depuis cdnjs. Les `.csv` et le copier-coller marchent hors ligne.
