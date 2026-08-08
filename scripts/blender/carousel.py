"""
Carousel sprite source -- Blender -> pre-rendered isometric sprite strip.

This is the *source of truth* for client/public/sprites/carousel.png. That PNG
is a build artifact; if you need to change how the carousel looks, change this
file and re-render. Do not hand-edit the PNG.

Run it:

    blender --background --python scripts/blender/carousel.py

or paste it into Blender's scripting tab. It clears the scene, builds the
model, and writes 16 frames to scripts/blender/out/carousel/. Then:

    node scripts/blender/pack-strip.mjs

assembles those frames into the strip the game actually loads.

--------------------------------------------------------------------------
WHY THE CAMERA IS SET UP THE WAY IT IS
--------------------------------------------------------------------------
The game is 2:1 dimetric -- TILE_W 64 x TILE_H 32 (client/src/render/camera.ts).
An orthographic camera at rotation X 60deg / Z 45deg gives a ground-plane
squash of sin(30deg) = 0.5, i.e. exactly 2:1, so a 1x1 Blender unit tile lands
exactly on the game's 64x32 diamond. Verified by rendering a bare 1x1 plane and
measuring it: 63.5 x 32 px, centred on the frame centre (the half-pixel is
antialiased-edge thresholding, not a projection error).

Two things that will silently break the calibration if you touch them:

  * `sensor_fit = 'HORIZONTAL'`. With the default AUTO, Blender maps
    ortho_scale to the LARGER frame dimension -- so making the frame taller
    (which we do, for the canopy) would rescale the tile without warning.
  * `ortho_scale`. It is derived from SPRITE_W, not chosen by eye.

Derived scale factors, used to author everything below in the same pixel units
the hand-drawn vector version used (client/src/render/sprites/rides.ts):

    45.2548 px per world unit horizontally  (SPRITE_W / ortho_scale)
    39.1918 px per world unit vertically    (= horizontal * cos 30deg)
"""

import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- constants

SS = 4                      # supersample factor; downsampled at pack time
SPRITE_W, SPRITE_H = 96, 128
FRAMES = 16                 # one full revolution, must divide 360 evenly

# The anchor: tile centre sits at the frame centre, so the game blits at
# (cx - SPRITE_W/2, cy - SPRITE_H/2). Falls out of the camera aiming at the
# world origin -- don't "fix" it with an offset.
ANCHOR = (SPRITE_W / 2, SPRITE_H / 2)

PXH = 45.2548               # px per world unit, horizontal
PXV = 39.1918               # px per world unit, vertical (Z)

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
OUT_DIR = os.path.join(HERE, "out", "carousel")

# Palette lifted verbatim from the vector drawCarousel() it replaces, so the
# swap doesn't shift the park's colour language.
C_DECK_TOP, C_DECK_SIDE = "#b45309", "#7c2d12"
C_PLAT, C_PLAT_RIM, C_SPOKE = "#fbbf24", "#92400e", "#fef3c7"
C_COLUMN = "#78350f"
C_CANOPY_A, C_CANOPY_B, C_VALANCE = "#ef4444", "#ffffff", "#dc2626"
C_POLE = "#e5e7eb"
C_SADDLE, C_SKIN = "#7f1d1d", "#fcd9b6"
C_HORSE = ["#f472b6", "#60a5fa", "#facc15", "#4ade80", "#c084fc", "#fb923c"]


def uh(px):
    """Horizontal pixels -> world units."""
    return px / PXH


def uv(px):
    """Vertical pixels -> world units."""
    return px / PXV


# ---------------------------------------------------------------- helpers

def mat(name, hexcol, rough=0.55, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    h = hexcol.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    # sRGB -> linear. Without this the rendered colour drifts noticeably from
    # the CSS hex the vector art used, and the park stops matching itself.
    lin = [(c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4) for c in srgb]
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def mkobj(name, bm, mats, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def cyl(bm, r, depth, at, segments=24):
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r, depth=depth,
                          matrix=Matrix.Translation(at))


def box(bm, sx, sy, sz, at):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector((sx, sy, sz)), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(at), verts=tmp.verts)
    me = bpy.data.meshes.new("_tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def sphere(bm, r, at, scale=(1, 1, 1), segments=12):
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=segments, v_segments=segments // 2,
                              radius=r)
    bmesh.ops.scale(tmp, vec=Vector(scale), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(at), verts=tmp.verts)
    me = bpy.data.meshes.new("_tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


# ---------------------------------------------------------------- scene

def clear():
    # The data API, not bpy.ops -- operators need a UI context that a
    # --background run (and the MCP bridge) does not provide.
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for b in list(blk):
            if b.users == 0:
                blk.remove(b)


def setup_camera(scene):
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'          # see module docstring
    cam_data.ortho_scale = (SPRITE_W / 64.0) * math.sqrt(2.0)
    cam = bpy.data.objects.new("IsoCam", cam_data)
    scene.collection.objects.link(cam)

    d = 12.0
    el, az = math.radians(60.0), math.radians(45.0)
    cam.location = (d * math.sin(el) * math.sin(az),
                    -d * math.sin(el) * math.cos(az),
                    d * math.cos(el))
    cam.rotation_euler = (el, 0.0, az)
    scene.camera = cam

    scene.render.resolution_x = SPRITE_W * SS
    scene.render.resolution_y = SPRITE_H * SS
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True        # sprites composite over the map
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    return cam


def setup_light(scene):
    key_d = bpy.data.lights.new("Key", 'SUN')
    key_d.energy = 3.4
    key_d.angle = math.radians(14)              # soft-ish contact shadows
    key = bpy.data.objects.new("Key", key_d)
    scene.collection.objects.link(key)
    key.rotation_euler = (math.radians(52), 0, math.radians(-40))

    fill_d = bpy.data.lights.new("Fill", 'SUN')
    fill_d.energy = 1.3
    fill = bpy.data.objects.new("Fill", fill_d)
    scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(68), 0, math.radians(150))

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Near-neutral, only faintly cool. A saturated ambient tints the canopy's
    # white stripes grey, which is what the first test render did.
    bg.inputs[0].default_value = (0.78, 0.80, 0.84, 1.0)
    bg.inputs[1].default_value = 0.85


def build(scene):
    """Returns the spinner empty -- everything that rotates hangs off it."""
    lift = uv(4)
    half = 0.49                                  # 0.98 of the tile, as drawIsoDeck

    # ---- Deck: the raised, fenced pad the vector version draws first ----
    bm = bmesh.new()
    box(bm, half * 2, half * 2, lift, (0, 0, lift / 2))
    deck = mkobj("Deck", bm, [mat("deck_top", C_DECK_TOP, 0.7),
                              mat("deck_side", C_DECK_SIDE, 0.8)])
    for p in deck.data.polygons:
        p.material_index = 0 if p.normal.z > 0.5 else 1

    # ---- Static column ----
    col_z = lift + uv(3)
    col_h = uv(36)
    bm = bmesh.new()
    cyl(bm, uh(3), col_h, (0, 0, col_z + col_h / 2), segments=12)
    mkobj("Column", bm, [mat("col", C_COLUMN, 0.6)])

    # ---- Spinner: platform + spokes + poles + horses ----
    spin = bpy.data.objects.new("Spinner", None)   # empty
    spin.empty_display_size = 0.2
    scene.collection.objects.link(spin)

    bm = bmesh.new()
    cyl(bm, 0.515, uv(3), (0, 0, lift - uv(0.5)), segments=32)
    mkobj("PlatformRim", bm, [mat("plat_rim", C_PLAT_RIM, 0.7)], parent=spin)

    bm = bmesh.new()
    cyl(bm, 0.5, uv(3), (0, 0, lift + uv(1.5)), segments=32)
    mkobj("Platform", bm, [mat("plat", C_PLAT, 0.45)], parent=spin)

    # Sunburst spokes -- the thing that makes the rotation legible at all.
    # Without them a smooth disc looks static no matter how fast it spins.
    bm = bmesh.new()
    spoke_z = lift + uv(3) + uv(0.4)
    for i in range(10):
        a = i * math.pi / 5
        tmp = bmesh.new()
        box(tmp, 0.46, uh(1.2), uv(0.8), (0.23, 0, 0))
        bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(a, 3, 'Z'))
        bmesh.ops.translate(tmp, verts=tmp.verts, vec=Vector((0, 0, spoke_z)))
        me = bpy.data.meshes.new("_s")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    mkobj("Spokes", bm, [mat("spoke", C_SPOKE, 0.5)], parent=spin)

    # ---- Horses ----
    # Radius 19px and a 6-horse ring, matching the vector layout. Each horse
    # is authored facing +Y then rotated to sit tangential to the ring.
    R = uh(19)
    horse_z = lift + uv(3)
    canopy_base_z = col_z + col_h * 0.74

    for i in range(6):
        a = i * (2 * math.pi / 6)
        # 3 bob cycles per revolution so the 16-frame strip loops seamlessly.
        # (The vector art used an unrelated frequency, which can't loop.)
        bob = uv(2.5) * math.sin(a * 3.0)
        px, py = math.cos(a) * R, math.sin(a) * R
        bz = horse_z + uv(9) + bob

        bm = bmesh.new()
        sphere(bm, uh(3.4), (0, 0, 0), scale=(0.75, 1.55, 0.85))          # body
        sphere(bm, uh(2.4), (0, uh(3.6), uv(3.4)), scale=(0.8, 0.9, 1.2))  # neck
        sphere(bm, uh(1.9), (0, uh(4.6), uv(6.2)), scale=(0.8, 1.3, 0.8))  # head
        for lx, ly in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
            box(bm, uh(1.3), uh(1.3), uv(6.0),
                (lx * uh(1.5), ly * uh(2.4), -uv(4.2)))                    # legs
        sphere(bm, uh(1.5), (0, -uh(4.4), uv(1.6)), scale=(0.6, 1.2, 0.8))  # tail
        horse = mkobj("Horse%d" % i, bm, [mat("horse%d" % i, C_HORSE[i], 0.45)])
        horse.location = (px, py, bz)
        horse.rotation_euler = (0, 0, a + math.pi / 2)
        horse.parent = spin

        # Saddle + a suggestion of a rider. At 96px this is 2-3 pixels, but
        # it is the difference between "ride" and "ornament".
        bm = bmesh.new()
        box(bm, uh(4.2), uh(5.0), uv(1.6), (0, 0, uv(3.0)))
        sd = mkobj("Saddle%d" % i, bm, [mat("saddle", C_SADDLE, 0.6)])
        sd.location, sd.rotation_euler, sd.parent = (px, py, bz), (0, 0, a + math.pi / 2), spin

        bm = bmesh.new()
        sphere(bm, uh(1.7), (0, 0, uv(7.0)))
        rd = mkobj("Rider%d" % i, bm, [mat("skin", C_SKIN, 0.6)])
        rd.location, rd.rotation_euler, rd.parent = (px, py, bz), (0, 0, a + math.pi / 2), spin

        # Brass pole, platform -> canopy.
        bm = bmesh.new()
        pole_bottom = horse_z
        pole_h = canopy_base_z - pole_bottom
        cyl(bm, uh(0.7), pole_h, (px, py, pole_bottom + pole_h / 2), segments=8)
        mkobj("Pole%d" % i, bm, [mat("pole", C_POLE, 0.3, metal=0.7)], parent=spin)

    # ---- Canopy (static) ----
    # Radius pulled in from the vector art's 30px to 26px: at a 30deg
    # elevation a real cone shows its underside and swallows the horses,
    # which a flat 2D triangle never did.
    can_h = uv(24)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16,
                          radius1=uh(26), radius2=0.0, depth=can_h,
                          matrix=Matrix.Translation((0, 0, canopy_base_z + can_h / 2)))
    canopy = mkobj("Canopy", bm, [mat("can_a", C_CANOPY_A, 0.5),
                                  mat("can_b", C_CANOPY_B, 0.5)])
    for p in canopy.data.polygons:
        ang = math.atan2(p.center.y, p.center.x)
        idx = int(((ang + math.pi) / (2 * math.pi)) * 16)
        p.material_index = idx % 2

    bm = bmesh.new()
    cyl(bm, uh(26), uv(3.5), (0, 0, canopy_base_z - uv(1.0)), segments=32)
    mkobj("Valance", bm, [mat("valance", C_VALANCE, 0.55)])

    return spin


def render_frames(scene, spin):
    os.makedirs(OUT_DIR, exist_ok=True)
    for f in range(FRAMES):
        spin.rotation_euler = (0, 0, f * (2 * math.pi / FRAMES))
        scene.render.filepath = os.path.join(OUT_DIR, "f%02d.png" % f)
        bpy.ops.render.render(write_still=True)
    return OUT_DIR


def main():
    scene = bpy.context.scene
    clear()
    setup_camera(scene)
    setup_light(scene)
    spin = build(scene)
    out = render_frames(scene, spin)
    meta = {
        "frames": FRAMES,
        "sprite": [SPRITE_W, SPRITE_H],
        "anchor": list(ANCHOR),
        "supersample": SS,
        "out": out,
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(json.dumps(meta))


main()
