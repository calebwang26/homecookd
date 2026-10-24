"""Tile rendered boards side by side into one contact sheet, labelled, for reviewing a whole concept.

    /Users/calebwang/Documents/GitHub/homecookd/.venv/bin/python sheet.py out.jpg a.png b.png ...
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

out, files = sys.argv[1], sys.argv[2:]
W, H, PAD, LABEL = 390, 844, 24, 34
cols = min(len(files), 5)
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (W + PAD) + PAD, rows * (H + PAD + LABEL) + PAD), "#D9D9D2")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)
    x = PAD + (i % cols) * (W + PAD)
    y = PAD + (i // cols) * (H + PAD + LABEL)
    draw.text((x, y), Path(f).stem, fill="#121410", font=font)
    sheet.paste(im, (x, y + LABEL))
sheet.save(out, quality=88)
print(out, sheet.size)
