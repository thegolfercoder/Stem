"""
Render a car GLB from the standard review angles, for checking a model
against its reference photographs.

    python tools/blender/preview.py model.glb out_prefix [views]

views: comma-separated from side,front,rear,hero,rear34,top, or the close-ups
apillar,lamp,wheel (default: all).
Cycles on the CPU, a neutral grey studio, a soft key light: enough to judge
shape and surfaces, not a beauty render.
"""

import math
import sys

import bpy
from mathutils import Vector

VIEWS = {
    # (camera position, look-at) in Blender axes: x across, -y forward, z up.
    "side": ((9.5, 0.0, 0.62), (0.0, 0.0, 0.62)),
    "front": ((0.0, -10.0, 0.9), (0.0, 0.0, 0.62)),
    "rear": ((0.0, 10.0, 1.1), (0.0, 0.0, 0.62)),
    "hero": ((5.2, -6.6, 1.25), (0.0, -0.1, 0.55)),
    "rear34": ((-5.2, 6.6, 1.35), (0.0, 0.1, 0.6)),
    "top": ((0.0, 0.0, 13.0), (0.0, 0.0, 0.0)),
    # Close-ups for checking detail.
    "apillar": ((2.3, -2.2, 1.6), (0.6, -0.4, 1.05)),
    "lamp": ((1.6, -3.9, 1.0), (0.7, -1.95, 0.7)),
    "wheel": ((3.2, -1.4, 0.5), (0.8, -1.25, 0.35)),
}


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    glb, prefix = args[0], args[1]
    views = args[2].split(",") if len(args) > 2 else list(VIEWS)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1200, 675
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.56, 0.58, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    scene.world = world

    # Floor.
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new("Floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.51, 0.52, 1)
    fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
    floor.data.materials.append(fm)

    # Big softbox overhead and two side strips.
    for loc, size, energy in (((0, 0, 6), (8, 4), 900), ((7, 0, 2.5), (1.2, 8), 500), ((-7, 0, 2.5), (1.2, 8), 400)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        l = bpy.context.object
        l.data.shape = "RECTANGLE"
        l.data.size, l.data.size_y = size
        l.data.energy = energy
        look_at(l, (0, 0, 0.5))

    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.data.lens = 55
    scene.camera = cam
    for v in views:
        pos, target = VIEWS[v]
        cam.location = pos
        look_at(cam, target)
        if v == "top":
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = 5.2
        else:
            cam.data.type = "PERSP"
        scene.render.filepath = f"{prefix}-{v}.png"
        bpy.ops.render.render(write_still=True)
        print("rendered", scene.render.filepath)


main()
