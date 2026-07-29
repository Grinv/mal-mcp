#!/usr/bin/env python3
"""Regenerate assets/icon.png from the design in icon-source.svg.

Not part of the npm build — this is a one-off design asset, run manually
whenever the icon needs to change. Requires Pillow (`pip install pillow`).

Renders directly with Pillow instead of an SVG->PNG pipeline: both a
chrome-devtools screenshot and macOS Quick Look's SVG thumbnailer silently
composite the transparent background against opaque white, which Anthropic's
MCPB icon spec explicitly requires ("PNG with transparency" - see
claude.com/docs/connectors/building/mcpb). Drawing directly gives real
per-pixel alpha with no compositing step to lose it.

Keep the geometry/color here in sync with icon-source.svg by hand if you
ever edit one — there's no automated link between the two.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "icon.png"

SIZE = 512
SCALE = 4  # supersample then downsample for anti-aliased edges (Pillow's
           # ImageDraw has no native AA)

# Generic "kawaii creature" head: round face + two round ears (with an
# inner-ear tint for depth) + a soft belly highlight + simple dot eyes.
# Deliberately generic (no belly *markings*/pattern, no whiskers, no
# character-specific ear shape) — evokes anime-mascot cuteness in general,
# not any one copyrighted character. Geometry matches icon-source.svg 1:1.
HEAD_CENTER = (256, 300)
HEAD_R = 148
EAR_CENTERS = [(158, 178), (354, 178)]
EAR_R = 70
INNER_EAR_CENTERS = [(168, 188), (344, 188)]
INNER_EAR_R = 38
BELLY_CENTER = (256, 372)
BELLY_RX, BELLY_RY = 84, 62
EYE_CENTERS = [(206, 288), (306, 288)]
EYE_R = 20

# MAL's own brand blue, pulled directly from MyAnimeList's official favicon.svg
# (cdn.myanimelist.net/images/favicon.svg, fill class .st1) and cross-checked
# against a pixel sample of apple-touch-icon-256.png (46,81,162 — same color,
# PNG-palette rounding) — verified live 2026-07-29, not guessed from memory.
MAL_BLUE = (0x2F, 0x52, 0xA2)
# A lighter tint of the same hue (not a different color) for the inner-ear
# and belly highlight — adds dimension without introducing an unrelated color.
MAL_BLUE_LIGHT = (0x6A, 0x87, 0xC7)
WHITE = (0xFF, 0xFF, 0xFF)


def main():
    w = h = SIZE * SCALE
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    for cx, cy in EAR_CENTERS:
        cx, cy = cx * SCALE, cy * SCALE
        r = EAR_R * SCALE
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*MAL_BLUE, 255))

    hx, hy = HEAD_CENTER[0] * SCALE, HEAD_CENTER[1] * SCALE
    hr = HEAD_R * SCALE
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(*MAL_BLUE, 255))

    for cx, cy in INNER_EAR_CENTERS:
        cx, cy = cx * SCALE, cy * SCALE
        r = INNER_EAR_R * SCALE
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*MAL_BLUE_LIGHT, 255))

    bx, by = BELLY_CENTER[0] * SCALE, BELLY_CENTER[1] * SCALE
    brx, bry = BELLY_RX * SCALE, BELLY_RY * SCALE
    d.ellipse([bx - brx, by - bry, bx + brx, by + bry], fill=(*MAL_BLUE_LIGHT, 255))

    er = EYE_R * SCALE
    for ex, ey in EYE_CENTERS:
        ex, ey = ex * SCALE, ey * SCALE
        d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(*WHITE, 255))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    out.save(OUT)
    print(f"wrote {OUT} ({out.size[0]}x{out.size[1]}, mode={out.mode})")


if __name__ == "__main__":
    main()
