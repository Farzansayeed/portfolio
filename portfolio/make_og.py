"""Generate portfolio/og.png (1200x630) matching the site's design language."""
from PIL import Image, ImageDraw, ImageFont

SS = 2  # supersample factor
W, H = 1200 * SS, 630 * SS

BG = (11, 10, 8)
TEXT = (244, 242, 238)
GREY = (140, 136, 127)
DOT = (50, 47, 42)
ACCENT = (211, 169, 92)
ACCENT_DIM = (211, 169, 92, 90)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")

# ---- wave-field dots (lower ~55% of canvas) ----
COLS, ROWS = 46, 16
GAP = 30 * SS
x0 = (W - (COLS - 1) * GAP) / 2
y0 = H * 0.46
import math
for r in range(ROWS):
    for c in range(COLS):
        x = x0 + c * GAP
        y = y0 + r * GAP * 0.82
        # wave displacement
        wave = math.sin(c * 0.35 + r * 0.5) * 6 * SS + math.sin(c * 0.11 + r * 0.22) * 9 * SS
        y += wave
        # fade toward top and edges
        fade = min(1.0, (r + 2) / ROWS + 0.15)
        edge = 1.0 - abs(c - COLS / 2) / (COLS / 2) * 0.55
        alpha = max(18, int(150 * fade * edge))
        # accent band sweep
        band = math.exp(-((r / ROWS - 0.55) ** 2) * 22)
        col = ACCENT if band > 0.45 else DOT
        radius = 2.6 * SS * (1 + band * 1.3)
        d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=col + (alpha,))

# ---- vignette: subtle top-down darkening so text pops ----
grad = Image.new("L", (1, H), 0)
for y in range(H):
    grad.putpixel((0, y), int(max(0.0, 1.0 - y / (H * 0.55)) * 120))
grad = grad.resize((W, H))
black = Image.new("RGB", (W, H), BG)
img = Image.composite(black, img, grad)
d = ImageDraw.Draw(img, "RGBA")

# ---- text ----
def font(size, bold=False):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default(size)

M = 80 * SS  # margin
eyebrow = "SOFTWARE ENGINEERING STUDENT  ·  B.E. IT  ·  CLASS OF 2029"
f_eyebrow = font(20 * SS)
d.text((M, 96 * SS), eyebrow, font=f_eyebrow, fill=ACCENT)

f_name = font(96 * SS, bold=True)
d.text((M, 150 * SS), "Farzan Sayeed Hashmi", font=f_name, fill=TEXT)

f_head = font(44 * SS)
d.text((M, 286 * SS), "CS student. I build things that ship.", font=f_head, fill=TEXT)

f_sub = font(28 * SS)
d.text((M, 372 * SS), "AI-assisted government tech · live web platforms · developer tools", font=f_sub, fill=GREY)

# ---- footer hairline + label ----
d.line([(M, H - 96 * SS), (W - M, H - 96 * SS)], fill=(255, 255, 255, 26), width=SS)
f_foot = font(20 * SS)
d.text((M, H - 74 * SS), "farzansayeedhashmi@gmail.com", font=f_foot, fill=(110, 110, 120))
foot_w = d.textlength("github.com/Farzansayeed", font=f_foot)
d.text((W - M - foot_w, H - 74 * SS), "github.com/Farzansayeed", font=f_foot, fill=(110, 110, 120))

# ---- export ----
img = img.resize((1200, 630), Image.LANCZOS)
img.save("og.png", optimize=True)
print("og.png written:", img.size)
