"""
gen_icons.py — Genera los PNG del ícono EMASEO EP IA con Pillow (sin rasterizador SVG).

Dibuja el emblema (hoja eco inclinada con nervaduras + chip "IA") con
supersampling 4x para bordes suaves y exporta los assets que referencia app.json.

Uso:  python assets/brand/gen_icons.py
Salida: assets/images/{icon,splash-icon,android-icon-foreground,
        android-icon-background,android-icon-monochrome,favicon}.png
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.normpath(os.path.join(HERE, "..", "images"))
FONT = r"C:\Windows\Fonts\arialbd.ttf"

# Paleta institucional sobria
NAVY      = (0, 63, 122)     # #003F7A
NAVY_TOP  = (0, 91, 172)     # #005BAC
GREEN     = (0, 168, 89)     # #00A859
WHITE     = (255, 255, 255)

SS = 4                 # supersampling
ANGLE = -32            # inclinación de la hoja (grados)
CENTER = (500, 470)    # centro de rotación de la hoja (coords base 1024)


def _rot(p):
    a = math.radians(ANGLE)
    s, co = math.sin(a), math.cos(a)
    x, y = p[0] - CENTER[0], p[1] - CENTER[1]
    return (CENTER[0] + x * co - y * s, CENTER[1] + x * s + y * co)


def _bezier(p0, c1, c2, p3, n=90):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((
            u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p3[1],
        ))
    return out


def _leaf_outline():
    # Hoja esbelta y puntiaguda (vesica) en coords base, vertical antes de rotar.
    left  = _bezier((500, 250), (404, 320), (388, 600), (500, 690))
    right = _bezier((500, 690), (612, 600), (596, 320), (500, 250))
    return [_rot(p) for p in (left + right)]


def _veins():
    """Devuelve (midrib, side_veins) como listas de segmentos en coords base rotadas."""
    mid = [_rot((500, 286)), _rot((500, 654))]
    sides = []
    for t, ln in [(0.30, 92), (0.52, 104), (0.74, 92)]:
        py = 300 + t * 330
        base = (500, py)
        # ramas hacia arriba-afuera (apex), simétricas
        for sgn in (-1, 1):
            end = (500 + sgn * ln * 0.86, py - ln * 0.62)
            sides.append([_rot(base), _rot(end)])
    return mid, sides


def _petiole():
    return [_rot((500, 690)), _rot((500, 742))]


def _sc(pts, k):
    return [(x * k, y * k) for (x, y) in pts]


def draw_mark(img, k, include_ia=True, details=True, leaf_fill=WHITE):
    d = ImageDraw.Draw(img, "RGBA")
    # Pecíolo (tallo corto) detrás de la hoja
    if details:
        d.line(_sc(_petiole(), k), fill=GREEN + (255,), width=max(1, int(24 * k)), joint="curve")
    # Hoja
    d.polygon(_sc(_leaf_outline(), k), fill=leaf_fill)
    # Nervaduras (sobre overlay para translucidez sobre la hoja)
    if details:
        mid, sides = _veins()
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.line(_sc(mid, k), fill=NAVY + (70,), width=max(1, int(13 * k)), joint="curve")
        for seg in sides:
            od.line(_sc(seg, k), fill=NAVY + (55,), width=max(1, int(7 * k)), joint="curve")
        img.alpha_composite(ov)
    # Chip "IA" (sin rotar)
    if include_ia:
        cx, cy, r = 770 * k, 772 * k, 150 * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE, outline=GREEN, width=max(1, int(14 * k)))
        fs = int(150 * k)
        font = ImageFont.truetype(FONT, fs)
        while font.getbbox("IA")[2] - font.getbbox("IA")[0] > 1.5 * r and fs > 8:
            fs -= 4; font = ImageFont.truetype(FONT, fs)
        bb = d.textbbox((0, 0), "IA", font=font)
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), "IA", font=font, fill=NAVY)


def gradient_rounded_bg(W):
    strip = Image.new("RGB", (1, W))
    for y in range(W):
        t = y / (W - 1)
        strip.putpixel((0, y), tuple(int(NAVY_TOP[i] + (NAVY[i] - NAVY_TOP[i]) * t) for i in range(3)))
    grad = strip.resize((W, W))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.219), fill=255)
    out = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def render_mark_only(W, include_ia=True, details=True, leaf_fill=WHITE):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw_mark(img, W / 1024.0, include_ia=include_ia, details=details, leaf_fill=leaf_fill)
    return img


def centered(mark, target_W, coverage):
    crop = mark.crop(mark.getbbox())
    scale = (target_W * coverage) / max(crop.width, crop.height)
    crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_W, target_W), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((target_W - crop.width) // 2, (target_W - crop.height) // 2))
    return canvas


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print("  ->", name, f"{size}x{size}")


def main():
    print("Generando íconos en", OUT)
    W = 1024 * SS

    icon = gradient_rounded_bg(W)
    draw_mark(icon, W / 1024.0)
    save(icon, "icon.png", 1024)
    save(icon, "favicon.png", 48)

    Ws = 512 * SS
    splash = Image.new("RGBA", (Ws, Ws), (0, 0, 0, 0))
    mask = Image.new("L", (Ws, Ws), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, Ws - 1, Ws - 1], radius=int(Ws * 0.5), fill=255)
    splash.paste(Image.new("RGBA", (Ws, Ws), GREEN + (255,)), (0, 0), mask)
    draw_mark(splash, Ws / 1024.0)
    save(splash, "splash-icon.png", 512)

    save(centered(render_mark_only(W), W, 0.62), "android-icon-foreground.png", 1024)
    save(Image.new("RGBA", (W, W), NAVY + (255,)), "android-icon-background.png", 1024)
    save(centered(render_mark_only(W, include_ia=False, details=False), W, 0.60),
         "android-icon-monochrome.png", 1024)

    print("Listo.")


if __name__ == "__main__":
    main()
