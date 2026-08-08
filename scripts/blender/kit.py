"""
Shared Blender kit for baking the park's sprites.

Everything specific to one attraction lives in attractions.py; this file is the
part that must stay identical across all of them, because it's what guarantees
every sprite lands on the same isometric grid.

--------------------------------------------------------------------------
THE PROJECTION (do not adjust by eye)
--------------------------------------------------------------------------
The game is 2:1 dimetric -- TILE_W 64 x TILE_H 32 (client/src/render/camera.ts).
An orthographic camera at rotation X 60deg / Z 45deg squashes the ground plane
by sin(30deg) = 0.5, i.e. exactly 2:1. Models are authored in tile units: one
Blender unit == one map tile, so an NxN attraction is an NxN unit block centred
on the origin.

Verified, not assumed: rendering a bare 1x1 plane measures 63.5 x 32 px centred
on the frame centre (the half-pixel is antialiased-edge thresholding).

Two things that break the calibration silently if touched:

  * sensor_fit MUST be 'HORIZONTAL'. With the default AUTO, ortho_scale maps to
    the LARGER frame dimension -- so a taller frame (which most attractions
    need, for towers and canopies) would rescale the tile with no error.
  * ortho_scale is DERIVED from sprite width, never chosen. 64 px == sqrt(2)
    units (a tile's diagonal), so ortho_scale = (sprite_w / 64) * sqrt(2).
    This holds for any footprint: a 2x2 ride just needs a wider frame.

Because the camera always aims at the world origin and models are centred
there, the blit anchor is always the sprite centre. main.ts passes
blockCenter() for multi-tile structures, which is the same point.

Derived scale factors, so geometry can be authored in the same pixel units the
hand-drawn vector art used:

    45.2548 px per unit horizontally   (= 64 / sqrt(2))
    39.1918 px per unit vertically     (= horizontal * cos 30deg)
"""

import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

SS = 4                      # supersample; the packer steps down to 2x
PXH = 45.2548               # px per world unit, horizontal
PXV = 39.1918               # px per world unit, vertical (Z)


def uh(px):
    """Horizontal pixels -> world units."""
    return px / PXH


def uv(px):
    """Vertical pixels -> world units."""
    return px / PXV


# ------------------------------------------------------------------ scene

def clear():
    """Wipe the scene via the data API.

    Not bpy.ops: operators need a UI context that neither `blender
    --background` nor the MCP bridge reliably provides, and they fail with
    'context is incorrect' rather than doing nothing.
    """
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights,
                bpy.data.materials, bpy.data.node_groups):
        for b in list(blk):
            if b.users == 0:
                blk.remove(b)


def setup(scene, sprite_w, sprite_h):
    """Camera + render settings for one attraction's frame size."""
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'           # see module docstring
    cam_data.ortho_scale = (sprite_w / 64.0) * math.sqrt(2.0)
    cam = bpy.data.objects.new("IsoCam", cam_data)
    scene.collection.objects.link(cam)

    d = 40.0                                      # ortho: distance only affects clipping
    el, az = math.radians(60.0), math.radians(45.0)
    cam.location = (d * math.sin(el) * math.sin(az),
                    -d * math.sin(el) * math.cos(az),
                    d * math.cos(el))
    cam.rotation_euler = (el, 0.0, az)
    cam_data.clip_start = 1.0
    cam_data.clip_end = 200.0
    scene.camera = cam

    scene.render.resolution_x = sprite_w * SS
    scene.render.resolution_y = sprite_h * SS
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True          # sprites composite over the map
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    return cam


def setup_light(scene):
    """Key from upper-left-front plus a fill, matching where the vector art
    put its highlights (top-left lit, bottom-right shaded)."""
    key_d = bpy.data.lights.new("Key", 'SUN')
    key_d.energy = 3.4
    key_d.angle = math.radians(14)
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
    # Near-neutral. A saturated ambient tints white surfaces (the carousel's
    # canopy stripes went grey on the first attempt).
    bg.inputs[0].default_value = (0.78, 0.80, 0.84, 1.0)
    bg.inputs[1].default_value = 0.85


# --------------------------------------------------------------- materials

def mat(name, hexcol, rough=0.55, metal=0.0, emit=0.0, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    h = hexcol.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    # sRGB -> linear. Skipping this drifts every colour away from the CSS hex
    # the vector art used, and the park stops matching itself.
    lin = [(c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4) for c in srgb]
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        if "Emission Color" in b.inputs:
            b.inputs["Emission Color"].default_value = (*lin, 1.0)
            b.inputs["Emission Strength"].default_value = emit
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = 'BLEND'
    return m


# -------------------------------------------------------------- primitives
# All of these append into a caller-owned bmesh, so one object can be built
# from many pieces and still be a single mesh (fewer objects = faster renders
# across ~20 attractions x N frames).

def _append(bm, tmp):
    me = bpy.data.meshes.new("_tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def box(bm, sx, sy, sz, at=(0, 0, 0), rot_z=0.0):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector((sx, sy, sz)), verts=tmp.verts)
    if rot_z:
        bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(rot_z, 3, 'Z'))
    bmesh.ops.translate(tmp, vec=Vector(at), verts=tmp.verts)
    _append(bm, tmp)


def cyl(bm, r, depth, at=(0, 0, 0), segments=20, r2=None):
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=(r if r2 is None else r2), depth=depth,
                          matrix=Matrix.Translation(at))
    _append(bm, tmp)


def cone(bm, r, depth, at=(0, 0, 0), segments=16):
    cyl(bm, r, depth, at, segments=segments, r2=0.0)


def sphere(bm, r, at=(0, 0, 0), scale=(1, 1, 1), segments=12):
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=segments,
                              v_segments=max(4, segments // 2), radius=r)
    bmesh.ops.scale(tmp, vec=Vector(scale), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(at), verts=tmp.verts)
    _append(bm, tmp)


def tube(bm, p0, p1, r, segments=8):
    """Cylinder between two arbitrary points -- coaster track, poles, rails."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    if length < 1e-6:
        return
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r, depth=length)
    quat = d.normalized().to_track_quat('Z', 'Y')
    bmesh.ops.transform(tmp, matrix=quat.to_matrix().to_4x4(), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=(p0 + p1) / 2.0, verts=tmp.verts)
    _append(bm, tmp)


def obj(name, bm, mats, parent=None, loc=(0, 0, 0), rot_z=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    if parent:
        o.parent = parent
    return o


def empty(name):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(e)
    return e


def deck(bm, tiles, lift_px=4.0, inset=0.98):
    """The raised pad every ride sits on -- the 3D equivalent of
    drawIsoDeck(). Sized to the real NxN footprint so structures occupy
    their block instead of floating on it."""
    half = (tiles * inset) / 2.0
    L = uv(lift_px)
    box(bm, half * 2, half * 2, L, (0, 0, L / 2))
    return L


def pad_fence(bm, tiles, h_px=7.0, inset=0.98, posts_per_side=4):
    """Perimeter posts + rail, as drawPadFence() -- reads as 'this whole
    block is the ride'."""
    half = (tiles * inset) / 2.0
    h = uv(h_px)
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        for s in range(posts_per_side + 1):
            t = s / posts_per_side
            x = a[0] + (b[0] - a[0]) * t
            y = a[1] + (b[1] - a[1]) * t
            cyl(bm, uh(0.9), h, (x, y, h / 2), segments=6)
        # top rail
        tube(bm, (a[0], a[1], h), (b[0], b[1], h), uh(0.6), segments=5)


# ------------------------------------------------------------------ render

def wants_blend(spec, variant):
    """Whether this variant is worth keeping an inspectable .blend for.

    Variants are only worth a file each when they are genuinely different
    models -- three tree species, a bench with and without a guest. Above a
    handful they are the same model with a parameter changed (the guest's 28
    rows are 7 shirt colours x 4 facings), and 28 near-identical .blends is
    noise in the repo rather than something anyone will open. Keep the first.
    """
    return variant == 0 or spec.get("variants", 1) <= 4


def save_blend(spec, variant, blend_root):
    """Write the built scene to a .blend so it can be opened and inspected.

    The .py remains the source of truth -- these are saved *from* it, and are
    regenerated wholesale by `blend_only()`. Edit the script, not the .blend,
    or the next render silently discards your changes. They're kept because
    reading geometry as code is a poor way to judge a model: open the .blend,
    orbit it, then go change the numbers in attractions.py.
    """
    os.makedirs(blend_root, exist_ok=True)
    name = spec["id"] if variant == 0 else "%s_v%d" % (spec["id"], variant)
    path = os.path.join(blend_root, name + ".blend")
    # Blender keeps a .blend1 backup of the previous save by default. These
    # files are regenerated from the .py wholesale, so a backup of the last
    # regeneration is pure noise in the repo.
    try:
        bpy.context.preferences.filepaths.save_version = 0
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)
    return path


def blend_only(scene, spec, build_fn, blend_root):
    """Build every variant and save the .blend files, skipping the render.

    Rendering ~20 attractions x N frames takes minutes; regenerating the
    inspectable .blend files should not.
    """
    paths = []
    for v in range(spec.get("variants", 1)):
        clear()
        setup(scene, spec["w"], spec["h"])
        setup_light(scene)
        driver = build_fn(v)
        if not wants_blend(spec, v):
            continue
        if callable(driver):
            driver(0, spec.get("frames", 1))     # settle on the canonical pose
        paths.append(save_blend(spec, v, blend_root))
    return paths


def render_all(scene, spec, build_fn, out_root, blend_root=None):
    """Render frames x variants for one attraction.

    build_fn(variant) constructs the model and returns either None (fully
    static) or an object/empty whose Z rotation is driven per frame. Anything
    needing richer per-frame motion returns a callable instead, invoked as
    fn(frame_index, total_frames).
    """
    out = os.path.join(out_root, spec["id"])
    os.makedirs(out, exist_ok=True)
    frames = spec.get("frames", 1)
    variants = spec.get("variants", 1)

    for v in range(variants):
        clear()
        setup(scene, spec["w"], spec["h"])
        setup_light(scene)
        driver = build_fn(v)
        if blend_root and wants_blend(spec, v):
            if callable(driver):
                driver(0, frames)
            save_blend(spec, v, blend_root)
        for f in range(frames):
            if callable(driver):
                driver(f, frames)
            elif driver is not None:
                driver.rotation_euler = (0, 0, f * (2 * math.pi / frames))
            scene.render.filepath = os.path.join(out, "v%d_f%02d.png" % (v, f))
            bpy.ops.render.render(write_still=True)

    meta = {
        "id": spec["id"],
        "frames": frames,
        "variants": variants,
        "sprite": [spec["w"], spec["h"]],
        "tiles": spec.get("tiles", 1),
        "supersample": SS,
    }
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    return meta
