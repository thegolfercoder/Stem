"""Render one showcase shot from a generated .blend. Run by make_showcase.py:

    blender -b ground_radar_unit.blend -P render_showcase.py -- SHOT OUT_DIR [--preview]

Every object is the CAD geometry from the .blend (itself generated from the
OpenSCAD). This script adds only lighting, a studio floor, camera moves,
assembly timing, and for the placement shot a turf plane, a ball on a tee
and an illustrative radar beam. Nothing here depicts a measurement.

Shots: ground_hero, ground_assembly, ground_in_use, pod_hero, pod_assembly, pod_mount.
"""

from __future__ import annotations

import math
import sys

import bpy
from mathutils import Vector

FPS = 24
# Shots are timed in 30 fps frames and rendered at 24 fps: Blender's time
# remapping plays the same motion in 20% fewer frames, which on a CPU-only
# machine is 20% less render time for the same duration.
TIMED_FPS = 30

# Ground-unit geometry, from script_ground_radar.scad (win_cx, win_zb, win_size,
# win_tilt) and launchmon-py config/hardware.yaml (range_from_tee_m,
# azimuth/elevation beamwidth). Used only to place the placement-shot props.
WIN_CX, WIN_ZB, WIN_SIZE, WIN_TILT = 76.1, 33.0, 25.4, 15.0
DOCK_T = 2.4              # the dock base is under the unit: its underside is the floor
RANGE_FROM_TEE = 1400.0
BEAM_AZ_DEG, BEAM_EL_DEG = 80.0, 40.0


def args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :]


# ---------------------------------------------------------------------------
#  Scene helpers
# ---------------------------------------------------------------------------
def objects_in(col_name: str) -> list[bpy.types.Object]:
    col = bpy.data.collections.get(col_name)
    return list(col.objects) if col else []


def product_objects() -> list[bpy.types.Object]:
    phone = [o for o in objects_in("Reference") if o.name.startswith("Phone")]
    return objects_in("Printed parts") + objects_in("Components (stand-ins)") + phone


def matte_black_finish() -> None:
    """Every printed part in solid matte black. The light grey studio keeps the
    silhouettes readable; the boards inside keep their colours."""
    mat = bpy.data.materials.new("Matte black")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.018, 0.018, 0.02, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    for key in ("Specular IOR Level", "Specular"):   # 4.x / 3.x name
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.3
    mat.diffuse_color = (0.018, 0.018, 0.02, 1)
    for o in objects_in("Printed parts"):
        if o.name.startswith(("Radome", "Light pipe")):   # smoked and natural PETG keep theirs
            continue
        o.data.materials.clear()
        o.data.materials.append(mat)


def hide_reference(keep: tuple[str, ...] = ("Phone",)) -> None:
    """Hide reference geometry, except the stand-in phone on the MagSafe mount."""
    for o in objects_in("Reference"):
        set_visible(o, o.name.startswith(keep))


def set_visible(obj: bpy.types.Object, visible: bool) -> None:
    obj.hide_render = not visible
    obj.hide_viewport = not visible


def bounds(objs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def material(name: str, rgba, roughness=0.5, emission=None, alpha=1.0, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 1.5
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
        mat.shadow_method = "NONE"
        mat.show_transparent_back = True
    return mat


def studio(floor_z: float, size: float, dark: bool = False) -> None:
    """Seamless floor, soft three-light setup, neutral world."""
    for o in objects_in("Stage"):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o, do_unlink=True)
    world = bpy.context.scene.world
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.09, 0.10, 0.12, 1) if dark else (0.62, 0.64, 0.67, 1)
    bg.inputs["Strength"].default_value = 1.0

    bpy.ops.mesh.primitive_plane_add(size=max(size * 400, 20000), location=(0, 0, floor_z))
    floor = bpy.context.object
    floor.name = "Studio floor"
    floor.data.materials.append(material("Floor", (0.09, 0.10, 0.12, 1) if dark else (0.52, 0.53, 0.55, 1),
                                         roughness=0.3 if dark else 0.7))

    # Sun lights: the scene is in millimetres, and area or point lights would
    # fall off as if it were metres. A sun has no falloff, so the same rig
    # lights a 30 mm pod and a 1.4 m placement shot alike.
    def sun(name, direction, strength, angle_deg, color=(1, 1, 1)):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = strength
        light.angle = math.radians(angle_deg)
        light.color = color
        ob = bpy.data.objects.new(name, light)
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = (-Vector(direction)).normalized().to_track_quat("-Z", "Y")
        bpy.context.scene.collection.objects.link(ob)
        return ob

    sun("Key", (-0.9, 0.8, -1.1), 4.0, 12)
    sun("Fill", (1.0, 0.5, -0.5), 1.2, 30, (0.85, 0.9, 1.0))
    sun("Rim", (0.3, -1.0, -0.7), 3.0, 8, (1.0, 0.95, 0.9))


_target = None


def target_empty() -> bpy.types.Object:
    global _target
    if _target is None:
        _target = bpy.data.objects.new("Look target", None)
        bpy.context.scene.collection.objects.link(_target)
    return _target


def camera(lens: float = 70.0) -> bpy.types.Object:
    cam = bpy.data.objects.get("Camera")
    cam.constraints.clear()
    cam.animation_data_clear()
    cam.parent = None
    cam.data.lens = lens
    cam.data.dof.use_dof = True
    cam.data.dof.focus_object = target_empty()
    cam.data.dof.aperture_fstop = 8.0
    con = cam.constraints.new("TRACK_TO")
    con.target = target_empty()
    con.track_axis, con.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    bpy.context.scene.camera = cam
    return cam


def fit_distance(radius: float, lens: float, margin: float = 1.25) -> float:
    vfov = 2 * math.atan(36.0 * 9 / 16 / 2 / lens)
    return radius * margin / math.tan(vfov / 2)


def key_loc(obj, frame, loc):
    obj.location = loc
    obj.keyframe_insert("location", frame=frame)


def linear(obj):
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


def orbit(cam, centre: Vector, dist: float, elev_deg: float, az0: float, az1: float, frames: int, rise: float = 0.0):
    """Camera on a circle around centre, from azimuth az0 to az1 (degrees)."""
    target_empty().location = centre
    rig = bpy.data.objects.new("Orbit rig", None)
    rig.location = centre
    bpy.context.scene.collection.objects.link(rig)
    cam.parent = rig
    e = math.radians(elev_deg)
    cam.location = (0, -dist * math.cos(e), dist * math.sin(e))
    if rise:
        key_loc(cam, 1, (0, -dist * math.cos(e), dist * math.sin(e) - rise / 2))
        key_loc(cam, frames, (0, -dist * math.cos(e), dist * math.sin(e) + rise / 2))
    rig.rotation_euler = (0, 0, math.radians(az0))
    rig.keyframe_insert("rotation_euler", frame=1)
    rig.rotation_euler = (0, 0, math.radians(az1))
    rig.keyframe_insert("rotation_euler", frame=frames)
    linear(rig)


def assembled_and_exploded(objs) -> dict:
    """Read each object's assembled (frame 1) and exploded (frame 60) location."""
    scene = bpy.context.scene
    out = {}
    for o in objs:
        scene.frame_set(1)
        a = o.location.copy()
        scene.frame_set(60)
        b = o.location.copy()
        out[o.name] = (a, b)
        o.animation_data_clear()
        o.location = a
    scene.frame_set(1)
    return out


def assemble(objs, order: list[list[str]], start: int, step: int, travel: int, extra=None):
    """Hold exploded, then fly parts home group by group (names are prefixes)."""
    pos = assembled_and_exploded(objs)
    for gi, group in enumerate(order):
        f0 = start + gi * step
        for o in objs:
            if any(o.name.startswith(p) for p in group):
                a, b = pos[o.name]
                if extra:
                    b = b + Vector(extra)
                key_loc(o, 1, b)
                key_loc(o, f0, b)
                key_loc(o, f0 + travel, a)


# ---------------------------------------------------------------------------
#  Shots
# ---------------------------------------------------------------------------
def shot_ground_hero():
    # The product alone: unit and dock. The phone appears in the placement shot.
    hide_reference(keep=())
    objs = [o for o in product_objects() if not o.name.startswith("Phone")]
    assembled_and_exploded(objs)   # drop the .blend's explode animation: assembled throughout
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z, r)
    cam = camera(70)
    orbit(cam, c + Vector((0, 0, -6)), fit_distance(r, 70, 0.95), 14, -35, 250, 180, rise=r * 0.4)
    return 180


def shot_ground_assembly():
    hide_reference(keep=())   # no phone in this shot: it would hide the inside
    objs = [o for o in product_objects() if not o.name.startswith("Phone")]
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z, r)
    order = [["LiPo"], ["TP4056"], ["BGT24LTR11"], ["LM358"], ["ESP32-C3"], ["ESP32 clamp"],
             ["Slide switch", "Light pipe", "Status LED"], ["Lid", "MT3608"], ["Radome"], ["Dock stem", "MagSafe magnet ring"]]
    assemble(objs, order, start=20, step=14, travel=40, extra=(0, 30, 0))
    for o in objs:   # the dock base stays put in this shot
        if o.name.startswith("Dock base"):
            o.animation_data_clear()
            o.location = (0, 0, 0)
    cam = camera(60)
    # From behind and above, where the parts come in, swinging round to the front.
    orbit(cam, c + Vector((0, 12, -4)), fit_distance(r * 1.3, 60, 1.0), 24, 205, 150, 210)
    return 210


def shot_ground_in_use():
    objs = product_objects()
    assembled_and_exploded(objs)   # drop the .blend's explode animation: assembled throughout
    hide_reference()
    floor_z = -DOCK_T
    studio(floor_z, 300, dark=False)
    floor = bpy.data.objects["Studio floor"]
    floor.data.materials[0] = material("Turf", (0.06, 0.20, 0.06, 1), roughness=0.95)
    bpy.context.scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)

    # Ball on a tee, on the target line, range_from_tee_m in front of the window.
    tee_h = 18.0
    bpy.ops.mesh.primitive_cylinder_add(radius=2.2, depth=tee_h, location=(WIN_CX, -RANGE_FROM_TEE, floor_z + tee_h / 2))
    bpy.context.object.data.materials.append(material("Tee", (0.9, 0.9, 0.9, 1), 0.4))
    ball_z = floor_z + tee_h + 21.34
    bpy.ops.mesh.primitive_uv_sphere_add(radius=21.34, segments=64, ring_count=32,
                                         location=(WIN_CX, -RANGE_FROM_TEE, ball_z))
    ball = bpy.context.object
    bpy.ops.object.shade_smooth()
    ball.data.materials.append(material("Ball", (0.95, 0.95, 0.95, 1), 0.3))

    # Illustrative beam: a faint cone along the 15-degree boresight with the
    # beamwidths from hardware.yaml. Its edge is drawn hard; a real beam is not.
    t = math.radians(WIN_TILT)
    start = Vector((WIN_CX, (WIN_SIZE / 2) * math.sin(t), WIN_ZB + (WIN_SIZE / 2) * math.cos(t)))
    direction = Vector((0, -math.cos(t), math.sin(t)))
    length = RANGE_FROM_TEE * 1.25
    bpy.ops.mesh.primitive_cone_add(vertices=96, radius1=length * math.tan(math.radians(BEAM_AZ_DEG / 2)),
                                    radius2=1.0, depth=length, end_fill_type="NOTHING")
    beam = bpy.context.object
    beam.name = "Radar beam (illustrative)"
    beam.scale = (1.0, math.tan(math.radians(BEAM_EL_DEG / 2)) / math.tan(math.radians(BEAM_AZ_DEG / 2)), 1.0)
    # Cone apex is +Z; aim local -Z (the wide end) along the boresight.
    beam.rotation_mode = "QUATERNION"
    beam.rotation_quaternion = (-direction).to_track_quat("Z", "Y")
    beam.location = start + direction * (length / 2)
    beam.data.materials.append(material("Beam", (1.0, 0.6, 0.2, 1), 0.5, emission=(1.0, 0.5, 0.1, 1), alpha=0.025))
    # Boresight: a thin bright line along the 15-degree axis, to just past the ball.
    bpy.ops.mesh.primitive_cylinder_add(radius=2.0, depth=length, vertices=16)
    axis = bpy.context.object
    axis.name = "Boresight (15 deg up)"
    axis.rotation_mode = "QUATERNION"
    axis.rotation_quaternion = direction.to_track_quat("Z", "Y")
    axis.location = start + direction * (length / 2)
    axis.data.materials.append(material("Boresight", (1.0, 0.5, 0.1, 1), 0.5, emission=(1.0, 0.45, 0.05, 1), alpha=0.8))
    # The cone appears once the camera has pulled back, so the close-up of the
    # window is not seen through it.
    for f, hidden in ((1, True), (75, True), (76, False)):
        beam.hide_render = hidden
        beam.keyframe_insert("hide_render", frame=f)

    cam = camera(35)
    tgt = target_empty()
    window = start
    mid = Vector((WIN_CX, -RANGE_FROM_TEE * 0.5, floor_z + 120))
    # Close on the window, then pull back and up to show the unit, beam and ball.
    key_loc(cam, 1, window + Vector((120, -130, 30)))
    key_loc(cam, 50, window + Vector((160, -175, 45)))
    key_loc(cam, 210, Vector((WIN_CX + 1700, -250, 720)))
    key_loc(tgt, 1, window)
    key_loc(tgt, 50, window)
    key_loc(tgt, 210, mid)
    cam.data.dof.aperture_fstop = 16.0
    cam.data.clip_end = 100000
    return 210


def shot_pod_hero():
    objs = product_objects()
    assembled_and_exploded(objs)   # drop the .blend's explode animation: assembled throughout
    for o in objects_in("Reference"):
        set_visible(o, o.name.startswith("Golf shaft"))
    lo, hi = bounds([o for o in objs])
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z - 30, r)
    shaft = next(o for o in objects_in("Reference") if o.name.startswith("Golf shaft"))
    shaft.scale = (1, 1, 3.0)   # a longer piece of shaft, so its ends stay out of frame
    cam = camera(85)
    orbit(cam, c, fit_distance(r, 85, 1.2), 20, 30, 330, 180, rise=r * 0.5)
    return 180


def shot_pod_assembly():
    objs = product_objects()
    for o in objects_in("Reference"):
        set_visible(o, o.name.startswith("Golf shaft"))
    shaft = next(o for o in objects_in("Reference") if o.name.startswith("Golf shaft"))
    shaft.scale = (1, 1, 3.0)
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z - 30, r)
    order = [["LSM6DS3TR-C"], ["LiPo", "Micro charger"], ["ESP32-C3"], ["Pod lid"]]
    assemble(objs, order, start=20, step=22, travel=40, extra=(0, 0, 18))
    cam = camera(70)
    orbit(cam, c + Vector((0, 0, 14)), fit_distance(r * 1.9, 70, 1.0), 34, 25, 60, 180)
    return 180


def shot_pod_mount():
    objs = product_objects()
    for o in objects_in("Reference"):
        set_visible(o, o.name.startswith("Golf shaft"))
    shaft = next(o for o in objects_in("Reference") if o.name.startswith("Golf shaft"))
    shaft.scale = (1, 1, 3.0)
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z - 30, r)
    assembled_and_exploded(objs)   # flatten to assembled
    # The C-clamp's mouth faces down: the pod is pushed down onto the shaft.
    for o in objs:
        a = o.location.copy()
        key_loc(o, 1, a + Vector((0, 0, 30)))
        key_loc(o, 40, a + Vector((0, 0, 30)))
        key_loc(o, 85, a)
    cam = camera(70)
    # Looking along the shaft, slightly off-axis, so the C closing round it shows.
    orbit(cam, c + Vector((0, 0, 12)), fit_distance(r * 1.9, 70, 1.0), 20, -70, -50, 150)
    return 150


SHOTS = {f.__name__[5:]: f for f in [shot_ground_hero, shot_ground_assembly, shot_ground_in_use,
                                     shot_pod_hero, shot_pod_assembly, shot_pod_mount]}


def opt(name: str, default: str) -> str:
    for a in args():
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    return default


def configure_render(frames: int, out_dir: str, preview: bool) -> None:
    """EEVEE settings. Defaults are tuned for a CPU-only machine (software
    OpenGL); --samples, --ssr=1 and --shadow=2048 raise quality on a GPU."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    ee.taa_render_samples = 8 if preview else int(opt("samples", "16"))
    ee.use_gtao = True
    ee.gtao_distance = 4.0
    ee.use_soft_shadows = opt("soft", "1") == "1"
    ee.use_ssr = opt("ssr", "0") == "1"
    ee.shadow_cube_size = opt("shadow", "1024")
    ee.shadow_cascade_size = opt("shadow", "1024")
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.render.fps = FPS
    scene.render.frame_map_old, scene.render.frame_map_new = TIMED_FPS, FPS
    scene.frame_start, scene.frame_end = 1, round(frames * FPS / TIMED_FPS)
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.resolution_percentage = 50 if preview else 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.use_overwrite = False   # resume: frames already rendered are skipped
    scene.render.filepath = out_dir.rstrip("/") + "/f_"


def main() -> None:
    a = args()
    shot, out_dir, preview = a[0], a[1], "--preview" in a
    matte_black_finish()
    frames = SHOTS[shot]()
    configure_render(frames, out_dir, preview)
    if preview:   # three stills: start, middle, end
        scene = bpy.context.scene
        for f in (1, round(frames * FPS / TIMED_FPS) // 2, round(frames * FPS / TIMED_FPS)):
            scene.frame_set(f)
            scene.render.filepath = f"{out_dir.rstrip('/')}/still_{f:04d}.png"
            bpy.ops.render.render(write_still=True)
    else:
        rng = opt("frames", "")
        if rng:   # render a sub-range, e.g. --frames=90:92 for timing tests
            a0, a1 = (int(x) for x in rng.split(":"))
            bpy.context.scene.frame_start, bpy.context.scene.frame_end = a0, a1
        bpy.ops.render.render(animation=True)


main()
