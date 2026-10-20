"""Génère les icônes de la PWA (montagne + sentier sur fond bleu nuit)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def draw(size, safe=1.0):
    """safe < 1 réduit le motif (zone de sécurité des icônes maskable)."""
    S = size * 4
    img = Image.new("RGB", (S, S), "#1d4f7a")
    d = ImageDraw.Draw(img)
    k = S * safe
    o = (S - k) / 2
    P = lambda x, y: (o + x * k, o + y * k)
    d.polygon([P(.08, .74), P(.38, .26), P(.52, .48), P(.62, .34), P(.92, .74)], fill="#e6eef7")
    d.polygon([P(.38, .26), P(.45, .37), P(.40, .36), P(.35, .37)], fill="#ffffff")
    d.line([P(.20, .90), P(.42, .76), P(.58, .82), P(.80, .66)], fill="#eb6834", width=int(k * .045), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(512, safe=.72).save(OUT / "icon-maskable-512.png")
print("icônes générées dans", OUT)
