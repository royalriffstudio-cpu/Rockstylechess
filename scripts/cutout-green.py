#!/usr/bin/env python3
"""
Turns a generated emblem on a flat green background into a transparent PNG.

  python3 scripts/cutout-green.py <input_dir> <output_dir> [size=512]

Method: flood the "green" region from the image border (so green INSIDE the art, e.g. a
green gem, is never touched), antialias the edge, remove green spill from the edge
pixels, crop to the subject plus a small margin, and resize to a square `size`.
Re-run it whenever emblems are regenerated; the originals are not modified.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def is_green(rgb):
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    # Strongly green AND clearly more green than blue (so cyan art is not caught).
    return (g > 130) & (g - np.maximum(r, b) > 55) & (g - b > 55)

def cutout(path: Path, out: Path, size: int) -> tuple:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    mask = is_green(rgb)
    labels, _ = ndimage.label(mask)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, border[border != 0])
    # fill tiny holes inside the background region, then grow 1px to eat the JPEG fringe
    # Pad with background first: morphology treats the outside of the image as "not
    # background", which would otherwise eat a rim of the green at the image edges
    # (a round badge that touches the frame would keep a faint rectangular halo).
    pad = 6
    bg = np.pad(bg, pad, constant_values=True)
    bg = ndimage.binary_closing(bg, iterations=2)
    bg = ndimage.binary_dilation(bg, iterations=1)
    bg = bg[pad:-pad, pad:-pad]
    # Drop JPEG specks: keep only sizeable connected pieces of the subject.
    subject = ~bg
    sub_labels, n = ndimage.label(subject)
    if n:
        sizes = ndimage.sum(subject, sub_labels, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz > 0.005 * subject.size]
        subject = np.isin(sub_labels, keep)
        bg = ~subject
    alpha = subject.astype(np.float32)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))).astype(np.float32) / 255.0
    alpha = np.clip((alpha - 0.2) / 0.6, 0, 1)

    # despill: near the edge, cap green at the larger of red/blue
    near_edge = ndimage.binary_dilation(bg, iterations=4) & ~bg
    out_rgb = rgb.astype(np.int32).copy()
    cap = np.maximum(out_rgb[..., 0], out_rgb[..., 2]) + 6
    spill = near_edge & (out_rgb[..., 1] > cap)
    out_rgb[..., 1] = np.where(spill, cap, out_rgb[..., 1])

    rgba = np.dstack([out_rgb.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    img = Image.fromarray(rgba, "RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if box:
        w, h = box[2] - box[0], box[3] - box[1]
        side = int(max(w, h) * 1.06)
        cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        img = img.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out, optimize=True)
    return (bg.mean(), box)

def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(list(src.glob("*.jpeg")) + list(src.glob("*.jpg")) + list(src.glob("*.png"))):
        frac, box = cutout(f, dst / (f.stem + ".png"), size)
        print(f"{f.name:30s} background {frac*100:4.1f}%  subject box {box}")

if __name__ == "__main__":
    main()
