"""
Génère une fiche produit PDF par référence (docs/<réf>-fiche-produit.pdf)
à partir de produits.json. À relancer après chaque mise à jour du catalogue :

    python3 tools/generer_fiches.py

La fiche reprend les informations logistiques (pas de prix : la fiche peut
circuler chez le client). Nécessite reportlab (pip install reportlab).
"""
import json
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOIR, ROUGE, GRIS = colors.HexColor('#111111'), colors.HexColor('#E2321F'), colors.HexColor('#5B6B7B')


def nb(n):
    """1152 -> « 1 152 », None -> « — »."""
    return '—' if n is None else f'{n:,}'.replace(',', ' ')


def cbm_colis(p):
    return p.get('cbmColis') or (p.get('fob') or {}).get('volumeCarton')


def lignes_infos(p, rayons):
    rayon = rayons.get(p.get('rayon'), '')
    pal = nb(p.get('piecesPalette')) + ' pces'
    if p.get('piecesPalette') and p.get('piecesColis'):
        pal += f" · {nb(round(p['piecesPalette'] / p['piecesColis']))} colis"
    if p.get('cartonsParCouche'):
        pal += f" ({p['cartonsParCouche']} colis/couche × {p['couches']} couches)"
    cbm = cbm_colis(p)
    dims = p.get('dimensionsColis')
    infos = [
        ('Référence', p['ref']),
        ('EAN (gencod)', p.get('ean') or '—'),
        ('Marque', p.get('marque', '')),
        ('Rayon', rayon + (f" › {p['sousCategorie']}" if p.get('sousCategorie') else '')),
        ('Colisage', f"{nb(p.get('piecesColis'))} pces par colis"),
        ('Palettisation', pal),
        ('CBM colis', f"{cbm:.3f} m³".replace('.', ',') if cbm else '—'),
    ]
    if dims:
        infos.append(('Dimensions colis', f"{dims['l']} × {dims['w']} × {dims['h']} cm"))
    if p.get('fob'):
        infos.append(('Port de départ (FOB)', p['fob']['port'].capitalize()))
    return infos


def fiche(p, rayons, chemin):
    c = canvas.Canvas(chemin, pagesize=A4)
    W, H = A4
    c.setTitle(f"Fiche produit {p['ref']} — {p['designation']}")
    # Bandeau
    c.setFillColor(NOIR); c.rect(0, H - 22 * mm, W, 22 * mm, stroke=0, fill=1)
    logo = os.path.join(RACINE, 'images/logo/logo-jonas-blanc.png')
    if os.path.exists(logo):
        c.drawImage(logo, 15 * mm, H - 17 * mm, width=45 * mm, height=12.75 * mm, mask='auto')
    c.setFillColor(colors.white); c.setFont('Helvetica-Bold', 9)
    c.drawRightString(W - 15 * mm, H - 13 * mm, 'FICHE PRODUIT')
    c.setFillColor(ROUGE); c.rect(0, H - 23.5 * mm, W, 1.5 * mm, stroke=0, fill=1)
    # Photo
    photo = os.path.join(RACINE, f"images/produits/{p['ref']}.jpg")
    y = H - 35 * mm
    if p.get('photo') is not False and os.path.exists(photo):
        c.drawImage(ImageReader(photo), 15 * mm, y - 80 * mm, width=80 * mm, height=80 * mm, preserveAspectRatio=True)
    # Titre
    x = 105 * mm
    c.setFillColor(GRIS); c.setFont('Helvetica-Bold', 9); c.drawString(x, y - 4 * mm, p.get('marque', '').upper())
    c.setFillColor(NOIR); c.setFont('Helvetica-Bold', 18)
    mots, ligne, yy = p['designation'].split(), '', y - 13 * mm
    for m in mots:
        essai = (ligne + ' ' + m).strip()
        if c.stringWidth(essai, 'Helvetica-Bold', 18) > W - x - 15 * mm:
            c.drawString(x, yy, ligne); yy -= 8 * mm; ligne = m
        else:
            ligne = essai
    c.drawString(x, yy, ligne)
    c.setFillColor(GRIS); c.setFont('Helvetica', 10)
    c.drawString(x, yy - 8 * mm, f"Réf. {p['ref']}  ·  EAN {p.get('ean') or '—'}")
    # Tableau
    yt = y - 92 * mm
    c.setFillColor(NOIR); c.setFont('Helvetica-Bold', 13); c.drawString(15 * mm, yt, 'Caractéristiques')
    yt -= 6 * mm
    for label, val in lignes_infos(p, rayons):
        c.setStrokeColor(colors.HexColor('#E4E4E4')); c.line(15 * mm, yt, W - 15 * mm, yt)
        yt -= 7 * mm
        c.setFillColor(GRIS); c.setFont('Helvetica', 10); c.drawString(15 * mm, yt + 2 * mm, label)
        c.setFillColor(NOIR); c.setFont('Helvetica-Bold', 10); c.drawString(75 * mm, yt + 2 * mm, str(val))
    c.line(15 * mm, yt, W - 15 * mm, yt)
    # Pied
    c.setFillColor(GRIS); c.setFont('Helvetica', 8)
    c.drawString(15 * mm, 12 * mm, "Jonas France — 189 rue d'Aubervilliers, 75018 Paris · Leader du discount depuis 1980")
    c.drawRightString(W - 15 * mm, 12 * mm, f'Édition du {date.today():%d/%m/%Y}')
    c.showPage(); c.save()


def main():
    with open(os.path.join(RACINE, 'produits.json'), encoding='utf-8') as f:
        data = json.load(f)
    rayons = {r['id']: r['nom'] for r in data['rayons']}
    os.makedirs(os.path.join(RACINE, 'docs'), exist_ok=True)
    n = 0
    for p in data['produits']:
        if p.get('exemple'):
            continue  # pas de fiche pour les produits fictifs
        fiche(p, rayons, os.path.join(RACINE, 'docs', f"{p['ref']}-fiche-produit.pdf"))
        n += 1
    print(f'{n} fiches générées dans docs/')


if __name__ == '__main__':
    main()
