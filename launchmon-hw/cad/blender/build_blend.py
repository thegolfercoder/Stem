"""Build a .blend scene from in-place STL exports of an OpenSCAD model.

Run by cad/export_blend.sh, not by hand:

    blender -b --factory-startup -P build_blend.py -- MANIFEST.json OUT.blend [PREVIEW.png]

The manifest lists one STL per object, exported by OpenSCAD in its assembled
position (part = "in_place:..." or "ghost:..."), with the collection, colour
and exploded-view offset for each. OpenSCAD stays the single source of
geometry: nothing is modelled here, so the .blend cannot drift from the CAD.

Scene conventions:
  * Units are millimetres (unit scale 0.001), so 1 Blender unit = 1 mm and the
    coordinates match the OpenSCAD scripts exactly.
  * Frame 1 is assembled, frame 60 exploded. Scrub the timeline to take it apart.
  * Printed parts carry the name of their print-ready STL as a custom property.
"""

from __future__ import annotations

import json
import math
import sys

import bpy
from mathutils import Vector


def args() -> list[str]:
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.001
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.frame_start, scene.frame_end, scene.frame_current = 1, 60, 1


def import_stl(path: str) -> bpy.types.Object:
    before = set(bpy.data.objects)
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=path)
    else:  # Blender < 3.6: the Python importer add-on
        import addon_utils

        addon_utils.enable("io_mesh_stl")
        bpy.ops.import_mesh.stl(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    if len(new) != 1:
        raise RuntimeError(f"expected one object from {path}, got {len(new)}")
    return new[0]


def tidy_mesh(obj: bpy.types.Object, smooth_angle_deg: float = 35.0) -> None:
    """Weld STL triangles and shade smooth by angle, so curves read as curves."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    angle = math.radians(smooth_angle_deg)
    if hasattr(obj.data, "use_auto_smooth"):  # Blender <= 4.0
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = angle
    else:  # 4.1+: smooth-by-angle modifier
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=angle)
        except Exception:
            pass
        obj.select_set(False)


def material(name: str, rgba: list[float], roughness: float, metallic: float = 0.0) -> bpy.types.Material:
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = rgba  # solid-mode viewport colour
    if rgba[3] < 1.0:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        mat.blend_method = "BLEND"
    return mat


def collection(name: str) -> bpy.types.Collection:
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def add_object(entry: dict) -> bpy.types.Object:
    obj = import_stl(entry["file"])
    obj.name = obj.data.name = entry["name"]
    tidy_mesh(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material(entry["material"], entry["color"], entry.get("roughness", 0.5),
                                       entry.get("metallic", 0.0)))
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    collection(entry["collection"]).objects.link(obj)
    for key, value in entry.get("props", {}).items():
        obj[key] = value

    # Assembled at frame 1, exploded at frame 60.
    base = Vector(entry.get("offset", [0, 0, 0]))
    obj.location = base
    obj.keyframe_insert("location", frame=1)
    obj.location = base + Vector(entry.get("explode", [0, 0, 0]))
    obj.keyframe_insert("location", frame=60)
    obj.location = base
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
    obj.hide_render = entry.get("hide_render", False)
    obj.hide_set(entry.get("hide_viewport", False))
    return obj


def stage(objects: list[bpy.types.Object], view: dict) -> bpy.types.Object:
    """Camera, lights and a neutral world, framed on the assembled objects."""
    scene = bpy.context.scene
    pts = [o.matrix_world @ Vector(c) for o in objects if not o.hide_render for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre, size = (lo + hi) / 2, (hi - lo).length

    target = bpy.data.objects.new("Camera target", None)
    target.location = centre
    collection("Stage").objects.link(target)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 70
    cam_data.clip_start, cam_data.clip_end = 1.0, 100000.0
    cam = bpy.data.objects.new("Camera", cam_data)
    direction = Vector(view["camera_dir"]).normalized()
    cam.location = centre + direction * size * view.get("distance", 2.4)
    track = cam.constraints.new("TRACK_TO")
    track.target, track.track_axis, track.up_axis = target, "TRACK_NEGATIVE_Z", "UP_Y"
    collection("Stage").objects.link(cam)
    scene.camera = cam

    for name, energy, rot in [("Key", 2.2, (50, 10, 40)), ("Fill", 0.7, (65, -20, -60)), ("Rim", 1.2, (120, 0, 180))]:
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.angle = math.radians(8)
        ob = bpy.data.objects.new(name, light)
        ob.rotation_euler = [math.radians(a) for a in rot]
        collection("Stage").objects.link(ob)

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.80, 0.82, 0.86, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    scene.world = world

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.view_settings.view_transform = "Standard"
    return cam


def readme(text: str) -> None:
    t = bpy.data.texts.new("README")
    t.write(text)


def main() -> None:
    a = args()
    if len(a) < 2:
        raise SystemExit("usage: build_blend.py -- MANIFEST.json OUT.blend [PREVIEW.png]")
    manifest = json.load(open(a[0]))
    reset_scene()
    objects = [add_object(e) for e in manifest["objects"]]
    stage(objects, manifest["view"])
    readme(manifest["readme"])

    if len(a) > 2:  # preview render, assembled and exploded
        scene = bpy.context.scene
        scene.cycles.samples = 48
        scene.cycles.use_denoising = False   # not every Blender build ships OpenImageDenoise
        scene.render.resolution_percentage = 50   # previews only; the saved scene renders at 100 %
        for frame, suffix in [(1, ""), (60, "_exploded")]:
            scene.frame_set(frame)
            scene.render.filepath = a[2].replace(".png", f"{suffix}.png")
            bpy.ops.render.render(write_still=True)
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
        scene.render.resolution_percentage = 100
        scene.frame_set(1)

    bpy.ops.wm.save_as_mainfile(filepath=a[1], compress=True)


main()
