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

## Affichage selon le stock

| Produit | Standard / Trade Pal / Trade Truck | FOB |
|---|---|---|
| En stock | Affiché, commandable | Affiché s'il a une offre `fob` |
| Hors stock, **permanent** (`permanent: true`) | Toujours affiché, badge « RUPTURE », ajout bloqué | Affiché s'il a une offre `fob` |
| Hors stock, **non permanent** | Masqué | Affiché (offre `fob`) |
| **Uniquement FOB** (`fobSeulement: true`) | Masqué | Affiché |

`enStock` vient du stock dispo de l'ERP (> 0). `permanent` et `fobSeulement` sont à renseigner par Jonas (démo : tous les produits du kit sont permanents ; 2750 est en rupture, comme dans l'ERP).

**Accès FOB sur autorisation** : `client.autorisationFob`. Sans autorisation, le bouton FOB affiche « Sur autorisation » et renvoie vers le commercial.

## Modes d'achat

Sélecteur en haut de toutes les pages (dans l'en-tête, et dans la barre compacte au défilement sur ordinateur) :

- **Standard** : au colis ou à la palette, cartes avec les deux blocs.
- **Trade Pal** : achat à la palette uniquement. Seul le bloc palette est affiché, et les produits en rupture palette sont masqués. Le panier montre le remplissage du camion (palettes / 33).
- **Trade Truck** (camion complet, MOQ 1 camion) : seuls les produits `eligibleCamion: true` sont affichés. 1 camion = `palettesParCamion` palettes (33 par défaut, `CONFIG.palettesParCamion`) × pièces par palette, au prix `prixCamion`.

Champs ajoutés dans `produits.json` : `eligibleCamion` (désigné par Jonas ; activé pour la démo sur 12385, MG076, 18885, JO095, JO094, JO098), `prixCamion` (grille tarifaire à fournir ; vide = « prix à confirmer »), `palettesParCamion` (facultatif).

## Panier

Le panier montre la composition de tout ce qui est commandé :

- **Au colis** ;
- **À la palette**, avec le camion en cours de remplissage (palettes / 33, case par case) ;
- **Trade Truck**, détail de chaque camion complet (33 palettes × pièces par palette) ;
- **Conteneurs FOB**, un par port : taille, jauge en m³, MOQ, composition (cartons, m³, $), bouton « Réserver ce conteneur ».

Le total en € HT couvre la commande en stock ; les conteneurs FOB sont totalisés à part, en dollars, et réservés séparément.

## Offre FOB

Mode **FOB** dans l'en-tête. Le catalogue garde la même structure (rayons, sous-catégories, sélections, recherche, tri) ; en mode FOB :

- seuls les produits qui ont un bloc `fob` sont affichés, y compris **tous les produits hors stock** (`enStock: false`). Ces derniers n'apparaissent dans aucun autre mode ;
- chaque carte indique son **port de départ**, et des pastilles permettent de **filtrer par port** ;
- prix FOB en dollars US par pièce (`fob.prixFob`), carton = `piecesColis` pièces et `fob.volumeCarton` m³.

**MOQ : 1 conteneur complet par port.** Ajouter un produit crée ou remplit automatiquement le conteneur de son port. Le client choisit 20', 40' ou 40' HC (volumes utiles 28 / 58 / 68 m³ dans `fob.conteneurs`). Le + ajoute `fob.pasCartons` cartons (50) sans dépasser le volume ; « Compléter le conteneur » remplit l'espace restant. « Réserver ce conteneur » s'active à partir de `fob.remplissageMin` (90 %) ; la demande n'est envoyée nulle part pour l'instant (à brancher).

Les 7 produits `FOB-EX-…` sont des **exemples fictifs** (`exemple: true`, sans photo) à remplacer par les vrais produits hors stock.

## À compléter / brancher

- `produits.json` : les champs `null` (prix, EAN, pièces par palette…). À régénérer chaque soir à 20 h depuis l'ERP.
- `js/app.js` → `CONFIG.numeroWhatsApp` (lien `wa.me`), `CONFIG.historique` (Réassort Express) et `CONFIG.reliquats` : données de démonstration à remplacer par l'ERP.
- `CONFIG.panierInitial` : panier de démonstration (2 colis MG076 = 16,80 € HT, comme la maquette). Mettre `[]` en production.
- Bouton « Valider la commande » : envoi vers l'ERP ou le commercial (voir `checkout-btn` dans `app.js`).
- Assistant IA : la fonction `repondre()` répond à partir du catalogue local. La remplacer par un appel à un vrai assistant.
- Pied de page : adresses `[EMAIL]`, pages Mentions légales et CGV.
- Bandeau photo de rayon : seul Ménage en a un (`images/rayons/menage-*.jpg`). Pour un autre rayon, ajouter `<id>-ordinateur.jpg` / `<id>-telephone.jpg` et l'activer dans `pageRayon()`.
- Import Excel : les fichiers `.xlsx` sont lus avec SheetJS, chargé à la demande depuis cdnjs. Les `.csv` et le copier-coller marchent hors ligne.
