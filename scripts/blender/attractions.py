"""
Blender models for every baked attraction sprite.

Source of truth for client/public/sprites/*.png. Those PNGs are build
artifacts -- change this file and re-render, never hand-edit them.

    blender --background --python scripts/blender/attractions.py
    node scripts/blender/pack-strip.mjs --all

Render a subset by setting ONLY, e.g. `ONLY = ["tree", "fountain"]` before
exec'ing this (that's how the MCP bridge drives it incrementally).

--------------------------------------------------------------------------
WHAT IS BAKED AND WHAT IS NOT
--------------------------------------------------------------------------
Baked here: the structure -- geometry, palette, day lighting, and any motion
that is a pure function of time (rotation, swinging, bobbing).

Deliberately NOT baked, and still drawn in canvas on top of the blit:

  * Night lights. main.ts already tints the whole scene after the grid pass,
    so baked sprites darken correctly on their own -- but lit windows, chasing
    bulbs and lamp glow are *emissive* and have to be added, not dimmed. Those
    live in the drawXNight() functions in render/sprites/.
  * Anything reading GameState. The trash can's overflow indicator depends on
    the litter map, so the can is baked and the overflow stays canvas.
  * Small stateless flourishes that 3D would make worse, not better --
    the flower bed's butterflies, for instance.

The rule: if it's structure, bake it; if it's a light or depends on state,
overlay it.

--------------------------------------------------------------------------
FRAMES AND VARIANTS
--------------------------------------------------------------------------
`frames` is one full animation loop, indexed off simClock so the sprite
freezes when the game pauses. `variants` are deterministic alternatives
picked by tileHash(cx, cy) -- three tree species, benches with and without a
resting guest -- matching what the vector art chose per tile.

Frame counts are a size budget, not a style choice: every frame is stored at
2x, so a 4x4 attraction costs 16x the pixels of a 1x1 one at the same count.
Static structures get frames=1 and cost almost nothing.
"""

import bpy
import bmesh
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    "/Users/chrismrobbins/badrctycoon/scripts/blender"
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import kit
from kit import uh, uv, box, cyl, cone, sphere, tube, obj, empty, mat, deck, pad_fence

OUT_ROOT = os.path.join(HERE, "out")
BLEND_ROOT = os.path.join(HERE, "blend")


# ==================================================================
# SCENERY
# ==================================================================

def build_tree(variant):
    """Three deterministic species, as drawTree()'s tileHash variants:
    0 broad deciduous, 1 conifer, 2 palm. The sway is baked as frames."""
    trunk = bmesh.new()
    cyl(trunk, uh(4.6), uv(2.2), (0, 0, uv(1.0)), segments=10)          # root flare
    cyl(trunk, uh(2.6), uv(17), (0, 0, uv(9.5)), segments=10, r2=uh(1.5))
    obj("Trunk", trunk, [mat("bark", "#78350f", 0.85)])

    crown = empty("Crown")

    bm = bmesh.new()
    if variant == 0:
        for ox, oy, oz, r in ((0, 0, 24, 12), (-8, 3, 18, 8.5), (8, -3, 18, 8.5),
                              (-4, -5, 29, 7), (5, 4, 28, 6.5)):
            sphere(bm, uh(r), (uh(ox), uh(oy), uv(oz)), scale=(1, 1, 0.85), segments=10)
        o = obj("Canopy", bm, [mat("leaf_mid", "#16a34a", 0.75)], parent=crown)
        hi = bmesh.new()
        sphere(hi, uh(5.5), (uh(-4), uh(-2), uv(29)), scale=(1, 1, 0.8), segments=10)
        sphere(hi, uh(3.6), (uh(-9), uh(2), uv(21)), scale=(1, 1, 0.8), segments=8)
        obj("CanopyHi", hi, [mat("leaf_hi", "#4ade80", 0.75)], parent=crown)
    elif variant == 1:
        cols = ["#14532d", "#166534", "#15803d", "#16a34a"]
        for i in range(4):
            w = 13 - i * 2.6
            z = 8 + i * 8
            tier = bmesh.new()
            cone(tier, uh(w), uv(13), (0, 0, uv(z + 6)), segments=12)
            obj("Tier%d" % i, tier, [mat("conif%d" % i, cols[i], 0.8)], parent=crown)
        bm.free()
    else:
        # Fronds are BLADES, not sticks. Built as a chain of flattened spheres
        # that widen then taper: thin tubes rendered as a spider, not a palm.
        for i in range(7):
            a = i * 2 * math.pi / 7
            for s in range(6):
                t = (s + 1) / 6.0
                # arc out and droop at the tip
                rr = uh(3 + t * 15)
                z = uv(20 + math.sin(t * math.pi * 0.85) * 7 - t * t * 9)
                wide = uh(4.2) * math.sin(t * math.pi) + uh(1.0)
                sphere(bm, wide, (math.cos(a) * rr, math.sin(a) * rr, z),
                       scale=(1.0, 1.0, 0.30), segments=6)
        obj("Fronds", bm, [mat("frond", "#22c55e", 0.7)], parent=crown)
        nuts = bmesh.new()
        for ox, oy in ((-2, 1), (2, -1), (0, 2)):
            sphere(nuts, uh(1.6), (uh(ox), uh(oy), uv(16)), segments=6)
        obj("Coconuts", nuts, [mat("coconut", "#a16207", 0.8)], parent=crown)

    def drive(f, n):
        # Gentle sway; one full cycle across the strip so it loops.
        crown.rotation_euler = (0, math.sin(f / n * 2 * math.pi) * 0.05, 0)
    return drive


def build_bench(variant):
    """variant 1 has a guest resting on it, as drawBench()'s tileHash > 0.55."""
    bm = bmesh.new()
    for lx in (-1, 1):
        box(bm, uh(2), uh(2.4), uv(6), (lx * uh(9), 0, uv(3)))
    obj("Legs", bm, [mat("iron", "#1f2937", 0.6, metal=0.4)])

    seat = bmesh.new()
    for i in range(3):
        box(seat, uh(24), uh(2.4), uv(1.4), (0, uh(-2.4 + i * 2.6), uv(7 + i * 0.3)))
    for i in range(3):
        box(seat, uh(24), uh(1.9), uv(2.4), (0, uh(3.4), uv(10.5 + i * 2.6)))
    obj("Slats", seat, [mat("bench_wood", "#b45309", 0.8)])

    arms = bmesh.new()
    for lx in (-1, 1):
        box(arms, uh(2), uh(5), uv(2), (lx * uh(11.5), 0, uv(11)))
    obj("Arms", arms, [mat("iron2", "#374151", 0.6, metal=0.3)])

    if variant == 1:
        g = bmesh.new()
        box(g, uh(6), uh(5), uv(8), (uh(3), 0, uv(12)))
        sphere(g, uh(2.4), (uh(3), 0, uv(17.5)), segments=8)
        obj("Guest", g, [mat("guest_red", "#ef4444", 0.6)])
    return None


def build_trashcan(variant):
    bm = bmesh.new()
    cyl(bm, uh(5), uv(12), (0, 0, uv(6)), segments=14, r2=uh(4))
    obj("Bin", bm, [mat("bin", "#3f4a5a", 0.55, metal=0.35)])

    bands = bmesh.new()
    for i in range(3):
        cyl(bands, uh(4.9 - i * 0.25), uv(0.7), (0, 0, uv(3 + i * 3.5)), segments=14)
    obj("Bands", bands, [mat("band", "#64748b", 0.4, metal=0.6)])

    lid = bmesh.new()
    cyl(lid, uh(5.4), uv(1.4), (0, 0, uv(13.3)), segments=16)
    sphere(lid, uh(4.4), (0, 0, uv(14.2)), scale=(1, 1, 0.45), segments=14)
    obj("Lid", lid, [mat("lid", "#1e293b", 0.5, metal=0.3)])

    hole = bmesh.new()
    cyl(hole, uh(2.4), uv(0.6), (0, 0, uv(15.4)), segments=12)
    obj("Hole", hole, [mat("hole", "#0f172a", 0.9)])
    return None


def build_flowerbed(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=3.0, inset=1.0)
    obj("Bed", bm, [mat("soil", "#3f2d16", 0.95)])

    ring = bmesh.new()
    n = 16
    for i in range(n):
        a = i * 2 * math.pi / n
        cyl(ring, uh(3.0), uv(3.0), (math.cos(a) * 0.46, math.sin(a) * 0.46, L + uv(1.2)),
            segments=6)
    obj("Stones", ring, [mat("stone", "#a8a29e", 0.9)])

    palettes = [["#ef4444", "#f472b6", "#fbbf24"], ["#a855f7", "#60a5fa", "#f9a8d4"]]
    cols = palettes[variant % len(palettes)]
    for ci, c in enumerate(cols):
        fb = bmesh.new()
        for i in range(7):
            a = (ci * 2.4 + i * 1.7)
            rr = 0.12 + (i % 3) * 0.11
            x, y = math.cos(a) * rr, math.sin(a) * rr
            cyl(fb, uh(0.5), uv(4), (x, y, L + uv(2)), segments=4)
            sphere(fb, uh(2.1), (x, y, L + uv(4.6)), scale=(1, 1, 0.6), segments=6)
        obj("Flower%d" % ci, fb, [mat("bloom%d" % ci, c, 0.6)])

    leaves = bmesh.new()
    for i in range(10):
        a = i * 0.63
        rr = 0.2 + (i % 2) * 0.14
        sphere(leaves, uh(2.4), (math.cos(a) * rr, math.sin(a) * rr, L + uv(1.6)),
               scale=(1, 1, 0.35), segments=6)
    obj("Leaves", leaves, [mat("foliage", "#15803d", 0.8)])
    return None


def build_lamp(variant):
    # Sized up from a first pass that read as a bare stick at map scale: a
    # 1.5px-radius post is simply below the threshold where the eye resolves
    # it as a lamp. Ornate base, fluted post, wide hood.
    bm = bmesh.new()
    cyl(bm, uh(6.5), uv(3.0), (0, 0, uv(1.5)), segments=14)               # plinth
    cyl(bm, uh(4.6), uv(3.0), (0, 0, uv(4.2)), segments=12, r2=uh(3.0))   # ogee
    cyl(bm, uh(2.6), uv(30), (0, 0, uv(20)), segments=10)                 # post
    cyl(bm, uh(3.6), uv(2.0), (0, 0, uv(34)), segments=12)                # collar
    obj("Post", bm, [mat("lamp_post", "#334155", 0.5, metal=0.5)])

    head = bmesh.new()
    cyl(head, uh(7.4), uv(1.6), (0, 0, uv(36)), segments=14)              # skirt
    cone(head, uh(8.2), uv(9.0), (0, 0, uv(45)), segments=14)             # hood
    sphere(head, uh(2.0), (0, 0, uv(50.5)), segments=8)                   # finial
    obj("Hood", head, [mat("lamp_hood", "#1e293b", 0.5, metal=0.4)])

    # Baked warm, not emissive-bright: the actual glow is a night overlay in
    # canvas, and main.ts's lampGlows pass paints the pool of light on the
    # ground. Baking the glow here would double-light it at night.
    bulb = bmesh.new()
    sphere(bulb, uh(5.0), (0, 0, uv(37.5)), scale=(1, 1, 0.95), segments=12)
    obj("Bulb", bulb, [mat("bulb", "#fef08a", 0.25, emit=1.4)])
    return None


def build_fountain(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=3.0, inset=1.0)
    obj("Base", bm, [mat("fount_stone", "#94a3b8", 0.85)])

    basin = bmesh.new()
    cyl(basin, 0.47, uv(6), (0, 0, L + uv(3)), segments=28)
    obj("Basin", basin, [mat("basin", "#cbd5e1", 0.7)])

    water = bmesh.new()
    cyl(water, 0.42, uv(1.2), (0, 0, L + uv(5.6)), segments=28)
    obj("Water", water, [mat("water", "#38bdf8", 0.15, metal=0.2)])

    col = bmesh.new()
    cyl(col, uh(3.4), uv(10), (0, 0, L + uv(11)), segments=12)
    cyl(col, uh(7.0), uv(1.6), (0, 0, L + uv(16.5)), segments=16)
    obj("Pedestal", col, [mat("pedestal", "#e2e8f0", 0.7)])

    jets = empty("Jets")

    def drive(f, n):
        for o in list(bpy.data.objects):
            if o.name.startswith("Spray"):
                bpy.data.objects.remove(o, do_unlink=True)
        t = f / n
        sp = bmesh.new()
        for i in range(10):
            a = i * 2 * math.pi / 10
            # Droplets on a ballistic arc, phase-offset per jet so the ring
            # animates instead of pulsing in unison.
            ph = (t + i * 0.1) % 1.0
            rr = uh(2 + ph * 12)
            z = L + uv(18 + math.sin(ph * math.pi) * 9)
            sphere(sp, uh(1.5), (math.cos(a) * rr, math.sin(a) * rr, z), segments=6)
        sphere(sp, uh(2.6), (0, 0, L + uv(19 + math.sin(t * 2 * math.pi) * 1.5)), segments=8)
        obj("Spray", sp, [mat("spray", "#7dd3fc", 0.2)], parent=jets)
    return drive


# ==================================================================
# SHOPS
# ==================================================================

def _stall(bm, roof_col, body_col, counter_col):
    """Shared stall shell: counter block, back wall, pitched roof."""
    L = deck(bm, 1, lift_px=3.0, inset=0.98)
    return L


def build_foodstall(variant):
    bm = bmesh.new()
    L = _stall(bm, None, None, None)
    obj("Pad", bm, [mat("stall_pad", "#57534e", 0.9)])

    body = bmesh.new()
    box(body, 0.72, 0.5, uv(16), (0, uh(6), L + uv(8)))
    obj("Body", body, [mat("food_body", "#fef3c7", 0.8)])

    counter = bmesh.new()
    box(counter, 0.78, uh(7), uv(11), (0, uh(-8), L + uv(5.5)))
    obj("Counter", counter, [mat("food_counter", "#b45309", 0.75)])

    roof = bmesh.new()
    for i in range(8):
        x = -0.40 + i * 0.115
        box(roof, 0.11, 0.62, uv(2.2), (x, 0, L + uv(19)), rot_z=0)
        m = "food_stripe_a" if i % 2 == 0 else "food_stripe_b"
    obj("Roof", roof, [mat("food_roof", "#dc2626", 0.6)])

    stripes = bmesh.new()
    for i in range(0, 8, 2):
        x = -0.40 + i * 0.115
        box(stripes, 0.11, 0.63, uv(2.4), (x, 0, L + uv(19.05)))
    obj("RoofStripe", stripes, [mat("food_roof_w", "#ffffff", 0.6)])

    sign = bmesh.new()
    box(sign, 0.5, uh(1.5), uv(7), (0, uh(-11), L + uv(23)))
    obj("Sign", sign, [mat("food_sign", "#7c2d12", 0.7)])

    def drive(f, n):
        for o in list(bpy.data.objects):
            if o.name.startswith("Steam"):
                bpy.data.objects.remove(o, do_unlink=True)
        t = f / n
        sm = bmesh.new()
        for i in range(4):
            ph = (t + i * 0.25) % 1.0
            sphere(sm, uh(2.2 + ph * 3.0),
                   (uh(-6 + i * 4), uh(-4), L + uv(20 + ph * 16)),
                   scale=(1, 1, 0.9), segments=6)
        obj("Steam", sm, [mat("steam", "#f8fafc", 0.9, alpha=0.5)])
    return drive


def build_drinkstall(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=3.0, inset=0.98)
    obj("Pad", bm, [mat("drink_pad", "#57534e", 0.9)])

    body = bmesh.new()
    box(body, 0.72, 0.5, uv(16), (0, uh(6), L + uv(8)))
    obj("Body", body, [mat("drink_body", "#dbeafe", 0.8)])

    counter = bmesh.new()
    box(counter, 0.78, uh(7), uv(11), (0, uh(-8), L + uv(5.5)))
    obj("Counter", counter, [mat("drink_counter", "#0369a1", 0.7)])

    # A shallow wide cone reads as a flat disc from 30deg elevation, which is
    # what the first pass did. Narrower and much taller so it reads as a roof.
    roof = bmesh.new()
    cone(roof, 0.52, uv(20), (0, 0, L + uv(26)), segments=14)
    obj("Roof", roof, [mat("drink_roof", "#0ea5e9", 0.6)])

    eave = bmesh.new()
    cyl(eave, 0.54, uv(2.0), (0, 0, L + uv(17)), segments=16)
    obj("Eave", eave, [mat("drink_eave", "#0369a1", 0.6)])

    # Giant cup sign, mounted at the front corner rather than floating over
    # the roof ridge where it read as an unattached blob.
    cup = bmesh.new()
    cyl(cup, uh(6), uv(13), (uh(16), uh(-14), L + uv(30)), segments=12, r2=uh(4.2))
    cyl(cup, uh(6.4), uv(1.4), (uh(16), uh(-14), L + uv(37)), segments=12)
    obj("BigCup", cup, [mat("cup", "#f87171", 0.55)])
    straw = bmesh.new()
    tube(straw, (uh(17), uh(-14), L + uv(36)), (uh(21), uh(-17), L + uv(48)), uh(1.1))
    obj("Straw", straw, [mat("straw", "#fafafa", 0.5)])

    bub = empty("Bubbles")

    def drive(f, n):
        for o in list(bpy.data.objects):
            if o.name.startswith("Bub"):
                bpy.data.objects.remove(o, do_unlink=True)
        t = f / n
        b = bmesh.new()
        for i in range(5):
            ph = (t + i * 0.2) % 1.0
            sphere(b, uh(1.4), (uh(-1 + i * 1.2), uh(-11), L + uv(24 + ph * 12)), segments=6)
        obj("Bub", b, [mat("bubble", "#bae6fd", 0.3, alpha=0.7)])
    return drive


def build_restroom(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=3.0, inset=0.98)
    obj("Pad", bm, [mat("rr_pad", "#57534e", 0.9)])

    body = bmesh.new()
    box(body, 0.8, 0.68, uv(22), (0, 0, L + uv(11)))
    obj("Body", body, [mat("rr_body", "#e7e5e4", 0.85)])

    roof = bmesh.new()
    box(roof, 0.88, 0.76, uv(3), (0, 0, L + uv(23)))
    obj("Roof", roof, [mat("rr_roof", "#57534e", 0.8)])

    doors = bmesh.new()
    for lx in (-1, 1):
        box(doors, 0.3, uh(1.5), uv(15), (lx * 0.19, uh(-15.5), L + uv(8)))
    obj("Doors", doors, [mat("rr_door", "#1d4ed8", 0.6)])

    signs = bmesh.new()
    for lx in (-1, 1):
        box(signs, uh(5), uh(1.2), uv(5), (lx * 0.19, uh(-16.2), L + uv(18)))
    obj("Signs", signs, [mat("rr_sign", "#ffffff", 0.6)])
    return None


def build_balloonstand(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=3.0, inset=0.98)
    obj("Pad", bm, [mat("bs_pad", "#57534e", 0.9)])

    cart = bmesh.new()
    box(cart, 0.5, uh(12), uv(13), (0, 0, L + uv(6.5)))
    obj("Cart", cart, [mat("bs_cart", "#be185d", 0.7)])

    wheels = bmesh.new()
    for lx in (-1, 1):
        cyl(wheels, uh(4), uh(1.6), (lx * 0.22, uh(-6.5), L + uv(4)), segments=12)
    obj("Wheels", wheels, [mat("bs_wheel", "#1f2937", 0.6)])

    pole = bmesh.new()
    cyl(pole, uh(1.2), uv(22), (0, 0, L + uv(24)), segments=8)
    obj("Pole", pole, [mat("bs_pole", "#78716c", 0.6)])

    cluster = empty("Balloons")
    cols = ["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#a855f7", "#fb923c"]
    for i, c in enumerate(cols):
        a = i * 2 * math.pi / len(cols)
        b = bmesh.new()
        r = 0.13
        pos = (math.cos(a) * r, math.sin(a) * r, L + uv(42 + (i % 3) * 4))
        sphere(b, uh(5.2), pos, scale=(1, 1, 1.15), segments=10)
        tube(b, pos, (0, 0, L + uv(34)), uh(0.4), segments=4)
        obj("Balloon%d" % i, b, [mat("bal%d" % i, c, 0.35)], parent=cluster)

    def drive(f, n):
        t = f / n * 2 * math.pi
        cluster.rotation_euler = (math.sin(t) * 0.07, math.cos(t) * 0.07, 0)
        cluster.location = (0, 0, math.sin(t) * uv(2.0))
    return drive


# ==================================================================
# RIDES -- 1x1
# ==================================================================

def build_carousel(variant):
    """The pilot. Palette and proportions come from the vector drawCarousel()
    it replaced, so the swap didn't shift the park's colour language.

    Two deliberate departures from that art, both forced by real geometry:
    the canopy radius is 26px not 30px (a real cone shows its underside at
    30deg elevation and swallowed the horses, which a flat triangle never
    did), and the horses bob 3 cycles per revolution so a finite strip loops.
    """
    L = uv(4)
    bm = bmesh.new()
    deck(bm, 1, lift_px=4.0)
    d = obj("Deck", bm, [mat("ca_deck_top", "#b45309", 0.7),
                         mat("ca_deck_side", "#7c2d12", 0.8)])
    for pg in d.data.polygons:
        pg.material_index = 0 if pg.normal.z > 0.5 else 1

    col_z, col_h = L + uv(3), uv(36)
    c = bmesh.new()
    cyl(c, uh(3), col_h, (0, 0, col_z + col_h / 2), segments=12)
    obj("Column", c, [mat("ca_col", "#78350f", 0.6)])

    spin = empty("Spin")
    rim = bmesh.new()
    cyl(rim, 0.515, uv(3), (0, 0, L - uv(0.5)), segments=32)
    obj("PlatRim", rim, [mat("ca_rim", "#92400e", 0.7)], parent=spin)
    pl = bmesh.new()
    cyl(pl, 0.5, uv(3), (0, 0, L + uv(1.5)), segments=32)
    obj("Platform", pl, [mat("ca_plat", "#fbbf24", 0.45)], parent=spin)

    # Sunburst spokes -- without them a smooth disc looks static no matter
    # how fast it spins.
    sp = bmesh.new()
    for i in range(10):
        box(sp, 0.46, uh(1.2), uv(0.8), (0.23, 0, L + uv(3.4)),
            rot_z=i * math.pi / 5)
    obj("Spokes", sp, [mat("ca_spoke", "#fef3c7", 0.5)], parent=spin)

    R = uh(19)
    horse_z = L + uv(3)
    canopy_base_z = col_z + col_h * 0.74
    cols = ["#f472b6", "#60a5fa", "#facc15", "#4ade80", "#c084fc", "#fb923c"]
    for i in range(6):
        a = i * (2 * math.pi / 6)
        bob = uv(2.5) * math.sin(a * 3.0)
        px, py = math.cos(a) * R, math.sin(a) * R
        bz = horse_z + uv(9) + bob

        h = bmesh.new()
        sphere(h, uh(3.4), (0, 0, 0), scale=(0.75, 1.55, 0.85))
        sphere(h, uh(2.4), (0, uh(3.6), uv(3.4)), scale=(0.8, 0.9, 1.2))
        sphere(h, uh(1.9), (0, uh(4.6), uv(6.2)), scale=(0.8, 1.3, 0.8))
        for lx, ly in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
            box(h, uh(1.3), uh(1.3), uv(6.0), (lx * uh(1.5), ly * uh(2.4), -uv(4.2)))
        sphere(h, uh(1.5), (0, -uh(4.4), uv(1.6)), scale=(0.6, 1.2, 0.8))
        obj("Horse%d" % i, h, [mat("ca_horse%d" % i, cols[i], 0.45)],
            parent=spin, loc=(px, py, bz), rot_z=a + math.pi / 2)

        s = bmesh.new()
        box(s, uh(4.2), uh(5.0), uv(1.6), (0, 0, uv(3.0)))
        obj("Saddle%d" % i, s, [mat("ca_saddle", "#7f1d1d", 0.6)],
            parent=spin, loc=(px, py, bz), rot_z=a + math.pi / 2)

        r = bmesh.new()
        sphere(r, uh(1.7), (0, 0, uv(7.0)))
        obj("Rider%d" % i, r, [mat("ca_skin", "#fcd9b6", 0.6)],
            parent=spin, loc=(px, py, bz), rot_z=a + math.pi / 2)

        pz = bmesh.new()
        cyl(pz, uh(0.7), canopy_base_z - horse_z,
            (px, py, (horse_z + canopy_base_z) / 2), segments=8)
        obj("Pole%d" % i, pz, [mat("ca_pole", "#e5e7eb", 0.3, metal=0.7)], parent=spin)

    can_h = uv(24)
    cp = bmesh.new()
    cone(cp, uh(26), can_h, (0, 0, canopy_base_z + can_h / 2), segments=16)
    canopy = obj("Canopy", cp, [mat("ca_can_a", "#ef4444", 0.5),
                                mat("ca_can_b", "#ffffff", 0.5)])
    for pg in canopy.data.polygons:
        ang = math.atan2(pg.center.y, pg.center.x)
        pg.material_index = int(((ang + math.pi) / (2 * math.pi)) * 16) % 2

    val = bmesh.new()
    cyl(val, uh(26), uv(3.5), (0, 0, canopy_base_z - uv(1.0)), segments=32)
    obj("Valance", val, [mat("ca_valance", "#dc2626", 0.55)])
    return spin


def build_teacups(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=4.0)
    obj("Deck", bm, [mat("tc_deck", "#6d28d9", 0.75)])
    f = bmesh.new()
    pad_fence(f, 1)
    obj("Fence", f, [mat("tc_fence", "#c4b5fd", 0.5)])

    spin = empty("Spin")
    plate = bmesh.new()
    cyl(plate, 0.46, uv(3), (0, 0, L + uv(1.5)), segments=28)
    obj("Plate", plate, [mat("tc_plate", "#a78bfa", 0.6)], parent=spin)

    cols = ["#f472b6", "#60a5fa", "#facc15", "#4ade80"]
    for i, c in enumerate(cols):
        a = i * math.pi / 2
        cup = bmesh.new()
        pos = (math.cos(a) * uh(14), math.sin(a) * uh(14), L + uv(9))
        cyl(cup, uh(7), uv(11), pos, segments=14, r2=uh(5.5))
        cyl(cup, uh(7.4), uv(1.2), (pos[0], pos[1], L + uv(14.5)), segments=14)
        obj("Cup%d" % i, cup, [mat("tc_cup%d" % i, c, 0.5)], parent=spin)
        h = bmesh.new()
        tube(h, (pos[0] + uh(7), pos[1], L + uv(11)),
             (pos[0] + uh(11), pos[1], L + uv(8)), uh(1.0), segments=5)
        obj("Handle%d" % i, h, [mat("tc_handle", "#ffffff", 0.4)], parent=spin)

    hub = bmesh.new()
    cyl(hub, uh(4), uv(14), (0, 0, L + uv(9)), segments=10)
    cone(hub, uh(9), uv(7), (0, 0, L + uv(19)), segments=12)
    obj("Hub", hub, [mat("tc_hub", "#7c3aed", 0.6)])
    return spin


def build_bumper(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=4.0)
    obj("Floor", bm, [mat("bp_floor", "#1f2937", 0.4, metal=0.5)])

    rail = bmesh.new()
    pad_fence(rail, 1, h_px=9.0)
    obj("Rail", rail, [mat("bp_rail", "#f59e0b", 0.5)])

    spin = empty("Spin")
    cols = ["#ef4444", "#3b82f6", "#22c55e", "#facc15", "#a855f7"]
    for i, c in enumerate(cols):
        a = i * 2 * math.pi / len(cols)
        r = 0.30 if i % 2 == 0 else 0.20
        px, py = math.cos(a) * r, math.sin(a) * r
        car = bmesh.new()
        sphere(car, uh(8), (px, py, L + uv(5)), scale=(1, 0.8, 0.42), segments=10)
        box(car, uh(7), uh(6), uv(5), (px, py, L + uv(8)))
        obj("Car%d" % i, car, [mat("bp_car%d" % i, c, 0.4, metal=0.2)], parent=spin)
        d = bmesh.new()
        sphere(d, uh(2.6), (px, py, L + uv(12)), segments=8)
        obj("Driver%d" % i, d, [mat("bp_skin", "#fcd9b6", 0.6)], parent=spin)
        p = bmesh.new()
        tube(p, (px, py, L + uv(10)), (px, py, L + uv(24)), uh(0.6), segments=5)
        obj("Pole%d" % i, p, [mat("bp_pole", "#94a3b8", 0.3, metal=0.7)], parent=spin)

    # Electrified ceiling grid. The first pass drew bare parallel lines with
    # nothing holding them up, which read as sticks poking through the ride
    # rather than as a canopy -- it needs corner posts and both directions.
    Z = L + uv(26)
    grid = bmesh.new()
    for cx_, cy_ in ((-0.46, -0.46), (0.46, -0.46), (0.46, 0.46), (-0.46, 0.46)):
        cyl(grid, uh(1.6), uv(26), (cx_, cy_, L + uv(13)), segments=6)
    for i in range(5):
        t = -0.44 + i * 0.22
        tube(grid, (t, -0.44, Z), (t, 0.44, Z), uh(0.5), segments=4)
        tube(grid, (-0.44, t, Z), (0.44, t, Z), uh(0.5), segments=4)
    obj("Grid", grid, [mat("bp_grid", "#64748b", 0.4, metal=0.6)])
    return spin


def build_droptower(variant):
    bm = bmesh.new()
    L = deck(bm, 1, lift_px=4.0)
    obj("Deck", bm, [mat("dt_deck", "#3f3f46", 0.8)])
    f = bmesh.new()
    pad_fence(f, 1)
    obj("Fence", f, [mat("dt_fence", "#fbbf24", 0.5)])

    TOP = uv(72)
    tower = bmesh.new()
    for lx, ly in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        tube(tower, (lx * uh(6), ly * uh(6), L), (lx * uh(4), ly * uh(4), TOP), uh(1.3), segments=6)
    for i in range(9):
        z = L + (TOP - L) * (i / 9.0)
        s = uh(6) - (uh(2) * i / 9.0)
        tube(tower, (-s, -s, z), (s, -s, z), uh(0.7), segments=4)
        tube(tower, (s, -s, z), (s, s, z), uh(0.7), segments=4)
        tube(tower, (s, s, z), (-s, s, z), uh(0.7), segments=4)
        tube(tower, (-s, s, z), (-s, -s, z), uh(0.7), segments=4)
    obj("Tower", tower, [mat("dt_tower", "#e11d48", 0.5, metal=0.4)])

    cap = bmesh.new()
    cone(cap, uh(9), uv(10), (0, 0, TOP + uv(5)), segments=12)
    obj("Cap", cap, [mat("dt_cap", "#fbbf24", 0.5)])

    car = empty("Car")
    c = bmesh.new()
    cyl(c, uh(11), uv(4), (0, 0, 0), segments=16)
    for i in range(6):
        a = i * 2 * math.pi / 6
        px, py = math.cos(a) * uh(9), math.sin(a) * uh(9)
        box(c, uh(5), uh(5), uv(6), (px, py, uv(4)))
        sphere(c, uh(2.2), (px, py, uv(8)), segments=6)
    obj("CarBody", c, [mat("dt_car", "#0ea5e9", 0.45)], parent=car)

    def drive(f, n):
        # Slow winch up, fast drop, brief settle -- the shape drawDropTower()
        # animates with its (simClock % cycle) ramp.
        t = f / n
        if t < 0.62:
            h = t / 0.62
        elif t < 0.78:
            h = 1.0 - ((t - 0.62) / 0.16) ** 2
        else:
            h = 0.0
        car.location = (0, 0, L + uv(6) + h * (TOP - L - uv(18)))
    return drive


# ==================================================================
# RIDES -- 2x2
# ==================================================================

def build_ship(variant):
    bm = bmesh.new()
    L = deck(bm, 2, lift_px=4.0)
    obj("Deck", bm, [mat("sh_deck", "#0e7490", 0.8)])
    f = bmesh.new()
    pad_fence(f, 2)
    obj("Fence", f, [mat("sh_fence", "#f59e0b", 0.5)])

    PIVOT = uv(60)
    a_frame = bmesh.new()
    for sy in (-1, 1):
        tube(a_frame, (-0.55, sy * 0.28, L), (0, sy * 0.10, PIVOT), uh(2.2), segments=6)
        tube(a_frame, (0.55, sy * 0.28, L), (0, sy * 0.10, PIVOT), uh(2.2), segments=6)
    tube(a_frame, (0, -0.12, PIVOT), (0, 0.12, PIVOT), uh(1.6), segments=6)
    obj("Frame", a_frame, [mat("sh_frame", "#f59e0b", 0.5, metal=0.4)])

    swing = empty("Swing")
    swing.location = (0, 0, PIVOT)

    arm = bmesh.new()
    for sy in (-1, 1):
        tube(arm, (0, sy * 0.09, 0), (0, sy * 0.09, -uv(42)), uh(1.6), segments=6)
    obj("Arm", arm, [mat("sh_arm", "#64748b", 0.4, metal=0.6)], parent=swing)

    # A hull, not a slab. The first pass was one flattened sphere with two
    # cones stuck on top, which read as a teal puddle: a boat needs a rounded
    # underside, a flat deck, and ends that RISE above that deck.
    boat = bmesh.new()
    sphere(boat, uh(32), (0, 0, -uv(44)), scale=(1.0, 0.30, 0.34), segments=20)
    box(boat, uh(54), uh(18), uv(3), (0, 0, -uv(40)))              # deck
    for i in range(8):                                              # gunwale ribs
        x = uh(-24.5 + i * 7)
        box(boat, uh(1.8), uh(19), uv(6), (x, 0, -uv(37)))
    for sx in (-1, 1):                                              # rising ends
        for k in range(4):
            t = k / 3.0
            sphere(boat, uh(7.5 - t * 3.0),
                   (sx * uh(26 + t * 9), 0, -uv(42 - t * 15)),
                   scale=(1.0, 0.55, 1.0), segments=8)
    obj("Boat", boat, [mat("sh_boat", "#0891b2", 0.5)], parent=swing)

    trim = bmesh.new()
    box(trim, uh(56), uh(20), uv(2.4), (0, 0, -uv(36.5)))
    obj("Trim", trim, [mat("sh_prow", "#fbbf24", 0.5)], parent=swing)

    riders = bmesh.new()
    for i in range(7):
        x = uh(-21 + i * 7)
        sphere(riders, uh(2.6), (x, 0, -uv(33)), segments=6)
    obj("Riders", riders, [mat("sh_rider", "#fcd9b6", 0.6)], parent=swing)

    def drive(f, n):
        swing.rotation_euler = (0, math.sin(f / n * 2 * math.pi) * math.radians(48), 0)
    return drive


def build_haunted(variant):
    bm = bmesh.new()
    L = deck(bm, 2, lift_px=4.0)
    obj("Deck", bm, [mat("hh_deck", "#3b0764", 0.9)])
    f = bmesh.new()
    pad_fence(f, 2)
    obj("Fence", f, [mat("hh_fence", "#6d28d9", 0.6)])

    body = bmesh.new()
    box(body, 1.25, 1.0, uv(46), (0, uh(6), L + uv(23)))
    obj("House", body, [mat("hh_wall", "#4c1d95", 0.9)])

    roofs = bmesh.new()
    cone(roofs, 0.98, uv(30), (0, uh(6), L + uv(60)), segments=4)
    cone(roofs, 0.42, uv(26), (-0.42, uh(-14), L + uv(52)), segments=4)
    cone(roofs, 0.34, uv(22), (0.46, uh(-12), L + uv(48)), segments=4)
    obj("Roof", roofs, [mat("hh_roof", "#1e1b4b", 0.9)])

    tower = bmesh.new()
    box(tower, 0.34, 0.34, uv(34), (0.46, uh(-12), L + uv(20)))
    box(tower, 0.30, 0.30, uv(30), (-0.42, uh(-14), L + uv(20)))
    obj("Towers", tower, [mat("hh_tower", "#4c1d95", 0.9)])

    porch = bmesh.new()
    box(porch, 0.5, uh(9), uv(3), (0, uh(-22), L + uv(2)))
    for lx in (-1, 1):
        cyl(porch, uh(2), uv(20), (lx * 0.2, uh(-24), L + uv(12)), segments=8)
    obj("Porch", porch, [mat("hh_porch", "#312e81", 0.9)])

    door = bmesh.new()
    box(door, uh(14), uh(1.5), uv(20), (0, uh(-19), L + uv(10)))
    obj("Door", door, [mat("hh_door", "#111827", 0.8)])

    # Windows are baked dark; drawHauntedHouseNight() lights them.
    win = bmesh.new()
    for wx, wz in ((-0.30, 30), (0.30, 30), (0, 44), (0.46, 26)):
        box(win, uh(9), uh(1.2), uv(10), (wx, uh(-18.5), L + uv(wz)))
    obj("Windows", win, [mat("hh_win", "#1c1917", 0.6)])
    return None


def build_gokarts(variant):
    bm = bmesh.new()
    L = deck(bm, 2, lift_px=4.0)
    obj("Ground", bm, [mat("gk_ground", "#166534", 0.95)])

    TRACK_A, TRACK_B = 0.80, 0.54           # oval radii, sized to fill the 2x2 pad
    track = bmesh.new()
    N = 40
    for i in range(N):
        a0 = i * 2 * math.pi / N
        a1 = (i + 1) * 2 * math.pi / N
        p0 = (math.cos(a0) * TRACK_A, math.sin(a0) * TRACK_B, L + uv(1))
        p1 = (math.cos(a1) * TRACK_A, math.sin(a1) * TRACK_B, L + uv(1))
        tube(track, p0, p1, uh(9), segments=6)
    obj("Track", track, [mat("gk_track", "#3f3f46", 0.95)])

    kerb = bmesh.new()
    for i in range(N):
        a0 = i * 2 * math.pi / N
        a1 = (i + 1) * 2 * math.pi / N
        for scale, r in ((1.0, uh(1.6)),):
            p0 = (math.cos(a0) * (TRACK_A + uh(9)) * scale, math.sin(a0) * (TRACK_B + uh(9)) * scale, L + uv(2))
            p1 = (math.cos(a1) * (TRACK_A + uh(9)) * scale, math.sin(a1) * (TRACK_B + uh(9)) * scale, L + uv(2))
            tube(kerb, p0, p1, r, segments=4)
    obj("Kerb", kerb, [mat("gk_kerb", "#ef4444", 0.7)])

    spin = empty("Spin")
    cols = ["#ef4444", "#3b82f6", "#facc15", "#22c55e"]
    for i, c in enumerate(cols):
        a = i * 2 * math.pi / len(cols)
        px, py = math.cos(a) * TRACK_A, math.sin(a) * TRACK_B
        k = bmesh.new()
        box(k, uh(17), uh(11), uv(5), (px, py, L + uv(4)))
        box(k, uh(9), uh(9), uv(5), (px, py, L + uv(8)))
        sphere(k, uh(3.0), (px, py, L + uv(12)), segments=6)
        obj("Kart%d" % i, k, [mat("gk_kart%d" % i, c, 0.45)], parent=spin)

    flag = bmesh.new()
    for lx in (-1, 1):
        cyl(flag, uh(1.6), uv(30), (lx * 0.30, -0.52, L + uv(15)), segments=6)
    box(flag, 0.62, uh(2), uv(8), (0, -0.52, L + uv(28)))
    obj("Gantry", flag, [mat("gk_gantry", "#f8fafc", 0.6)])

    def drive(f, n):
        spin.rotation_euler = (0, 0, f / n * 2 * math.pi)
    return drive


def build_ferriswheel(variant):
    bm = bmesh.new()
    L = deck(bm, 2, lift_px=4.0)
    obj("Deck", bm, [mat("fw_deck", "#1e3a8a", 0.8)])
    f = bmesh.new()
    pad_fence(f, 2)
    obj("Fence", f, [mat("fw_fence", "#93c5fd", 0.5)])

    HUB = uv(62)
    R = uh(56)
    legs = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(legs, (sx * 0.42, sy * 0.24, L), (0, sy * 0.06, HUB), uh(2.4), segments=6)
    obj("Legs", legs, [mat("fw_legs", "#1d4ed8", 0.5, metal=0.4)])

    wheel = empty("Wheel")
    wheel.location = (0, 0, HUB)
    wheel.rotation_euler = (math.pi / 2, 0, 0)      # stand the wheel upright

    rim = bmesh.new()
    N = 24
    for i in range(N):
        a0, a1 = i * 2 * math.pi / N, (i + 1) * 2 * math.pi / N
        for off in (-uh(7), uh(7)):
            tube(rim, (math.cos(a0) * R, math.sin(a0) * R, off),
                 (math.cos(a1) * R, math.sin(a1) * R, off), uh(1.6), segments=5)
    for i in range(12):
        a = i * 2 * math.pi / 12
        tube(rim, (0, 0, 0), (math.cos(a) * R, math.sin(a) * R, 0), uh(1.1), segments=5)
    cyl(rim, uh(8), uh(20), (0, 0, 0), segments=12)
    obj("Rim", rim, [mat("fw_rim", "#60a5fa", 0.4, metal=0.5)], parent=wheel)

    # Gondolas hang from the rim but must stay level as it turns, so they are
    # parented to the world and repositioned per frame instead of to the wheel.
    gond = []
    cols = ["#ef4444", "#facc15", "#22c55e", "#a855f7", "#fb923c", "#06b6d4",
            "#f472b6", "#84cc16"]
    for i, c in enumerate(cols):
        g = bmesh.new()
        box(g, uh(13), uh(20), uv(9), (0, 0, 0))
        cyl(g, uh(7), uh(21), (0, 0, uv(5)), segments=10)
        o = obj("Gondola%d" % i, g, [mat("fw_g%d" % i, c, 0.5)])
        gond.append(o)

    def drive(fi, n):
        ang = fi / n * 2 * math.pi
        wheel.rotation_euler = (math.pi / 2, 0, ang)
        for i, o in enumerate(gond):
            a = ang + i * 2 * math.pi / len(gond)
            o.location = (math.cos(a) * R, 0, HUB + math.sin(a) * R - uv(9))
    return drive


def build_coaster(variant):
    bm = bmesh.new()
    L = deck(bm, 2, lift_px=4.0)
    obj("Ground", bm, [mat("co_ground", "#065f46", 0.95)])

    # A closed circuit with one lift hill, so a train can loop it forever.
    def path(t):
        a = t * 2 * math.pi
        x = math.cos(a) * 0.66
        y = math.sin(a) * 0.42
        hill = math.sin(a * 2) * 0.5 + 0.5
        z = L + uv(10 + hill * 46)
        return (x, y, z)

    rails = bmesh.new()
    N = 72
    pts = [path(i / N) for i in range(N + 1)]
    for i in range(N):
        p0, p1 = pts[i], pts[i + 1]
        for off in (-uh(5), uh(5)):
            tube(rails, (p0[0], p0[1] + off, p0[2]), (p1[0], p1[1] + off, p1[2]),
                 uh(1.5), segments=5)
        tube(rails, (p0[0], p0[1], p0[2] - uv(3)), (p1[0], p1[1], p1[2] - uv(3)),
             uh(1.2), segments=5)
    obj("Rails", rails, [mat("co_rail", "#ef4444", 0.45, metal=0.5)])

    ties = bmesh.new()
    for i in range(0, N, 2):
        p = pts[i]
        box(ties, uh(3), uh(13), uv(1.6), (p[0], p[1], p[2] - uv(1.5)))
        if p[2] > L + uv(14):
            tube(ties, (p[0], p[1], L), (p[0], p[1], p[2] - uv(3)), uh(1.4), segments=5)
    obj("Ties", ties, [mat("co_struct", "#f8fafc", 0.6)])

    station = bmesh.new()
    box(station, 0.44, 0.26, uv(4), (0.60, -0.30, L + uv(10)))
    for lx in (-1, 1):
        cyl(station, uh(2), uv(18), (0.60 + lx * 0.18, -0.30, L + uv(19)), segments=6)
    box(station, 0.50, 0.30, uv(3), (0.60, -0.30, L + uv(29)))
    obj("Station", station, [mat("co_station", "#0f766e", 0.7)])

    cars = []
    for i in range(3):
        c = bmesh.new()
        box(c, uh(16), uh(11), uv(8), (0, 0, 0))
        sphere(c, uh(2.4), (uh(-4), 0, uv(7)), segments=6)
        sphere(c, uh(2.4), (uh(4), 0, uv(7)), segments=6)
        cars.append(obj("Car%d" % i, c, [mat("co_car%d" % i,
                     ["#facc15", "#f97316", "#ef4444"][i], 0.45)]))

    def drive(f, n):
        t0 = f / n
        for i, c in enumerate(cars):
            t = (t0 + i * 0.022) % 1.0
            p = path(t)
            nx = path((t + 0.01) % 1.0)
            c.location = (p[0], p[1], p[2] + uv(5))
            c.rotation_euler = (0, 0, math.atan2(nx[1] - p[1], nx[0] - p[0]))
    return drive


# ==================================================================
# RIDES -- 4x4
# ==================================================================

def build_megacoaster(variant):
    bm = bmesh.new()
    L = deck(bm, 4, lift_px=5.0)
    obj("Ground", bm, [mat("mc_ground", "#134e4a", 0.95)])

    def path(t):
        a = t * 2 * math.pi
        x = math.cos(a) * 1.45
        y = math.sin(a) * 0.95 + math.sin(a * 2) * 0.22
        lift = max(0.0, math.sin(a - 0.4))
        drop = math.sin(a * 3) * 0.22 + 0.22
        z = L + uv(14 + lift * 84 + drop * 22)
        return (x, y, z)

    rails = bmesh.new()
    N = 132
    pts = [path(i / N) for i in range(N + 1)]
    for i in range(N):
        p0, p1 = pts[i], pts[i + 1]
        for off in (-uh(6), uh(6)):
            tube(rails, (p0[0], p0[1] + off, p0[2]), (p1[0], p1[1] + off, p1[2]),
                 uh(1.7), segments=5)
        tube(rails, (p0[0], p0[1], p0[2] - uv(4)), (p1[0], p1[1], p1[2] - uv(4)),
             uh(1.4), segments=5)
    obj("Rails", rails, [mat("mc_rail", "#f43f5e", 0.45, metal=0.5)])

    struct = bmesh.new()
    # Every 5th point, not every 3rd: at 3 the columns merged into a white
    # wall and the track stopped reading as track.
    for i in range(0, N, 5):
        p = pts[i]
        box(struct, uh(3.4), uh(15), uv(1.8), (p[0], p[1], p[2] - uv(2)))
        if p[2] > L + uv(20):
            tube(struct, (p[0], p[1], L), (p[0], p[1], p[2] - uv(4)), uh(1.8), segments=5)
            # Cross-bracing -- what makes a big coaster read as engineered
            # rather than as a floating ribbon.
            mid = (p[2] + L) / 2
            tube(struct, (p[0] - uh(9), p[1], L), (p[0] + uh(9), p[1], mid), uh(0.9), segments=4)
            tube(struct, (p[0] + uh(9), p[1], L), (p[0] - uh(9), p[1], mid), uh(0.9), segments=4)
    obj("Struct", struct, [mat("mc_struct", "#e2e8f0", 0.6)])

    station = bmesh.new()
    box(station, 0.9, 0.5, uv(5), (1.05, -0.75, L + uv(12)))
    for lx in (-1, 1):
        for ly in (-1, 1):
            cyl(station, uh(2.6), uv(24), (1.05 + lx * 0.38, -0.75 + ly * 0.18, L + uv(24)),
                segments=6)
    box(station, 1.0, 0.58, uv(4), (1.05, -0.75, L + uv(37)))
    cone(station, 0.62, uv(16), (1.05, -0.75, L + uv(46)), segments=10)
    obj("Station", station, [mat("mc_station", "#be123c", 0.65)])

    cars = []
    for i in range(5):
        c = bmesh.new()
        box(c, uh(19), uh(13), uv(9), (0, 0, 0))
        for sx in (-1, 1):
            sphere(c, uh(2.6), (sx * uh(5), 0, uv(8)), segments=6)
        cars.append(obj("MCar%d" % i, c, [mat("mc_car%d" % i,
                     ["#fef08a", "#fb923c", "#f43f5e", "#e11d48", "#9f1239"][i], 0.45)]))

    def drive(f, n):
        t0 = f / n
        for i, c in enumerate(cars):
            t = (t0 + i * 0.016) % 1.0
            p = path(t)
            nx = path((t + 0.008) % 1.0)
            c.location = (p[0], p[1], p[2] + uv(6))
            c.rotation_euler = (0, 0, math.atan2(nx[1] - p[1], nx[0] - p[0]))
    return drive


# ==================================================================
# MANIFEST
# ==================================================================
# w/h are the logical sprite box in game px. Width must clear the footprint's
# diamond (64 px per tile) plus overhang; height must clear the tallest point
# plus the pad's lower half, or the render clips with no warning.

MANIFEST = [
    # scenery -- 1x1
    dict(id="tree",         tiles=1, w=96,  h=128, frames=8,  variants=3, build=build_tree),
    dict(id="bench",        tiles=1, w=96,  h=96,  frames=1,  variants=2, build=build_bench),
    dict(id="trashcan",     tiles=1, w=96,  h=96,  frames=1,  variants=1, build=build_trashcan),
    dict(id="flowerbed",    tiles=1, w=96,  h=96,  frames=1,  variants=2, build=build_flowerbed),
    dict(id="lamp",         tiles=1, w=96,  h=128, frames=1,  variants=1, build=build_lamp),
    dict(id="fountain",     tiles=1, w=96,  h=112, frames=8,  variants=1, build=build_fountain),
    # shops -- 1x1
    dict(id="foodstall",    tiles=1, w=96,  h=128, frames=8,  variants=1, build=build_foodstall),
    dict(id="drinkstall",   tiles=1, w=96,  h=128, frames=8,  variants=1, build=build_drinkstall),
    dict(id="restroom",     tiles=1, w=96,  h=112, frames=1,  variants=1, build=build_restroom),
    dict(id="balloonstand", tiles=1, w=96,  h=144, frames=8,  variants=1, build=build_balloonstand),
    # rides -- 1x1
    dict(id="carousel",     tiles=1, w=96,  h=128, frames=16, variants=1, build=build_carousel),
    dict(id="teacups",      tiles=1, w=96,  h=112, frames=16, variants=1, build=build_teacups),
    dict(id="bumper",       tiles=1, w=96,  h=112, frames=16, variants=1, build=build_bumper),
    dict(id="droptower",    tiles=1, w=96,  h=208, frames=16, variants=1, build=build_droptower),
    # rides -- 2x2
    dict(id="ship",         tiles=2, w=176, h=208, frames=16, variants=1, build=build_ship),
    dict(id="haunted",      tiles=2, w=176, h=176, frames=1,  variants=1, build=build_haunted),
    dict(id="gokarts",      tiles=2, w=176, h=144, frames=12, variants=1, build=build_gokarts),
    dict(id="ferriswheel",  tiles=2, w=176, h=272, frames=12, variants=1, build=build_ferriswheel),
    dict(id="coaster",      tiles=2, w=176, h=176, frames=12, variants=1, build=build_coaster),
    # rides -- 4x4
    dict(id="megacoaster",  tiles=4, w=320, h=352, frames=12, variants=1, build=build_megacoaster),
]


def main(only=None, blends=True):
    scene = bpy.context.scene
    done = []
    for spec in MANIFEST:
        if only and spec["id"] not in only:
            continue
        meta = kit.render_all(scene, spec, spec["build"], OUT_ROOT,
                              blend_root=BLEND_ROOT if blends else None)
        done.append(meta)
        print("rendered %s: %d frames x %d variants" %
              (spec["id"], meta["frames"], meta["variants"]))
    return done


def blends(only=None):
    """Regenerate the inspectable .blend files without re-rendering."""
    scene = bpy.context.scene
    out = []
    for spec in MANIFEST:
        if only and spec["id"] not in only:
            continue
        out += kit.blend_only(scene, spec, spec["build"], BLEND_ROOT)
    return out


if __name__ == "__main__":
    main(globals().get("ONLY"))
