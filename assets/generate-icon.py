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

# Bookmark/tag silhouette: a "saved to your list" glyph — an original shape
# (not MyAnimeList's own logo mark), colored in MAL's real brand blue.
# Geometry matches icon-source.svg's <path> 1:1.
LEFT, TOP, RIGHT, BOTTOM = 144, 96, 368, 416
RADIUS = 34  # top corners only; bottom corners stay sharp (the bookmark's two legs)
NOTCH_APEX = (256, 340)  # the V cut into the bottom edge

# MAL's own brand blue, pulled directly from MyAnimeList's official favicon.svg
# (cdn.myanimelist.net/images/favicon.svg, fill class .st1) and cross-checked
# against a pixel sample of apple-touch-icon-256.png (46,81,162 — same color,
# PNG-palette rounding) — verified live 2026-07-29, not guessed from memory.
MAL_BLUE = (0x2F, 0x52, 0xA2)


def main():
    w = h = SIZE * SCALE
    left, top, right, bottom = (v * SCALE for v in (LEFT, TOP, RIGHT, BOTTOM))
    radius = RADIUS * SCALE
    apex = (NOTCH_APEX[0] * SCALE, NOTCH_APEX[1] * SCALE)

    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    # Rounded top corners, sharp bottom corners.
    d.rounded_rectangle(
        [left, top, right, bottom], radius=radius, fill=255, corners=(True, True, False, False)
    )
    # Punch the V-notch out of the bottom edge, from corner to corner, leaving
    # the two pointed "legs" — the classic bookmark silhouette.
    d.polygon([(left, bottom), apex, (right, bottom)], fill=0)

    big = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    solid = Image.new("RGB", (w, h), MAL_BLUE)
    big.paste(solid, (0, 0), mask)

    out = big.resize((SIZE, SIZE), Image.LANCZOS)
    out.save(OUT)
    print(f"wrote {OUT} ({out.size[0]}x{out.size[1]}, mode={out.mode})")


if __name__ == "__main__":
    main()
