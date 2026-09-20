"""Generate v2 placeholder assets (run from inside portfolio/):
- shots/bhukosh.png, shots/wikiexplore.png — elegant screenshot placeholders
  in the site's design language, clearly labeled as placeholders.
- resume.pdf — a one-page PDF placeholder so the résumé CTA works before the
  real résumé is added (explicitly marked "PLACEHOLDER").
All are safe to delete once real assets exist.
"""
from PIL import Image, ImageDraw, ImageFont

import os
os.makedirs("shots", exist_ok=True)

BG = (11, 10, 8)
LIFT = (18, 16, 13)
TEXT = (244, 242, 238)
GREY = (140, 136, 127)
HAIR = (255, 255, 255, 26)
ACCENT = (211, 169, 92)
ACCENT_DIM = (211, 169, 92, 40)


def font(size, bold=False):
    names = ["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def label(d, x, y, text, size=13):
    d.text((x, y), text.upper(), font=font(size), fill=ACCENT)


def draw_shot(name, title, subtitle, rows):
    W, H = 1280, 960  # 4:3
    SS = 1
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")

    # browser chrome bar
    d.rounded_rectangle([0, 0, W, 56], radius=0, fill=LIFT)
    for i, c in enumerate((226, 88, 34) if False else (90, 90, 90) for _ in range(3)):
        d.ellipse([24 + i * 22, 22, 36 + i * 22, 34], fill=(80, 78, 74))
    d.rounded_rectangle([220, 14, W - 220, 42], radius=8, outline=HAIR, width=1)
    d.text((240, 21), "placeholder", font=font(13), fill=GREY)

    # label corner tag
    d.rounded_rectangle([W - 260, H - 64, W - 24, H - 24], radius=10, fill=(0, 0, 0, 140))
    d.text((W - 244, H - 55), "SCREENSHOT PLACEHOLDER", font=font(13), fill=ACCENT)
    d.text((W - 244, H - 36), "replace with a real capture", font=font(12), fill=GREY)

    # headline block
    label(d, 48, 96, "Screenshot placeholder")
    d.text((48, 124), title, font=font(40, bold=True), fill=TEXT)
    d.text((48, 178), subtitle, font=font(20), fill=GREY)

    # abstract UI rows
    y = 250
    for w, strong in rows:
        d.rounded_rectangle(
            [48, y, 48 + w, y + 44], radius=8,
            fill=(255, 255, 255, 14) if strong else (255, 255, 255, 7),
            outline=ACCENT_DIM if strong else HAIR,
            width=2 if strong else 1,
        )
        d.line([(68, y + 22), (68 + min(160, w - 60), y + 22)], fill=(120, 116, 108), width=3)
        y += 60
    return img


# ---- BhuKosh: evidence view ----
bhukosh = draw_shot(
    "bhukosh",
    "BhuKosh — evidence view",
    "Register rows · one field bound to its source pixels",
    [(560, True), (430, False), (610, False), (380, False), (520, True), (460, False)],
)
# evidence bracket detail
d = ImageDraw.Draw(bhukosh, "RGBA")
d.line([(620, 262), (660, 262), (660, 396), (700, 396)], fill=ACCENT, width=2)
d.ellipse([706, 390, 718, 402], fill=ACCENT)
d.text((726, 390), "evidence", font=font(13), fill=ACCENT)
bhukosh.save("shots/bhukosh.png", optimize=True)

# ---- WikiExplore: reading view ----
wiki = draw_shot(
    "wikiexplore",
    "WikiExplore — today's featured",
    "Featured article · most-read · on-this-day (live Wikimedia feed)",
    [(640, True), (500, False), (560, False), (420, False), (600, False), (380, False)],
)
d = ImageDraw.Draw(wiki, "RGBA")
d.line([(640, 262), (680, 262), (680, 396), (720, 396)], fill=ACCENT, width=2)
d.ellipse([726, 390, 738, 402], fill=ACCENT)
d.text((746, 390), "live data", font=font(13), fill=ACCENT)
wiki.save("shots/wikiexplore.png", optimize=True)

# ---- résumé PDF placeholder (minimal valid one-page PDF) ----
LINES = [
    "FARZAN SAYEED HASHMI",
    "Second-year B.E. Information Technology - Matrusri Engineering College (2029)",
    "",
    "THIS IS A PLACEHOLDER RESUME.",
    "",
    "Replace portfolio/resume.pdf with your real one-page resume before sending",
    "this site to recruiters.",
    "",
    "PROJECTS",
    "BhuKosh - evidence-bound land-record digitization (Smart India Hackathon 2026)",
    "WikiExplore - live Wikipedia reading portal (66M articles, Wikimedia APIs)",
    "",
    "CONTACT",
    "farzansayeedhashmi@gmail.com | github.com/Farzansayeed",
]


def esc(s):
    return s.replace("\\", r"\\\\").replace("(", r"\(").replace(")", r"\)")


content_parts = ["BT /F1 16 Tf 72 720 Td"]
for i, line in enumerate(LINES):
    if i == 0:
        content_parts.append(f"({esc(line)}) Tj")
    elif line == "":
        content_parts.append("0 -26 Td")
    else:
        content_parts.append(f"/F1 11 Tf 0 -22 Td ({esc(line)}) Tj")
content_parts.append("ET")
stream = "\n".join(content_parts).encode("latin-1", "replace")

objs = []
objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

out = b"%PDF-1.4\n"
offsets = []
for n, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
xref_pos = len(out)
out += f"xref\n0 {len(objs)+1}\n".encode() + b"0000000000 65535 f \n"
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += (
    f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
)

with open("resume.pdf", "wb") as f:
    f.write(out)
print("shots/bhukosh.png, shots/wikiexplore.png, resume.pdf written")
