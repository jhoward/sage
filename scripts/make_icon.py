"""Generate the app icon.

Drawn in code rather than checked in as a binary so it can be adjusted by editing numbers
rather than opening a design tool, and so the .icns can be regenerated for any future
bundle. Uses CoreGraphics through pyobjc, which is already a pywebview dependency — no new
packages.

    uv run python scripts/make_icon.py

Writes assets/icon.png (1024px) and assets/icon.icns.

The mark is a single sage leaf: legible at 16px, which rules out anything with fine detail
or more than one element. A three-leaf sprig was the first idea and turns to mush in the
Dock at small sizes.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import Quartz
from Foundation import NSURL

SIZE = 1024
ASSETS = Path(__file__).resolve().parent.parent / "assets"

# Deep sage green, and a warm off-white for the mark. Enough contrast to survive being
# shrunk to a menu-bar dot.
BACKGROUND = (0.28, 0.42, 0.35, 1.0)
BACKGROUND_LIGHT = (0.38, 0.54, 0.44, 1.0)
LEAF = (0.96, 0.96, 0.92, 1.0)
VEIN = (0.28, 0.42, 0.35, 0.55)


def rounded_rect(ctx, x, y, w, h, r):
    Quartz.CGContextMoveToPoint(ctx, x + r, y)
    Quartz.CGContextAddArcToPoint(ctx, x + w, y, x + w, y + h, r)
    Quartz.CGContextAddArcToPoint(ctx, x + w, y + h, x, y + h, r)
    Quartz.CGContextAddArcToPoint(ctx, x, y + h, x, y, r)
    Quartz.CGContextAddArcToPoint(ctx, x, y, x + w, y, r)
    Quartz.CGContextClosePath(ctx)


def draw(ctx, size: int) -> None:
    space = Quartz.CGColorSpaceCreateDeviceRGB()

    # Background: macOS "squircle"-ish rounded square with a soft vertical gradient.
    Quartz.CGContextSaveGState(ctx)
    rounded_rect(ctx, 0, 0, size, size, size * 0.225)
    Quartz.CGContextClip(ctx)
    gradient = Quartz.CGGradientCreateWithColorComponents(
        space, (*BACKGROUND_LIGHT, *BACKGROUND), (0.0, 1.0), 2
    )
    Quartz.CGContextDrawLinearGradient(
        ctx, gradient, Quartz.CGPointMake(0, size), Quartz.CGPointMake(0, 0), 0
    )
    Quartz.CGContextRestoreGState(ctx)

    # A single leaf: two mirrored quadratic curves meeting at tip and base. Drawn in
    # fractions of the canvas so it scales exactly at every icon size.
    cx = size * 0.5
    tip_y = size * 0.80
    base_y = size * 0.22
    belly = size * 0.235

    Quartz.CGContextSetRGBFillColor(ctx, *LEAF)
    Quartz.CGContextMoveToPoint(ctx, cx, base_y)
    Quartz.CGContextAddQuadCurveToPoint(
        ctx, cx + belly, size * 0.36, cx, tip_y
    )
    Quartz.CGContextAddQuadCurveToPoint(
        ctx, cx - belly, size * 0.36, cx, base_y
    )
    Quartz.CGContextClosePath(ctx)
    Quartz.CGContextFillPath(ctx)

    # Centre vein, stopping short of the tip so it reads as a leaf rather than a lens.
    Quartz.CGContextSetRGBStrokeColor(ctx, *VEIN)
    Quartz.CGContextSetLineWidth(ctx, size * 0.022)
    Quartz.CGContextSetLineCap(ctx, Quartz.kCGLineCapRound)
    Quartz.CGContextMoveToPoint(ctx, cx, base_y + size * 0.045)
    Quartz.CGContextAddLineToPoint(ctx, cx, tip_y - size * 0.10)
    Quartz.CGContextStrokePath(ctx)


def render(path: Path, size: int) -> None:
    space = Quartz.CGColorSpaceCreateDeviceRGB()
    ctx = Quartz.CGBitmapContextCreate(
        None, size, size, 8, 0, space, Quartz.kCGImageAlphaPremultipliedLast
    )
    draw(ctx, size)

    image = Quartz.CGBitmapContextCreateImage(ctx)
    dest = Quartz.CGImageDestinationCreateWithURL(
        NSURL.fileURLWithPath_(str(path)), "public.png", 1, None
    )
    Quartz.CGImageDestinationAddImage(dest, image, None)
    Quartz.CGImageDestinationFinalize(dest)


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    png = ASSETS / "icon.png"
    render(png, SIZE)

    # .icns for a future bundle. Every size is rendered rather than downscaled, so small
    # sizes stay crisp.
    iconset = ASSETS / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        render(iconset / f"icon_{size}x{size}.png", size)
        render(iconset / f"icon_{size}x{size}@2x.png", size * 2)

    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")],
        check=True,
    )
    for f in iconset.iterdir():
        f.unlink()
    iconset.rmdir()

    print(f"wrote {png} and {ASSETS / 'icon.icns'}")


if __name__ == "__main__":
    main()
