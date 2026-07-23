"""Import an EvoSim frame stream into Blender as an animated 3D scene.

Run this *inside Blender* (Scripting tab -> Run Script, or
``blender --python blender/import_evosim.py``). It reads the JSON produced by
``scripts/export_blender.py`` and builds a "living planet": a ground plane the
size of the world, plants as small green instances, and organisms as spheres
whose position, scale, and colour are keyframed per exported frame -- so the
unscripted 2D evolution plays back as a 3D cinematic.

This file is standalone Blender/Python (uses ``bpy``) and is intentionally kept
out of the importable ``evosim`` package, which must not depend on Blender.

Configuration: set ``FRAME_FILE`` below (or the ``EVOSIM_FRAMES`` env var).
"""

from __future__ import annotations

import json
import os

FRAME_FILE = os.environ.get("EVOSIM_FRAMES", "data/evosim_frames.json")
# Blender scene units per world unit (keeps the scene a manageable size).
SCALE = 0.01
# Play back one exported frame every N Blender frames.
FRAMES_PER_STEP = 2


def _load(path):
    with open(path) as f:
        return json.load(f)


def _clear_scene(bpy):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _make_material(bpy, name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    return mat


def main():
    import bpy  # only available inside Blender

    data = _load(FRAME_FILE)
    meta = data.get("meta", {})
    frames = data.get("frames", [])
    if not frames:
        print("No frames to import.")
        return

    width = meta.get("width", 1200) * SCALE
    height = meta.get("height", 1200) * SCALE

    _clear_scene(bpy)

    # Ground plane.
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(width / 2, height / 2, 0))
    ground = bpy.context.active_object
    ground.scale = (width, height, 1)
    ground.data.materials.append(_make_material(bpy, "Ground", (0.12, 0.16, 0.12)))

    # One reusable sphere mesh per organism, keyframed across frames.
    # Track objects by organism id so lifespans animate correctly.
    objects = {}

    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = len(frames) * FRAMES_PER_STEP

    for f_index, frame in enumerate(frames):
        blender_frame = f_index * FRAMES_PER_STEP
        scene.frame_set(blender_frame)
        seen = set()
        for org in frame["organisms"]:
            oid = org["id"]
            seen.add(oid)
            x = org["x"] * SCALE
            y = org["y"] * SCALE
            r = max(0.3, org["size"]) * SCALE * 6
            if oid not in objects:
                bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(x, y, r))
                obj = bpy.context.active_object
                col = [c / 255.0 for c in org["color"]]
                obj.data.materials.append(_make_material(bpy, f"Org{oid}", col))
                objects[oid] = obj
            obj = objects[oid]
            obj.location = (x, y, r)
            obj.scale = (r, r, r)
            obj.keyframe_insert(data_path="location", frame=blender_frame)
            obj.keyframe_insert(data_path="scale", frame=blender_frame)

    print(f"Imported {len(frames)} frames, {len(objects)} organisms.")


if __name__ == "__main__":
    main()
