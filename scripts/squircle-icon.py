#!/usr/bin/env python3
"""Mask a 1024 source PNG to the macOS continuous-corner squircle (transparent
corners), inset into the standard macOS safe area, then write
electron/assets/icon.png + icon-512/256. Keeps the app icon shaped like a
real macOS icon instead of a hard square.

Safe-area fix (2026-07): earlier output masked the squircle edge-to-edge
against the full 1024 canvas (verified: fully opaque at row 0). macOS's Big
Sur+ icon grid expects the visible squircle content inset from the canvas
edge (content ~824/1024 px, ~80.5%, centered, i.e. ~10% margin per side) so
the OS-composited shadow/gloss and Dock/Finder scaling do not clip or crowd
it against sibling icons. SAFE below encodes that margin.

Usage: python3 scripts/squircle-icon.py <source-1024.png>
Requires Pillow + numpy.
"""

import sys
import os
import numpy as np
from PIL import Image

ICON = 1024
SAFE = 824  # macOS icon-grid safe-area content size within the 1024 canvas
ASSETS = os.path.join(os.path.dirname(__file__), "..", "electron", "assets")


def squircle_mask(size, n=5.0, ss=4):
    s = size * ss
    ax = np.linspace(-1.0, 1.0, s, dtype=np.float32)
    x, y = np.meshgrid(ax, ax)
    inside = (np.abs(x) ** n + np.abs(y) ** n) <= 1.0
    m = Image.fromarray((inside * 255).astype("uint8"))
    return m.convert("L").resize((size, size), Image.LANCZOS)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: squircle-icon.py <source-1024.png>")
    art = Image.open(sys.argv[1]).convert("RGBA").resize((SAFE, SAFE), Image.LANCZOS)
    art.putalpha(squircle_mask(SAFE))
    margin = (ICON - SAFE) // 2
    canvas = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
    canvas.paste(art, (margin, margin), art)
    base = os.path.join(ASSETS, "icon.png")
    canvas.save(base)
    for size in (512, 256):
        canvas.resize((size, size), Image.LANCZOS).save(
            os.path.join(ASSETS, f"icon-{size}.png")
        )
    print("wrote", base, "(+512/256), masked to macOS squircle, safe-area inset")


if __name__ == "__main__":
    main()
