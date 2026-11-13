"""Render one showcase shot from a generated .blend. Run by make_showcase.py:

    blender -b ground_radar_unit.blend -P render_showcase.py -- SHOT OUT_DIR [--preview]

Every object is the CAD geometry from the .blend (itself generated from the
OpenSCAD). This script adds only lighting, a studio floor, camera moves,
assembly timing, the arm's motion about its real pivots, a stand-in phone
(script_ground_radar.scad's phone_ghost: a 147.6 x 71.6 x 8.3 mm slab), the
pod (appended from shaft_pod.blend) in the dock's pocket, for the placement
shot a turf plane, a ball on a tee and an illustrative radar beam, and for the
colour shot two copies of the unit that differ only in the radome's material.
Nothing here depicts a measurement.

Shots: ground_hero, ground_assembly, arm_open, ground_in_use, radome_colours
(ground_radar_unit.blend); pod_hero, pod_assembly, pod_mount (shaft_pod.blend).
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

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

# The folding phone arm, from script_ground_radar.scad (echoed with openscad):
# body_w, hinge_y, hinge_z(false), slide_ext, tilt_default, yaw_default,
# head_cz_off, head_t. The slide rises SLIDE_EXT; the swivel turns about the
# vertical axis through [BODY_W/2, HINGE_Y]; the head turns about the X axis
# through [*, HINGE_Y, hinge z]. Folded, the head is at 180 deg about X from
# upright; open it is at -TILT (tilted back) and turned YAW toward the golfer.
BODY_W, HINGE_Y, HINGE_Z_FOLDED = 96.0, 28.9, 66.2
SLIDE_EXT, TILT, YAW = 46.0, 25.0, 20.0
HEAD_CZ_OFF, HEAD_T = 33.0, 4.0
FLIP = 180.0 - TILT        # the head's turn about the hinge, folded to open: 180 -> 335 deg
PHONE_W, PHONE_H, PHONE_T = 71.6, 147.6, 8.3   # phone = [W, H, T]; its back 0.2 mm off the head (phone_ghost)
# The pod's pocket in the dock base (pod_pocket, pod_pocket_y0, pod_wall): the
# pod lies on a side face, its Y axis up, its lid toward the rear.
POCKET_X0, POCKET_X1, POCKET_Y0, POCKET_Y1 = 30.95, 65.05, 33.5, 66.5


def args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :]


# ---------------------------------------------------------------------------
#  Scene helpers
# ---------------------------------------------------------------------------
def objects_in(col_name: str) -> list[bpy.types.Object]:
    col = bpy.data.collections.get(col_name)
    return list(col.objects) if col else []


def product_objects() -> list[bpy.types.Object]:
    return objects_in("Printed parts") + objects_in("Components (stand-ins)")


_matte = None


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
    global _matte
    _matte = mat
    for o in objects_in("Printed parts"):
        paint_matte(o)


def paint_matte(o) -> None:
    if o.name.startswith(("Radome", "Light pipe")):   # smoked and natural PETG keep theirs
        return
    o.data.materials.clear()
    o.data.materials.append(_matte)


def hide_reference(keep: tuple[str, ...] = ()) -> None:
    """Hide reference geometry (the boresight arrow, the IMU axes), except names in keep."""
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

    sun("Key", (-0.9, 0.8, -1.1), 4.0, 12)
    sun("Fill", (1.0, 0.5, -0.5), 1.2, 30, (0.85, 0.9, 1.0))
    sun("Rim", (0.3, -1.0, -0.7), 3.0, 8, (1.0, 0.95, 0.9))


def sun(name, direction, strength, angle_deg, color=(1, 1, 1)):
    """Sun lights: the scene is in millimetres, and area or point lights would
    fall off as if it were metres. A sun has no falloff, so the same rig
    lights a 30 mm pod and a 1.4 m placement shot alike. `direction` is the
    way the light travels."""
    light = bpy.data.lights.new(name, "SUN")
    light.energy = strength
    light.angle = math.radians(angle_deg)
    light.color = color
    ob = bpy.data.objects.new(name, light)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (-Vector(direction)).normalized().to_track_quat("-Z", "Y")
    bpy.context.scene.collection.objects.link(ob)
    return ob


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
#  The folding phone arm, the stand-in phone and the pod in its pocket
# ---------------------------------------------------------------------------
def obj(prefix: str) -> bpy.types.Object:
    return next(o for o in product_objects() if o.name.startswith(prefix))


def empty(name: str, loc, parent=None) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        attach(e, parent)
    bpy.context.view_layer.update()
    return e


def attach(child, parent) -> None:
    """Parent, keeping the child where it is with the parent at rest."""
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


class Arm:
    """The arm's three moving parts on their real pivots. The slide moves on
    `lift`; the swivel turns on `yaw` (vertical axis through the drum), which
    rides on the slide; the head turns on `hinge` (X axis through the
    knuckles), which turns with the swivel. Each object stays in its folded,
    as-exported mesh; only the pivots move."""

    def __init__(self):
        for o in (obj("Phone arm slide"), obj("Phone arm swivel"), obj("Phone arm MagSafe head")):
            o.animation_data_clear()
            o.location = (0, 0, 0)
        self.lift = empty("Arm slide travel", (0, 0, 0))
        self.yaw = empty("Arm swivel axis", (BODY_W / 2, HINGE_Y, 0), self.lift)
        self.hinge = empty("Arm hinge axis", (0, HINGE_Y, HINGE_Z_FOLDED), self.yaw)
        attach(obj("Phone arm slide"), self.lift)
        attach(obj("Phone arm swivel"), self.yaw)
        attach(obj("Phone arm MagSafe head"), self.hinge)
        self.phone = None

    def key(self, frame: int, lift: float | None = None, flip: float | None = None, yaw: float | None = None):
        """lift 0..1 of SLIDE_EXT, flip 0..1 of FLIP, yaw in degrees."""
        if lift is not None:
            self.lift.location = (0, 0, SLIDE_EXT * lift)
            self.lift.keyframe_insert("location", index=2, frame=frame)
        if flip is not None:
            self.hinge.rotation_euler = (math.radians(FLIP * flip), 0, 0)
            self.hinge.keyframe_insert("rotation_euler", index=0, frame=frame)
        if yaw is not None:
            self.yaw.rotation_euler = (0, 0, math.radians(yaw))
            self.yaw.keyframe_insert("rotation_euler", index=2, frame=frame)

    def open_pose(self) -> None:
        self.key(1, 1.0, 1.0, YAW)

    def add_phone(self) -> bpy.types.Object:
        """The stand-in phone (phone_ghost): portrait, its back 0.2 mm off the
        head's phone-side face, centred on the head. Parented to the hinge, in
        the folded frame: rotated 180 deg about the hinge like the head."""
        bpy.ops.mesh.primitive_cube_add(size=1)
        ph = bpy.context.object
        ph.name = "Phone (stand-in)"
        ph.data.transform(Matrix.Diagonal((PHONE_W, PHONE_T, PHONE_H, 1)))
        bev = ph.modifiers.new("Rounded edges", "BEVEL")
        bev.width, bev.segments, bev.limit_method = 2.6, 4, "ANGLE"
        ph.data.materials.append(material("Phone body", (0.045, 0.047, 0.052, 1), 0.3, metallic=0.6))
        # The screen: dark glass on the face away from the head.
        bpy.ops.mesh.primitive_cube_add(size=1)
        scr = bpy.context.object
        scr.name = "Phone screen (stand-in)"
        scr.data.transform(Matrix.Diagonal((PHONE_W - 3.0, 0.3, PHONE_H - 3.0, 1)))
        scr.data.materials.append(material("Phone glass", (0.006, 0.007, 0.009, 1), 0.04))
        scr.parent = ph
        scr.location = (0, PHONE_T / 2 + 0.05, 0)
        bpy.ops.object.select_all(action="DESELECT")
        # Upright pose at the folded hinge, then folded through 180 deg like the head.
        up = Matrix.Translation((BODY_W / 2, HINGE_Y + HEAD_T / 2 + 0.2 + PHONE_T / 2, HINGE_Z_FOLDED + HEAD_CZ_OFF))
        about = Matrix.Translation((0, HINGE_Y, HINGE_Z_FOLDED))
        self.phone_rest = about @ Matrix.Rotation(math.pi, 4, "X") @ about.inverted() @ up
        ph.parent = self.hinge
        ph.matrix_parent_inverse = Matrix.Translation((0, HINGE_Y, HINGE_Z_FOLDED)).inverted()   # the hinge at rest
        ph.matrix_basis = self.phone_rest
        self.phone = ph
        return ph

    def key_phone(self, frame: int, away: float, up: float = 0.0) -> None:
        """Phone `away` mm off the head along its normal and `up` mm along the
        head's long axis, in the head's own frame."""
        self.phone.matrix_basis = self.phone_rest @ Matrix.Translation((0, away, up))
        self.phone.keyframe_insert("location", frame=frame)
        self.phone.keyframe_insert("rotation_euler", frame=frame)


def load_pod() -> list[bpy.types.Object]:
    """Append the pod's parts from shaft_pod.blend and lay them in the dock's
    pocket. Returns the pod's objects, under one empty ("Pod in pocket")."""
    path = os.path.join(os.path.dirname(bpy.data.filepath), "shaft_pod.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c in ("Printed parts", "Components (stand-ins)")]
    pod = []
    for col in dst.collections:
        col.name = "Pod " + col.name.split(".")[0].lower()
        bpy.context.scene.collection.children.link(col)
        for o in col.objects:
            o.animation_data_clear()
            o.location = (0, 0, 0)
            if "print_file" in o:
                paint_matte(o)
            pod.append(o)
    lo, hi = bounds(pod)
    # Lying on a side face: pod (x, y, z) -> (x, z, -y); centred in the pocket, on its floor.
    rot = Matrix.Rotation(math.radians(-90), 4, "X")
    size_x, size_y = hi.x - lo.x, hi.z - lo.z
    t = Vector(((POCKET_X0 + POCKET_X1) / 2 - (lo.x + size_x / 2),
                (POCKET_Y0 + POCKET_Y1) / 2 - (lo.z + size_y / 2),
                hi.y + 0.05))
    holder = empty("Pod in pocket", (0, 0, 0))
    holder.matrix_world = Matrix.Translation(t) @ rot
    bpy.context.view_layer.update()
    for o in pod:
        o.parent = holder
        o.matrix_parent_inverse = Matrix()
    bpy.context.view_layer.update()
    return pod


def back_fill(view: Vector, strength: float = 1.6) -> None:
    """The back is matte black in the key's shadow: a soft fill from over the
    camera's shoulder brings out its edges."""
    sun("Back fill", -(view + Vector((0.3, 0, 0.5))), strength, 25, (0.95, 0.97, 1.0))


# ---------------------------------------------------------------------------
#  Shots
# ---------------------------------------------------------------------------
def shot_ground_hero():
    # The product alone: unit and dock, the arm folded, the pod in its pocket.
    hide_reference()
    objs = product_objects()
    assembled_and_exploded(objs)   # drop the .blend's explode animation: assembled throughout
    objs += load_pod()
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z, r)
    back_fill(Vector((-0.5, 0.8, 0.4)).normalized(), 1.0)
    cam = camera(70)
    orbit(cam, c + Vector((0, 0, -6)), fit_distance(r, 70, 0.95), 14, -35, 250, 180, rise=r * 0.4)
    return 180


def drop_in(objs, final_off: Vector, mid_off: Vector, f0: int, f_mid: int, f_end: int) -> None:
    """Hold at final + final_off, glide to final + mid_off, then straight down home."""
    for o in objs:
        a = o.location.copy()
        key_loc(o, 1, a + final_off)
        key_loc(o, f0, a + final_off)
        key_loc(o, f_mid, a + mid_off)
        key_loc(o, f_end, a)


def shot_ground_assembly():
    hide_reference()
    objs = product_objects()
    lo, hi = bounds(objs)
    c, r = (lo + hi) / 2, (hi - lo).length / 2
    studio(lo.z, r)
    # Inside first: the cell, the charger, the radar, its LM358 pre-amp, the
    # ESP32-C3 and its clamp tabs, the switch and the LED; then the lid with the
    # MT3608 on it and the radome. Then the arm: the slide drops into the
    # spine's channel, the swivel and the folded head (pinned together) down
    # behind it; last the pod, into its pocket in the dock base.
    order = [["LiPo"], ["TP4056"], ["BGT24LTR11"], ["LM358"], ["ESP32-C3"], ["ESP32 clamp"],
             ["Slide switch", "Light pipe", "Status LED"], ["Lid", "MT3608"], ["Radome"]]
    step = 13
    arm = [o for o in objs if o.name.startswith("Phone arm")]
    inside = [o for o in objs if o not in arm]
    assemble(inside, order, start=20, step=step, travel=40, extra=(0, 30, 0))
    assembled_and_exploded(arm)
    for o in objs:   # the dock base stays put in this shot
        if o.name.startswith("Dock base"):
            o.animation_data_clear()
            o.location = (0, 0, 0)
    f_arm = 20 + (len(order) - 1) * step + 30
    slide = [o for o in arm if o.name.startswith("Phone arm slide")]
    head = [o for o in arm if not o.name.startswith("Phone arm slide")]
    # Both come down from above the frame, straight into place.
    drop_in(slide, Vector((0, 0, 260)), Vector((0, 0, 70)), f_arm, f_arm + 22, f_arm + 40)
    drop_in(head, Vector((0, 0, 300)), Vector((0, 0, 80)), f_arm + 26, f_arm + 48, f_arm + 68)
    pod = load_pod()
    f_pod = f_arm + 70
    for o in [bpy.data.objects["Pod in pocket"]]:
        drop_in([o], Vector((0, 95, 0)), Vector((0, 0, 50)), f_pod, f_pod + 24, f_pod + 44)
    frames = f_pod + 44 + 24
    cam = camera(60)
    # From behind and above, where the parts come in, swinging round toward the side.
    back_fill(Vector((0.3, 1.0, 0.5)).normalized(), 0.8)
    orbit(cam, c + Vector((0, 12, 4)), fit_distance(r * 1.35, 60, 1.0), 24, 205, 150, frames)
    return frames


def shot_arm_open():
    """The arm opens: the slide pulls up out of the spine, the head flips up
    and tilts back, the swivel turns toward the golfer, and the phone settles
    onto the head. Close three-quarter view from behind, then a slight pull back."""
    hide_reference()
    objs = product_objects()
    assembled_and_exploded(objs)
    objs += load_pod()
    lo, hi = bounds(objs)
    studio(lo.z, (hi - lo).length / 2)
    arm = Arm()
    arm.key(1, 0, 0, 0)
    arm.key(14, 0, None, None)
    arm.key(52, 1.0, None, None)                 # slide up 46 mm
    arm.key(50, None, 0, None)
    arm.key(98, None, 1.0, None)                 # head flips up and back to -25 deg
    arm.key(96, None, None, 0)
    arm.key(126, None, None, YAW)                # swivel turns 20 deg
    # The phone comes down from above and settles onto the open head.
    phone = arm.add_phone()
    for f, hidden in ((1, True), (119, True), (120, False)):
        for o in (phone, *phone.children):
            o.hide_render = hidden
            o.keyframe_insert("hide_render", frame=f)
    arm.key_phone(1, 70, 260)
    arm.key_phone(120, 70, 260)
    arm.key_phone(150, 14, 10)
    arm.key_phone(166, 0, 0)

    view = Vector((-0.62, 0.72, 0.30)).normalized()   # behind, on the side the head turns to, a little above
    back_fill(view, 2.6)
    cam = camera(50)
    tgt = target_empty()
    folded = Vector((BODY_W / 2, 30, 38))
    opened = Vector((BODY_W / 2, 36, 112))
    key_loc(tgt, 1, folded)
    key_loc(tgt, 30, folded)
    key_loc(tgt, 120, opened)
    key_loc(tgt, 180, opened)
    key_loc(cam, 1, folded + view * fit_distance(64, 50, 1.0))
    key_loc(cam, 30, folded + view * fit_distance(66, 50, 1.0))
    key_loc(cam, 120, opened + view * fit_distance(142, 50, 1.0))
    key_loc(cam, 180, opened + view * fit_distance(134, 50, 1.0))
    cam.data.dof.aperture_fstop = 11.0
    return 180


def shot_ground_in_use():
    hide_reference()
    objs = product_objects()
    assembled_and_exploded(objs)   # drop the .blend's explode animation: assembled throughout
    # In play the pod is on the club, so the pocket is empty; the phone films from the open arm.
    arm = Arm()
    arm.open_pose()
    arm.add_phone()
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
    mid = Vector((WIN_CX, -RANGE_FROM_TEE * 0.37, floor_z + 80))
    # The unit and the phone on its arm from in front, then pull back, up and
    # round behind the unit to show the phone, the beam and the ball.
    look = window + Vector((0, 0, 45))
    key_loc(cam, 1, look + Vector((170, -250, 40)))
    key_loc(cam, 50, look + Vector((215, -310, 60)))
    key_loc(cam, 210, Vector((WIN_CX + 1000, 1300, 750)))
    key_loc(tgt, 1, look)
    key_loc(tgt, 50, look)
    key_loc(tgt, 210, mid)
    cam.data.dof.aperture_fstop = 16.0
    cam.data.clip_end = 100000
    return 210


def shot_radome_colours():
    """Three units side by side, identical but for the radome: smoke (the
    design's), ice and amber. Translucent PETG without carbon black passes
    24 GHz, so the radome is where a colour choice can go; the body stays
    matte black. A slow lateral move along the row."""
    hide_reference()
    objs = product_objects()   # the arm folded, as exported
    assembled_and_exploded(objs)
    lo, hi = bounds(objs)
    pitch = (hi.x - lo.x) + 36
    finishes = [
        None,   # smoke: the radome as designed
        material("Ice radome", (0.42, 0.66, 0.92, 1), roughness=0.05, alpha=0.38),
        material("Amber radome", (0.90, 0.30, 0.01, 1), roughness=0.12, alpha=0.72),
    ]
    for o in objs:   # the designed unit on the left
        o.location.x -= pitch
    for i, mat in enumerate(finishes[1:], start=1):
        for o in objs:
            twin = o.copy()
            twin.location.x += i * pitch
            for col in o.users_collection:
                col.objects.link(twin)
            if o.name.startswith("Radome"):
                twin.data = o.data.copy()
                twin.data.materials.clear()
                twin.data.materials.append(mat)
    smoke = next(o for o in objs if o.name.startswith("Radome")).active_material
    for m in finishes[1:]:   # the smoke radome's own blend and shadow settings, so all three are lit alike
        m.blend_method, m.shadow_method = smoke.blend_method, smoke.shadow_method
    lo, hi = lo - Vector((pitch, 0, 0)), hi + Vector((pitch, 0, 0))
    studio(lo.z, (hi - lo).length / 2)
    centre = Vector(((lo.x + hi.x) / 2, 0.0, 32.0))

    # From the target side and to the left, so the row recedes to the right:
    # the designed smoke radome nearest, then ice, then amber.
    cam = camera(50)
    tgt = target_empty()
    d = 540.0
    view = Vector((-0.50, -1.0, 0.34)).normalized()
    centre.x -= 0.25 * pitch   # the near unit is the largest: weight the frame toward it
    for f, dx in ((1, -32.0), (120, 32.0)):
        key_loc(tgt, f, centre + Vector((dx * 0.5, 0, 0)))
        key_loc(cam, f, centre + Vector((dx, 0, 0)) + view * d)
    linear(cam)
    linear(tgt)
    cam.data.dof.aperture_fstop = 16.0
    return 120


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
    # The IMU on its datum floor, the cell and charger, the diode P5, the
    # ESP32-C3, the lid; then the reusable TPU strap comes up under the shaft
    # and hooks over its two posts. The liner strips stay in the clamp.
    order = [["LSM6DS3TR-C"], ["LiPo", "Micro charger"], ["P5 Schottky"], ["ESP32-C3"], ["Pod lid"]]
    strap = [o for o in objs if o.name.startswith("Reusable strap")]
    assemble([o for o in objs if o not in strap], order, start=20, step=22, travel=40, extra=(0, 0, 18))
    assembled_and_exploded(strap)
    drop_in(strap, Vector((0, 0, -34)), Vector((0, 0, -14)), 132, 150, 172)
    cam = camera(70)
    orbit(cam, c + Vector((0, 0, 14)), fit_distance(r * 1.9, 70, 1.0), 34, 25, 60, 195)
    return 195


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
    # The C-clamp's mouth faces down: the pod is pushed down onto the shaft,
    # then the reusable TPU strap comes up under the shaft to its two posts.
    strap = [o for o in objs if o.name.startswith("Reusable strap")]
    for o in objs:
        if o in strap:
            continue
        a = o.location.copy()
        key_loc(o, 1, a + Vector((0, 0, 30)))
        key_loc(o, 40, a + Vector((0, 0, 30)))
        key_loc(o, 85, a)
    drop_in(strap, Vector((0, 0, -40)), Vector((0, 0, -12)), 92, 112, 132)
    cam = camera(70)
    # Looking along the shaft, slightly off-axis, so the C closing round it shows.
    orbit(cam, c + Vector((0, 0, 12)), fit_distance(r * 1.9, 70, 1.0), 20, -70, -45, 170)
    return 170


SHOTS = {f.__name__[5:]: f for f in [shot_ground_hero, shot_ground_assembly, shot_arm_open,
                                     shot_ground_in_use, shot_radome_colours,
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
