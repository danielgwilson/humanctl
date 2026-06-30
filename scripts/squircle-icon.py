#!/usr/bin/env python3
"""Mask a 1024 source PNG to the macOS continuous-corner squircle (transparent
corners), then write electron/assets/icon.png + icon-512/256. Keeps the app
icon shaped like a real macOS icon instead of a hard square.

Usage: python3 scripts/squircle-icon.py <source-1024.png>
Requires Pillow + numpy.
"""

import sys
import os
import numpy as np
from PIL import Image

ICON = 1024
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
    art = Image.open(sys.argv[1]).convert("RGBA").resize((ICON, ICON), Image.LANCZOS)
    art.putalpha(squircle_mask(ICON))
    base = os.path.join(ASSETS, "icon.png")
    art.save(base)
    for size in (512, 256):
        art.resize((size, size), Image.LANCZOS).save(
            os.path.join(ASSETS, f"icon-{size}.png")
        )
    print("wrote", base, "(+512/256), masked to macOS squircle")


if __name__ == "__main__":
    main()
