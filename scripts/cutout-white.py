#!/usr/bin/env python3
"""
Turns a generated round portrait on a flat WHITE background into a transparent PNG
(the boss portraits). Same idea as cutout-green.py: flood the near-white region from
the image border only, so white INSIDE the art (teeth, highlights) is untouched.

  PYTHONNOUSERSITE=1 python3 scripts/cutout-white.py <input_dir> <output_dir> [size=512]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def cutout(path: Path, dest: Path, size: int):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(int)
    near_white = (rgb.min(axis=2) > 232)
    labels, _ = ndimage.label(near_white)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, border[border != 0])
    pad = 6
    bg = np.pad(bg, pad, constant_values=True)
    bg = ndimage.binary_closing(bg, iterations=2)
    bg = ndimage.binary_dilation(bg, iterations=1)
    bg = bg[pad:-pad, pad:-pad]
    subject = ~bg
    sub_labels, n = ndimage.label(subject)
    if n:
        sizes = ndimage.sum(subject, sub_labels, range(1, n + 1))
        subject = np.isin(sub_labels, [i + 1 for i, sz in enumerate(sizes) if sz > 0.005 * subject.size])
    alpha = subject.astype(np.float32)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))).astype(np.float32) / 255.0
    alpha = np.clip((alpha - 0.2) / 0.6, 0, 1)
    # Edge pixels pick up a light fringe from the white: pull them toward the dark ring colour.
    edge = ndimage.binary_dilation(~subject, iterations=3) & subject
    pixels = rgb.copy()
    pixels[edge] = (pixels[edge] * 0.8).astype(int)
    img = Image.fromarray(np.dstack([pixels.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)]), "RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if box:
        side = int(max(box[2] - box[0], box[3] - box[1]) * 1.04)
        cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        img = img.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    img.resize((size, size), Image.LANCZOS).save(dest, optimize=True)
    return box

if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(list(src.glob("boss-*.jpeg")) + list(src.glob("boss-*.jpg")) + list(src.glob("boss-*.png"))):
        print(f.name, cutout(f, dst / (f.stem + ".png"), size))
