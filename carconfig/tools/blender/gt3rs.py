"""
Porsche 911 GT3 RS (992.1, sold as the 2026 model year), built in Blender.

    python tools/blender/gt3rs.py [out.glb]      (needs the `bpy` module)

Built the way a studio modeller works from blueprints, but in code so the
model can be rebuilt and every number traced back:

  * Dimensions from Porsche's technical data sheet (S22_3515): 4572 x 1900 x
    1322 mm, 2457 mm wheelbase, 1630/1582 mm tracks, 275/35 ZR20 and 335/30
    ZR21 tyres on 10J x 20 ET45 and 13J x 21 ET31 wheels, 408/380 mm discs.
  * Side silhouette, window line and sill line traced from Porsche's studio
    side view on a measurement grid, perspective-corrected against the
    published length and wheelbase (see traced.json).
  * Widths, lamp and vent positions measured from the studio front and rear
    views, as fractions of the car's width.

Axes while modelling: x across the car (right +), u along it (front +),
h up, in metres, origin on the ground under the middle of the car. Blender's
own axes are x, -u, h, so the exported glTF has the front toward +z.

Materials are named for what they are ("Paint", "Glass", "Tyre", "Chrome",
"Carbon", "PianoBlack", ...) so the site's material handling recognises them.
"""

import json
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TRACED = json.load(open(os.path.join(HERE, "gt3rs-traced.json")))

# --- published figures (metres) ------------------------------------------------
L, W, H, WB = 4.572, 1.900, 1.322, 2.457
TRACK_F, TRACK_R = 1.630, 1.582
TYRE_F = (275, 35, 20)  # width mm, aspect, rim in
TYRE_R = (335, 30, 21)


def rolling_radius(t):
    return t[2] * 0.0254 / 2 + t[0] * t[1] / 100 / 1000


R_F, R_R = rolling_radius(TYRE_F), rolling_radius(TYRE_R)

# Along-car position of a traced fraction (0 = front bumper, 1 = rear).
def U(xf):
    return L / 2 - xf * L


U_FA = U(TRACED["frontAxle"])
U_RA = U_FA - WB


# --- curves -----------------------------------------------------------------------
def pchip(pts):
    """Monotone cubic through (x, y) points; never overshoots."""
    pts = sorted(pts)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = max(j for j in range(n - 1) if xs[j] <= x)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return (
            (2 * t3 - 3 * t2 + 1) * ys[i]
            + (t3 - 2 * t2 + t) * h[i] * m[i]
            + (-2 * t3 + 3 * t2) * ys[i + 1]
            + (t3 - t2) * h[i] * m[i + 1]
        )

    return f


T = TRACED
silhouette = pchip([(x, y * H) for x, y in T["top"]])
belt = pchip([(x, y * H) for x, y in T["belt"]])
sill = pchip([(x, y * H) for x, y in T["bottom"]])


def body_top(xf):
    """Top of the body (wing tops): the silhouette outside the glass, the window line under it."""
    if xf <= T["cowl"] or xf >= T["backlight"]:
        return silhouette(xf)
    return belt(xf)


# Plan-view half-width: measured proportions of the studio front and rear
# views, and the published width at the rear haunches. Narrow at the nose,
# flared over the front wheels, pinched at the doors, widest at the haunches.
half_width = pchip(
    [
        (0.000, 0.55),
        (0.008, 0.70),
        (0.020, 0.80),
        (0.045, 0.868),
        (0.090, 0.910),
        (0.170, 0.938),
        (0.226, 0.950),
        (0.300, 0.935),
        (0.400, 0.900),
        (0.500, 0.893),
        (0.600, 0.905),
        (0.680, 0.940),
        (0.764, 0.950),
        (0.860, 0.940),
        (0.930, 0.905),
        (0.975, 0.84),
        (1.000, 0.70),
    ]
)

# How far the middle of the bonnet and engine lid sits below the wing tops:
# the 911's lamps ride on raised wings with the bonnet low between them.
centre_dip = pchip(
    [
        (0.000, 0.03),
        (0.030, 0.10),
        (0.120, 0.12),
        (0.250, 0.085),
        (0.318, 0.035),
        (0.330, 0.0),
        (0.820, 0.0),
        (0.840, 0.035),
        (0.920, 0.045),
        (1.000, 0.02),
    ]
)


# --- sections -----------------------------------------------------------------------
def section(xf):
    """Right half of a body section, from the bottom centre round to the top centre.

    Points are (x, h). The widest point is low on the flank; a crisp shoulder
    runs just under the wing top; the wing crest sits at about 0.79 of the
    half-width, and the bonnet or engine lid falls away inboard of it.
    """
    top = body_top(xf)
    bot = sill(xf)
    hw = half_width(xf)
    dip = centre_dip(xf)
    span = top - bot
    return [
        (0.00, bot),
        (0.55 * hw, bot),
        (0.90 * hw, bot + 0.01),
        (0.985 * hw, bot + 0.10 * span),
        (1.000 * hw, bot + 0.40 * span),
        (0.990 * hw, bot + 0.68 * span),  # shoulder crease
        (0.960 * hw, bot + 0.87 * span),
        (0.900 * hw, top - 0.01),
        (0.790 * hw, top),  # wing crest, running over the lamps
        (0.620 * hw, top - dip * 0.55),
        (0.330 * hw, top - dip * 0.95),
        (0.00, top - dip),
    ]


def stations(n=90):
    """Stations along the car, denser at the ends where the shape turns fastest."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(0.5 - 0.5 * math.cos(math.pi * t))
    return out


# --- coordinates -------------------------------------------------------------------------
# Model axes (x across, u forward, h up) to Blender's (x, -u, h) and back.
def B(x, u, h):
    return Vector((x, -u, h))


def dirB(dx, du, dh):
    return Vector((dx, -du, dh)).normalized()


def to_model(v):
    return (v.x, -v.y, v.z)


def xf_of(u):
    return min(1.0, max(0.0, (L / 2 - u) / L))


# Glass sits on this line at the sides of the cabin: the door top at the doors,
# pulled in over the rear haunches, which flare out past the cabin.
cabin_half = pchip(
    [
        (T["cowl"], 0.665),
        (0.400, 0.745),
        (0.550, 0.750),
        (0.650, 0.715),
        (0.740, 0.640),
        (T["backlight"], 0.540),
    ]
)

# Half-width of the roof panel between the drip rails.
roof_half = pchip(
    [
        (T["cowl"], 0.60),
        (T["roofFront"], 0.555),
        (0.600, 0.560),
        (T["roofRear"], 0.530),
        (T["backlight"], 0.450),
    ]
)


def base_half(xf):
    return min(0.84 * half_width(xf), cabin_half(xf))


# --- mesh helpers ---------------------------------------------------------------------
def new_object(name, mesh):
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    return ob


def bm_object(name, bm, mats=()):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = new_object(name, me)
    for m in mats:
        ob.data.materials.append(m)
    return ob


def material(name, color, metallic=0.0, roughness=0.5, alpha=1.0, emission=None, strength=0.0, clearcoat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Alpha"].default_value = alpha
    if clearcoat:
        b.inputs["Coat Weight"].default_value = clearcoat
        b.inputs["Coat Roughness"].default_value = 0.03
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1 and hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    return m


def loft(name, rings, closed_ring=True, cap_ends=True):
    """Quad surface through rings of Blender-space points (each ring the same length)."""
    bm = bmesh.new()
    vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vrings, vrings[1:]):
        for j in range(n if closed_ring else n - 1):
            j2 = (j + 1) % n
            bm.faces.new((a[j], a[j2], b[j2], b[j]))
    if cap_ends:
        bm.faces.new(list(reversed(vrings[0])))
        bm.faces.new(vrings[-1])
    return bm_object(name, bm)


def full_ring(half):
    """Mirror a right-half section into a closed ring (right side then left)."""
    left = [(-x, h) for x, h in reversed(half[1:-1])]
    return half + left


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def subdivide(ob, levels=2):
    m = ob.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    apply_modifiers(ob)


def bevel(ob, width, segments=3):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    apply_modifiers(ob)


def boolean(ob, cutter, op="DIFFERENCE"):
    m = ob.modifiers.new("Bool", "BOOLEAN")
    m.object = cutter
    m.operation = op
    m.solver = "EXACT"
    apply_modifiers(ob)


def smooth(ob, angle=35):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    ob.select_set(False)


def join(name, obs):
    """Merge objects into one (materials carried over)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


def ray(ob, origin, direction, dist=10.0):
    """First hit on `ob` along a model-space ray: (point, normal) in model axes, or None."""
    bpy.context.view_layer.update()
    ok, loc, nrm, _ = ob.ray_cast(B(*origin), dirB(*direction), distance=dist)
    return (to_model(loc), to_model(nrm)) if ok else None


def surface_h(ob, x, u):
    hit = ray(ob, (x, u, 3.0), (0, 0, -1))
    return hit[0][2] if hit else None


# --- cutters: solids subtracted from the body, remembered so the walls they
# leave can be given the right material afterwards ----------------------------------------
CUTS = []  # (test(blender point) -> bool, material name)
EPS = 0.0015


def hexa(name, pts):
    """A six-sided solid from 8 model-space corners: bottom four, then top four, same winding."""
    bm = bmesh.new()
    v = [bm.verts.new(B(*p)) for p in pts]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    planes = [(f.calc_center_median().copy(), f.normal.copy()) for f in bm.faces]
    ob = bm_object(name, bm)

    def test(p):
        return all((p - c).dot(n) <= EPS for c, n in planes)

    return ob, test


def obox(name, c, ex, eu, eh, hx, hu, hh):
    """Oriented box: centre c and axes (model space), half sizes along each."""
    c, ex, eu, eh = Vector(c), Vector(ex).normalized(), Vector(eu).normalized(), Vector(eh).normalized()
    pts = []
    for sh in (-1, 1):
        for sx, su in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = c + ex * hx * sx + eu * hu * su + eh * hh * sh
            pts.append(tuple(p))
    return hexa(name, pts)


def cylinder(name, c, d, r, s0, s1, segments=64):
    """Solid cylinder along model direction d through c, from s0 to s1 along d."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r, depth=s1 - s0)
    dB = dirB(*d)
    rot = Vector((0, 0, 1)).rotation_difference(dB).to_matrix().to_4x4()
    cB = B(*c)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(cB + dB * ((s0 + s1) / 2)) @ rot, verts=bm.verts)
    ob = bm_object(name, bm)

    def test(p):
        q = p - cB
        s = q.dot(dB)
        return s0 - EPS <= s <= s1 + EPS and (q - dB * s).length <= r + EPS

    return ob, test


def cut(body, made, material_name):
    cut_many(body, [made], material_name)


def assign(ob, classify, mats, cuts=()):
    """Give each face the material `classify(centre, normal, current)` names (model axes).

    Faces left by a cutter take the cutter's material first. Every corner must
    lie in the cutter, not just the centre: a sliver of outer skin along an
    opening's edge can have its centre inside while being part of the surface.
    """
    names = [m.name for m in ob.data.materials]
    verts = ob.data.vertices
    for p in ob.data.polygons:
        cB = p.center
        current = names[p.material_index] if names else None
        name = None
        for test, cut_name in cuts:
            if test(cB) and all(test(verts[i].co) for i in p.vertices):
                name = cut_name
                break
        if name is None:
            name = classify(cB, p.normal, current)
        if name and name != current:
            if name not in names:
                ob.data.materials.append(mats[name])
                names.append(name)
            p.material_index = names.index(name)


# --- materials ---------------------------------------------------------------------------
def make_materials():
    return {
        m.name: m
        for m in (
            material("Paint", (0.80, 0.81, 0.82), metallic=0.25, roughness=0.22, clearcoat=1.0),
            material("Glass", (0.05, 0.07, 0.08), roughness=0.02, alpha=0.35),
            material("HeadlightLens", (1, 1, 1), roughness=0.02, alpha=0.15),
            material("LampHousingBlack", (0.015, 0.016, 0.018), roughness=0.3),
            material("LampReflectorChrome", (0.9, 0.9, 0.92), metallic=1.0, roughness=0.06),
            material("LampDRL", (1, 1, 1), emission=(0.9, 0.95, 1.0), strength=12.0),
            material("TailLightBar", (0.4, 0.0, 0.0), roughness=0.15, emission=(1.0, 0.02, 0.02), strength=5.0),
            material("TailLampDark", (0.12, 0.0, 0.0), roughness=0.08),
            material("GrilleBlack", (0.02, 0.02, 0.022), roughness=0.7),
            material("TrimBlackPlastic", (0.03, 0.03, 0.032), roughness=0.65),
            material("PianoBlack", (0.01, 0.01, 0.012), roughness=0.08, clearcoat=1.0),
            material("Carbon", (0.025, 0.026, 0.03), metallic=0.1, roughness=0.35, clearcoat=1.0),
            material("ArchLiner", (0.015, 0.015, 0.015), roughness=0.95),
            material("UnderbodyBlack", (0.02, 0.02, 0.02), roughness=0.9),
            material("PanelGap", (0.005, 0.005, 0.005), roughness=0.9),
            material("InteriorAlcantara", (0.03, 0.03, 0.032), roughness=0.9),
            material("SeatLeather", (0.035, 0.035, 0.037), roughness=0.6),
            material("SeatAccent", (0.55, 0.03, 0.04), roughness=0.6),
            material("CageBlack", (0.02, 0.02, 0.022), metallic=0.3, roughness=0.45),
            material("Tyre", (0.025, 0.025, 0.025), roughness=0.88),
            material("WheelRim", (0.165, 0.172, 0.188), metallic=0.8, roughness=0.35),
            material("BrakeDisc", (0.35, 0.35, 0.36), metallic=1.0, roughness=0.4),
            material("Caliper", (0.70, 0.02, 0.03), roughness=0.3, clearcoat=0.8),
            material("LockNut", (0.05, 0.05, 0.055), metallic=0.9, roughness=0.3),
            material("ExhaustTitanium", (0.42, 0.40, 0.38), metallic=1.0, roughness=0.3),
            material("ExhaustInner", (0.01, 0.01, 0.01), roughness=0.9),
            material("MirrorChrome", (0.9, 0.9, 0.92), metallic=1.0, roughness=0.03),
            material("Headliner", (0.04, 0.04, 0.042), roughness=0.9),
            material("BadgeChrome", (0.85, 0.85, 0.86), metallic=1.0, roughness=0.15),
        )
    }


# --- body -------------------------------------------------------------------------------
LAMP = {"x": 0.72, "h": 0.70, "r": 0.134, "tilt": math.radians(10)}


def body_rings():
    rings = []
    for xf in stations():
        half = section(max(0.002, min(0.998, xf)))
        # The very ends pull in so the nose and tail close in a rounded edge.
        k = 1.0
        if xf < 0.012:
            k = 0.55 + 0.45 * (xf / 0.012)
        if xf > 0.988:
            k = 0.55 + 0.45 * ((1 - xf) / 0.012)
        mid_h = (half[0][1] + half[-1][1]) / 2
        ring = full_ring([(x * k, mid_h + (h - mid_h) * (0.85 + 0.15 * k)) for x, h in half])
        rings.append([B(x, U(xf), h) for x, h in ring])
    return rings


def build_body(mats):
    body = loft("Body", body_rings())
    subdivide(body, 3)
    body.data.materials.append(mats["Paint"])
    lens_source = body.copy()
    lens_source.data = body.data.copy()
    bpy.context.collection.objects.link(lens_source)

    # Wheel arches: from just inside the tyre outward, a finger's width above it.
    for tag, ua, r, track, tyre in (("F", U_FA, R_F, TRACK_F, TYRE_F), ("R", U_RA, R_R, TRACK_R, TYRE_R)):
        inner = track / 2 - tyre[0] / 1000 / 2 - 0.07
        for side in (1, -1):
            cut(body, cylinder(f"Arch{tag}{side}", (side * (inner + 0.6), ua, r), (side, 0, 0), r + 0.04, -0.6, 0.6, 128), "ArchLiner")

    # The cabin: open the body under the glass so the interior shows.
    a, b = T["cowl"] + 0.035, 0.745
    wa, wb = base_half(a) - 0.035, base_half(b) - 0.035
    cut(
        body,
        hexa(
            "Cabin",
            [
                (-wa, U(a), 0.36), (wa, U(a), 0.36), (wb, U(b), 0.36), (-wb, U(b), 0.36),
                (-wa, U(a), 1.6), (wa, U(a), 1.6), (wb, U(b), 1.6), (-wb, U(b), 1.6),
            ],
        ),
        "InteriorAlcantara",
    )

    lamps = build_lamp_recesses(body, lens_source, mats)
    bpy.data.objects.remove(lens_source)
    cut_openings(body)
    cut_panel_gaps(body)
    classify_body(body, mats)
    triangulate_object(body)
    smooth(body, 32)
    return body, lamps


def build_lamp_recesses(body, lens_source, mats):
    """The round headlamps, set into the front of each wing.

    Each is a cylinder bored into the wing along the lamp's axis; the piece of
    wing surface it removes becomes the lens, so the lens sweeps back along the
    wing exactly as the real one does. Inside: a reflector bowl, the projector
    and the four-point daytime running light.
    """
    parts = []
    d = (0, math.cos(LAMP["tilt"]), math.sin(LAMP["tilt"]))
    dv = Vector(d)
    for side in (1, -1):
        x = side * LAMP["x"]
        # The lamp's axis runs through this point, ahead of the wing.
        o = Vector((x, U(0.075), LAMP["h"])) + dv * 2.0
        hit = ray(body, tuple(o), tuple(-dv))
        c = Vector(hit[0])
        # Deepest point the lamp's rim meets the wing, so the bore clears it.
        e1 = Vector((1, 0, 0))
        e2 = dv.cross(e1).normalized()
        depths = []
        for i in range(16):
            t = 2 * math.pi * i / 16
            p = c + (e1 * math.cos(t) + e2 * math.sin(t)) * LAMP["r"] + dv * 1.0
            h = ray(body, tuple(p), tuple(-dv))
            if h:
                depths.append((Vector(h[0]) - c).dot(dv))
        back = min(depths) - 0.07
        made = cylinder(f"LampBore{side}", tuple(c), d, LAMP["r"], back, 1.0, 96)
        lens_cut, _ = cylinder(f"LampLens{side}", tuple(c), d, LAMP["r"] - 0.0005, back, 1.0, 96)

        # Lens: the wing surface inside the bore.
        lens = lens_source.copy()
        lens.data = lens_source.data.copy()
        bpy.context.collection.objects.link(lens)
        boolean(lens, lens_cut, "INTERSECT")
        bpy.data.objects.remove(lens_cut)
        cB, dB = B(*c), dirB(*d)
        bm = bmesh.new()
        bm.from_mesh(lens.data)
        drop = []
        for f in bm.faces:
            q = f.calc_center_median() - cB
            s = q.dot(dB)
            wall = abs(f.normal.dot(dB)) < 0.15 and (q - dB * s).length > LAMP["r"] - 0.003
            if wall or s < back + 0.002 or f.normal.dot(dB) < 0.0:
                drop.append(f)
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bm.to_mesh(lens.data)
        bm.free()
        lens.data.materials.clear()
        lens.data.materials.append(mats["HeadlightLens"])
        lens.name = f"HeadlightLens{'R' if side > 0 else 'L'}"
        smooth(lens, 60)
        parts.append(lens)

        cut(body, made, "LampHousingBlack")

        # Inside the lamp, built on the bore's axis.
        rot = Vector((0, 0, 1)).rotation_difference(dB).to_matrix().to_4x4()

        def place(bm_, s):
            bmesh.ops.transform(bm_, matrix=Matrix.Translation(cB + dB * s) @ rot, verts=bm_.verts)

        # Reflector bowl.
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=16, radius=LAMP["r"] * 0.95)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.001], context="VERTS")
        bmesh.ops.scale(bm, vec=(1, 1, 0.35), verts=bm.verts)
        place(bm, back + 0.042)
        parts.append(bm_object(f"LampReflector{side}", bm, [mats["LampReflectorChrome"]]))

        # Projector: a short barrel with a glass bulb.
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.034, radius2=0.034, depth=0.05)
        place(bm, back + 0.03)
        parts.append(bm_object(f"LampProjector{side}", bm, [mats["LampHousingBlack"]]))
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.03)
        place(bm, back + 0.05)
        parts.append(bm_object(f"LampProjectorLens{side}", bm, [mats["LampReflectorChrome"]]))

        # Four-point DRL: four short bars on a ring round the projector.
        for k in range(4):
            t = math.pi / 4 + k * math.pi / 2
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(0.012, 0.042, 0.008), verts=bm.verts)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(t, 3, "Z"))
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0.078 * math.cos(t), 0.078 * math.sin(t), 0))
            place(bm, back + 0.045)
            parts.append(bm_object(f"LampDRL{side}{k}", bm, [mats["LampDRL"]]))
        # Thin ring light round the rim.
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=96, radius=LAMP["r"] * 0.9)
        ring = bmesh.ops.extrude_edge_only(bm, edges=bm.edges[:])["geom"]
        bmesh.ops.scale(bm, vec=(1.04, 1.04, 1), verts=[g for g in ring if isinstance(g, bmesh.types.BMVert)])
        place(bm, back + 0.04)
        parts.append(bm_object(f"LampRing{side}", bm, [mats["LampDRL"]]))
    return parts


def cut_openings(body):
    """Vents and intakes: pockets and slots with dark walls."""
    up, fwd, across = (0, 0, 1), (0, 1, 0), (1, 0, 0)
    nostrils, louvres, outlets, blades, vents = [], [], [], [], []
    for side in (1, -1):
        # Bonnet nostrils: two deep ducts either side of the centre.
        u0, u1 = U(0.165), U(0.075)
        xa, xb = side * 0.11, side * 0.40
        corners = [(x, u, surface_h(body, x, u)) for x, u in ((xa, u0), (xb, u0), (xb, u1), (xa, u1))]
        nostrils.append(
            hexa(f"Nostril{side}", [(x, u, h - 0.08) for x, u, h in corners] + [(x, u, h + 0.3) for x, u, h in corners])
        )
        # Gills on the wing top, over the front of the wheel.
        for i, xf in enumerate((0.105, 0.132, 0.159)):
            louvres.append(
                obox(f"Louvre{side}{i}", (side * 0.8, U(xf), 0.98), across, (0, 1, 0.5), up, 0.12, 0.013, 0.22)
            )
        # Outlet behind the front wheel.
        hw = half_width(0.31)
        outlets.append(
            hexa(
                f"ArchOutlet{side}",
                [
                    (side * (hw - 0.07), U(0.345), 0.2), (side * (hw + 0.4), U(0.345), 0.2),
                    (side * (hw + 0.4), U(0.285), 0.2), (side * (hw - 0.07), U(0.285), 0.2),
                    (side * (hw - 0.07), U(0.335), 0.64), (side * (hw + 0.4), U(0.335), 0.64),
                    (side * (hw + 0.4), U(0.285), 0.64), (side * (hw - 0.07), U(0.285), 0.64),
                ],
            )
        )
        # Intake in the rear quarter, just behind the side window.
        hw = half_width(0.69)
        vents.append(
            obox(f"QuarterIntake{side}", (side * (hw + 0.1), U(0.688), 0.9), across, (0, 1, -0.28), up, 0.2, 0.024, 0.13)
        )
        # Rear bumper vents behind the rear wheels.
        hw = half_width(0.955)
        vents.append(obox(f"RearVent{side}", (side * (hw + 0.1), U(0.958), 0.43), across, fwd, up, 0.16, 0.022, 0.12))
        # Slim blades above the front intake's outer corners.
        blades.append(obox(f"FrontBlade{side}", (side * 0.64, U(0.0) + 0.1, 0.405), across, fwd, up, 0.11, 0.2, 0.009))
    # The main front intake: a wide opening across the bumper.
    intake = obox("FrontIntake", (0.0, U(0.0) + 0.1, 0.27), across, fwd, up, 0.6, 0.23, 0.075)
    corners_ = [
        obox(f"CornerIntake{s}", (s * 0.75, U(0.0) + 0.08, 0.285), across, fwd, up, 0.09, 0.22, 0.07) for s in (1, -1)
    ]
    # Engine-lid louvres behind the rear glass.
    slats = []
    for i in range(9):
        u = U(0.852 + i * 0.0105)
        corners = [(x, uu, surface_h(body, x, uu)) for x, uu in ((-0.44, u + 0.009), (0.44, u + 0.009), (0.44, u - 0.009), (-0.44, u - 0.009))]
        slats.append(hexa(f"DeckSlat{i}", [(x, uu, h - 0.04) for x, uu, h in corners] + [(x, uu, h + 0.2) for x, uu, h in corners]))
    cut_many(body, nostrils + outlets + vents + blades + [intake] + corners_ + slats, "GrilleBlack")
    cut_many(body, louvres, "GrilleBlack")


def cut_panel_gaps(body):
    """Shut lines: doors, front lid, engine lid. Narrow slots a few millimetres wide."""
    gap = 0.0022

    def slot(name, a, b, depth_dir, reach=0.25):
        """A thin slab from a to b (model points), `reach` deep along depth_dir from the surface."""
        a, b, dd = Vector(a), Vector(b), Vector(depth_dir).normalized()
        run = (b - a)
        side = run.cross(dd).normalized()
        c = (a + b) / 2
        return obox(name, tuple(c), tuple(side), tuple(run.normalized()), tuple(dd), gap, run.length / 2, reach)

    for side in (1, -1):
        # Door: front edge, rear edge (drawn as a curve of short slots), on the flank.
        s = side
        top = belt(0.335) - 0.012
        cut(body, slot(f"DoorF{s}", (s * 0.95, U(0.334), 0.2), (s * 0.95, U(0.337), top), (s, 0, 0), 0.2), "PanelGap")
        pts = [(0.612, belt(0.612) - 0.01), (0.617, 0.72), (0.621, 0.52), (0.618, 0.34), (0.606, 0.2)]
        for i, ((x0, h0), (x1, h1)) in enumerate(zip(pts, pts[1:])):
            cut(body, slot(f"DoorR{s}{i}", (s * 0.95, U(x0), h0), (s * 0.95, U(x1), h1), (s, 0, 0), 0.2), "PanelGap")
        # Front lid sides, inboard of the lamps, and its front edge.
        lid = [(0.028, 0.47), (0.09, 0.53), (0.2, 0.555), (0.318, 0.575)]
        for i, ((x0, w0), (x1, w1)) in enumerate(zip(lid, lid[1:])):
            cut(body, slot(f"Lid{s}{i}", (s * w0, U(x0), 0.9), (s * w1, U(x1), 0.9), (0, 0, 1), 0.35), "PanelGap")
        # Engine lid sides.
        cut(body, slot(f"Deck{s}", (s * 0.5, U(0.835), 1.0), (s * 0.52, U(0.978), 1.0), (0, 0, 1), 0.3), "PanelGap")
    cut(body, slot("LidFront", (-0.47, U(0.028), 0.8), (0.47, U(0.028), 0.8), (0, 0.25, 1), 0.2), "PanelGap")


def classify_body(body, mats):
    tail_h = 0.80
    bisect(
        body,
        [
            ((0, 0, 0.235), (0, 0, 1)),
            ((0, 0, 0.56), (0, 0, 1)),
            ((0, 0, 0.345), (0, 0, 1)),
            ((0, 0, tail_h - 0.012), (0, 0, 1)),
            ((0, 0, tail_h + 0.012), (0, 0, 1)),
            ((0, 0, tail_h - 0.022), (0, 0, 1)),
            ((0, 0, tail_h + 0.022), (0, 0, 1)),
            ((0.62, 0, 0), (1, 0, 0)),
            ((-0.62, 0, 0), (1, 0, 0)),
        ],
    )

    def classify(cB, nB, current):
        x, u, h = to_model(cB)
        nx, nu, nh = to_model(nB)
        xf = xf_of(u)
        if nh < -0.6:
            return "UnderbodyBlack"
        # Black lower sills between the wheels.
        if 0.3 < xf < 0.69 and h < 0.235:
            return "Carbon"
        # Front: black air curtains outboard of the intake, a lip under it.
        if xf < 0.12 and h < 0.235:
            return "Carbon"
        # Rear: taillight band just below the ducktail lip, black bumper below.
        if xf > 0.93 and nu < -0.15:
            wide = abs(x) >= 0.62
            if abs(h - tail_h) < (0.022 if wide else 0.012):
                return "TailLightBar"
            if h < 0.56:
                return "TrimBlackPlastic"
        return current

    assign(body, classify, mats, CUTS)


# --- cabin ------------------------------------------------------------------------------
def build_greenhouse(mats):
    """Roof, pillars and glass: a painted shell with the windows cut out and glazed."""
    a, b = T["cowl"], T["backlight"]
    n = 70
    rings = []
    for i in range(n + 1):
        xf = a + (b - a) * i / n
        base_h = belt(xf) - 0.004
        roof_h = max(silhouette(xf), base_h + 0.004)
        rise = roof_h - base_h
        bw = base_half(xf)
        rw = min(roof_half(xf), bw - 0.01)
        pts = [
            (bw, base_h),
            (bw - 0.03 * (bw - rw), base_h + rise * 0.25),
            (bw - 0.18 * (bw - rw), base_h + rise * 0.55),
            (bw - 0.55 * (bw - rw), base_h + rise * 0.84),
            (rw, roof_h - 0.035 * min(1, rise / 0.25)),
            (rw * 0.9, roof_h - 0.02 * min(1, rise / 0.25)),
            (rw * 0.5, roof_h - 0.004),
            (0.0, roof_h),
        ]
        left = [(-x, h) for x, h in reversed(pts[:-1])]
        rings.append([B(x, U(xf), h) for x, h in pts + left])
    gh = loft("Greenhouse", rings, closed_ring=False, cap_ends=False)
    # Normals out, so the shell thickens inward.
    top = max(gh.data.polygons, key=lambda p: p.center.z)
    if top.normal.z < 0:
        gh.data.flip_normals()
    subdivide(gh, 2)
    gh.data.materials.append(mats["Paint"])

    # Window outlines.
    ws_lo, ws_hi = T["cowl"] + 0.006, T["roofFront"] - 0.004

    def ws_half(xf):
        f = (xf - T["cowl"]) / (T["roofFront"] - T["cowl"])
        return (base_half(xf) - 0.06) * (1 - f) + (roof_half(xf) - 0.035) * f

    def ws_outline(m=0.0):
        side = [(ws_half(ws_lo + (ws_hi - ws_lo) * i / 20) + m, U(ws_lo + (ws_hi - ws_lo) * i / 20)) for i in range(21)]
        side[0] = (side[0][0], side[0][1] + m)
        side[-1] = (side[-1][0], side[-1][1] - m)
        return side + [(-x, u) for x, u in reversed(side)]

    rw_lo, rw_hi = T["roofRear"] + 0.03, T["backlight"] - 0.014

    def rw_half(xf):
        return 0.72 * base_half(xf)

    def rw_outline(m=0.0):
        side = [(rw_half(rw_lo + (rw_hi - rw_lo) * i / 20) + m, U(rw_lo + (rw_hi - rw_lo) * i / 20)) for i in range(21)]
        side[0] = (side[0][0], side[0][1] + m)
        side[-1] = (side[-1][0], side[-1][1] - m)
        return side + [(-x, u) for x, u in reversed(side)]

    def dlo(m=0.0):
        """Side window outline in (u, h), grown by m."""
        a0 = T["cowl"] + 0.058
        a1 = T["roofFront"] + 0.012
        top = lambda xf: silhouette(xf) - 0.072
        bottom = lambda xf: belt(xf) + 0.014
        pts = []
        # Front edge, up the A-pillar.
        for i in range(8):
            f = i / 7
            xf = a0 + (a1 - a0) * f
            pts.append((xf - m, bottom(a0) + (top(a1) - bottom(a0)) * f))
        # Along the roof.
        for i in range(1, 13):
            xf = a1 + (0.69 - a1) * i / 12
            pts.append((xf, top(xf) + m))
        # Rounded rear down to the window line.
        for i in range(1, 11):
            t = (math.pi / 2) * i / 10
            xf = 0.69 + 0.085 * math.sin(t)
            pts.append((xf + m * math.sin(t), bottom(0.775) + (top(0.69) + m - bottom(0.775)) * math.cos(t)))
        # Back along the window line.
        for i in range(1, 10):
            xf = 0.775 + (a0 - 0.775) * i / 9
            pts.append((xf, bottom(xf) - m))
        return [(U(xf), h) for xf, h in pts]

    # Glass panes, shaped by the shell before it is opened: slightly larger than
    # the openings and a few millimetres inside, so the edges tuck under the frame.
    panes = []
    mm = 0.012 / L
    panes.append(pane_down(gh, "GlassWindscreen", ws_lo - mm, ws_hi + mm, lambda xf: ws_half(xf) + 0.012, mats["Glass"]))
    panes.append(pane_down(gh, "GlassRear", rw_lo - mm, rw_hi + mm, lambda xf: rw_half(xf) + 0.012, mats["Glass"]))
    for side in (1, -1):
        panes.append(pane_side(gh, f"GlassSide{side}", dlo(0.012), side, mats["Glass"]))

    def split(xf):
        if xf < T["roofFront"] + 0.02:
            return ws_half(min(xf, ws_hi)) + 0.03
        if xf > rw_lo - 0.02:
            return rw_half(max(xf, rw_lo)) + 0.05
        return roof_half(xf) - 0.02

    frames = [(ws_outline(), "h", None), (rw_outline(), "h", None), (dlo(), "x", 1), (dlo(), "x", -1)]
    for outline, axis, side in frames:
        open_window(gh, outline, axis, side, split)
    # Thickness after the openings are cut, so their edges get a frame.
    m = gh.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = 0.006
    m.offset = -1
    m.use_quality_normals = True
    apply_modifiers(gh)
    # A closed shell now: point every face outward. Browsers draw one side of
    # a face only, so an inward roof would be invisible from outside.
    bm = bmesh.new()
    bm.from_mesh(gh.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(gh.data)
    bm.free()

    # The rim the thickening leaves round each opening is the window frame:
    # faces whose every corner lies on an outline.
    frame = set()
    for p in gh.data.polygons:
        vs = [to_model(gh.data.vertices[i].co) for i in p.vertices]
        for outline, axis, side in frames:
            if all(window_edge_distance(v, outline, axis, side, split) < 0.0035 for v in vs):
                frame.add(p.index)
                break
    if "PianoBlack" not in [m.name for m in gh.data.materials]:
        gh.data.materials.append(mats["PianoBlack"])
    black = [m.name for m in gh.data.materials].index("PianoBlack")
    for i in frame:
        gh.data.polygons[i].material_index = black

    def classify(cB, nB, current):
        x, u, h = to_model(cB)
        if current == "PianoBlack":
            return current
        xf = xf_of(u)
        outward = Vector((x, 0.0, h - belt(xf) + 0.3))
        if to_model(nB) and Vector(to_model(nB)).dot(outward) < 0:
            return "Headliner"
        return current

    assign(gh, classify, mats)
    smooth(gh, 40)
    return [gh] + panes


# --- wheels ----------------------------------------------------------------------------
def lathe(name, profile, segments, centre, side, mat):
    """Closed surface of revolution about the axle (model x) through `centre`.

    profile: closed loop of (a, r), a measured outward from the wheel's centre plane.
    """
    cx, cu, ch = centre
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        rings.append([bm.verts.new(B(cx + side * a, cu + r * math.cos(t), ch + r * math.sin(t))) for a, r in profile])
    n = len(profile)
    for i in range(segments):
        A, Bn = rings[i], rings[(i + 1) % segments]
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((A[j], A[j2], Bn[j2], Bn[j]))
    ob = bm_object(name, bm, [mat])
    return ob


def build_wheel(tag, ua, track, tyre, rim_w_in, disc_r, mats, side):
    R = rolling_radius(tyre)
    rr = tyre[2] * 0.0254 / 2
    tw = tyre[0] / 1000
    rw = rim_w_in * 0.0254
    # Keep the tyre inside the body's widest point.
    cx = side * min(track / 2, W / 2 - tw / 2 - 0.012)
    c = (cx, ua, R)
    name = f"Wheel_{tag}{'R' if side > 0 else 'L'}"
    parts = []

    wall = R - rr
    tyre_prof = [
        (tw * 0.44, rr + 0.004),
        (tw * 0.49, rr + 0.02),
        (tw * 0.515, rr + wall * 0.45),
        (tw * 0.5, rr + wall * 0.8),
        (tw * 0.46, R - 0.01),
        (tw * 0.40, R - 0.001),
        (tw * 0.0, R),
        (-tw * 0.40, R - 0.001),
        (-tw * 0.46, R - 0.01),
        (-tw * 0.5, rr + wall * 0.8),
        (-tw * 0.515, rr + wall * 0.45),
        (-tw * 0.49, rr + 0.02),
        (-tw * 0.44, rr + 0.004),
        (0.0, rr + 0.01),
    ]
    parts.append(lathe(f"{name}_Tyre", tyre_prof, 96, c, side, mats["Tyre"]))

    rim_prof = [
        (rw / 2 + 0.004, rr + 0.016),
        (rw / 2 + 0.010, rr + 0.004),
        (rw / 2 + 0.006, rr - 0.014),
        (rw / 2 - 0.012, rr - 0.022),
        (-rw / 2 + 0.01, rr - 0.022),
        (-rw / 2, rr - 0.01),
        (-rw / 2, rr + 0.012),
        (0.0, rr + 0.004),
        (rw / 2 - 0.004, rr + 0.012),
    ]
    parts.append(lathe(f"{name}_Rim", rim_prof, 96, c, side, mats["WheelRim"]))

    # Ten forged spokes, dished toward the centre.
    face = rw / 2 - 0.012
    dish = 0.05 if tag == "F" else 0.075
    spokes = []
    for k in range(10):
        t0 = 2 * math.pi * k / 10
        rings = []
        for r in (0.075, 0.11, 0.15, 0.19, rr - 0.018):
            f = min(1.0, (r - 0.075) / (rr - 0.093))
            a = face - dish * (1 - f) ** 1.5
            half_w = 0.017 - 0.006 * f
            half_t = 0.018 - 0.006 * f
            ring = []
            for dw, dt in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                t = t0 + dw * half_w / r
                ring.append(B(cx + side * (a + dt * half_t), ua + r * math.cos(t), R + r * math.sin(t)))
            rings.append(ring)
        sp = loft(f"{name}_Spoke{k}", rings)
        spokes.append(sp)
    sp = join(f"{name}_Spokes", spokes)
    sp.data.materials.clear()
    sp.data.materials.append(mats["WheelRim"])
    bevel(sp, 0.004, 2)
    parts.append(sp)

    hub, _ = cylinder(f"{name}_Hub", (cx + side * (face - dish - 0.015), ua, R), (side, 0, 0), 0.09, -0.02, 0.02, 48)
    hub.data.materials.append(mats["WheelRim"])
    parts.append(hub)
    nut, _ = cylinder(f"{name}_LockNut", (cx + side * (face - dish + 0.01), ua, R), (side, 0, 0), 0.048, -0.02, 0.03, 12)
    nut.data.materials.append(mats["LockNut"])
    bevel(nut, 0.004, 2)
    parts.append(nut)

    disc, _ = cylinder(f"{name}_BrakeDisc", (cx - side * 0.035, ua, R), (side, 0, 0), disc_r, -0.017, 0.017, 96)
    disc.data.materials.append(mats["BrakeDisc"])
    parts.append(disc)

    # Caliper: a block wrapped round the front of the disc.
    rings = []
    for i in range(9):
        t = math.radians(-38 + 76 * i / 8)
        ring = []
        for a, r in ((-0.1, disc_r - 0.058), (0.03, disc_r - 0.058), (0.03, disc_r + 0.022), (-0.1, disc_r + 0.022)):
            ring.append(B(cx - side * 0.035 + side * a, ua + r * math.cos(t), R + r * math.sin(t)))
        rings.append(ring)
    cal = loft(f"{name}_Caliper", rings)
    cal.data.materials.append(mats["Caliper"])
    bevel(cal, 0.01, 3)
    parts.append(cal)

    for p in parts:
        smooth(p, 40)
    return parts


# --- aero, mirrors, rear ------------------------------------------------------------------
def airfoil(chord, thickness=0.11, n=16):
    """Inverted cambered section: (s along chord from the leading edge, y up), closed loop."""
    pts = []
    for i in range(n + 1):
        s = 0.5 - 0.5 * math.cos(math.pi * i / n)
        t = thickness * 5 * (0.2969 * math.sqrt(s) - 0.126 * s - 0.3516 * s**2 + 0.2843 * s**3 - 0.1036 * s**4)
        camber = -0.05 * (1 - (2 * s - 1) ** 2)  # bows downward: downforce
        pts.append((s, camber + t * 0.35, camber - t * 0.65))
    upper = [(s * chord, yu * chord) for s, yu, _ in pts]
    lower = [(s * chord, yl * chord) for s, _, yl in reversed(pts[1:-1])]
    return upper + lower


def wing_element(name, le, chord, angle, span, mat):
    """Wing element: leading edge at (u, h) le, trailing edge raised by `angle`."""
    prof = airfoil(chord)
    ca, sa = math.cos(angle), math.sin(angle)
    rings = []
    for i in range(9):
        x = -span / 2 + span * i / 8
        ring = []
        for s, y in prof:
            u = le[0] - (s * ca + y * sa)
            h = le[1] + s * sa + y * ca
            ring.append(B(x, u, h))
        rings.append(ring)
    ob = loft(name, rings)
    ob.data.materials.append(mat)
    smooth(ob, 30)
    return ob


def prism(name, poly, x0, thickness, mat):
    """A flat plate: polygon in (u, h), extruded across the car."""
    bm = bmesh.new()
    a = [bm.verts.new(B(x0 - thickness / 2, u, h)) for u, h in poly]
    b = [bm.verts.new(B(x0 + thickness / 2, u, h)) for u, h in poly]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    ob = bm_object(name, bm, [mat])
    return ob


def build_wing(body, mats):
    span = 1.78
    main_le = (U(0.868), 1.195)
    main_c, main_a = 0.40, math.radians(8)
    flap_c, flap_a = 0.22, math.radians(26)
    te_u = main_le[0] - main_c * math.cos(main_a)
    te_h = main_le[1] + main_c * math.sin(main_a)
    flap_le = (te_u + 0.045, te_h - 0.01)
    parts = [
        wing_element("WingMainCarbon", main_le, main_c, main_a, span, mats["Carbon"]),
        wing_element("WingFlapCarbon", flap_le, flap_c, flap_a, span - 0.02, mats["Carbon"]),
    ]
    flap_te = (flap_le[0] - flap_c * math.cos(flap_a), flap_le[1] + flap_c * math.sin(flap_a))
    # End plates.
    plate = [
        (main_le[0] + 0.03, main_le[1] - 0.05),
        (main_le[0] - 0.05, main_le[1] + 0.045),
        (flap_te[0] + 0.03, flap_te[1] + 0.02),
        (flap_te[0] - 0.02, flap_te[1] - 0.01),
        (flap_te[0] - 0.02, main_le[1] - 0.1),
    ]
    for side in (1, -1):
        p = prism(f"WingEndplate{side}", plate, side * (span / 2 + 0.004), 0.008, mats["Carbon"])
        bevel(p, 0.002, 1)
        parts.append(p)

    # Swan necks: rise ahead of the wing, hook over and hold it from above.
    def top_at(f):
        s = f * main_c
        y = max(yy for ss, yy in airfoil(main_c) if abs(ss - s) < main_c * 0.08)
        return (main_le[0] - (s * math.cos(main_a) + y * math.sin(main_a)), main_le[1] + s * math.sin(main_a) + y * math.cos(main_a))

    for side in (1, -1):
        x = side * 0.33
        u0, u1 = U(0.852), U(0.895)
        h0 = min(surface_h(body, x, u0), surface_h(body, x, u1)) - 0.02
        e, f = top_at(0.55), top_at(0.25)
        poly = [
            (u0, h0),
            (u0 + 0.012, h0 + 0.16),
            (main_le[0] + 0.035, main_le[1] + 0.06),
            (main_le[0] - 0.06, main_le[1] + 0.09),
            (e[0], e[1] + 0.012),
            (e[0], e[1] - 0.006),
            (f[0], f[1] - 0.006),
            (main_le[0] - 0.02, main_le[1] + 0.02),
            (u1 + 0.02, h0 + 0.14),
            (u1, h0),
        ]
        p = prism(f"SwanNeckCarbon{side}", poly, x, 0.016, mats["Carbon"])
        bevel(p, 0.003, 2)
        parts.append(p)
    return parts


def build_mirrors(body, mats):
    parts = []
    for side in (1, -1):
        c = Vector((side * 0.835, U(0.418), 1.0))
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
        # Teardrop head: rounded nose, a flat back holding the glass.
        for v in bm.verts:
            x, y, z = v.co
            if y > 0:  # Blender +y is rearward
                y *= 0.35
            v.co = Vector((x * 0.085, y * 0.095, z * 0.055))
        bmesh.ops.translate(bm, verts=bm.verts, vec=B(*c))
        head = bm_object(f"MirrorPaint{side}", bm, [mats["Paint"]])
        smooth(head, 60)
        parts.append(head)
        glass, _ = cylinder(f"MirrorChrome{side}", (c.x, c.y - 0.03, c.z), (0, -1, 0), 1.0, 0.0, 0.002, 48)
        glass.scale = (1, 1, 1)
        for v in glass.data.vertices:
            v.co.x = c.x + (v.co.x - c.x) * 0.078
            v.co.z = c.z + (v.co.z - c.z) * 0.048
        glass.data.materials.append(mats["MirrorChrome"])
        parts.append(glass)
        # Stalk down to the door top.
        root = Vector((side * 0.73, U(0.428), belt(0.43) - 0.01))
        tip = c + Vector((-side * 0.04, 0.0, -0.035))
        d = tip - root
        st, _ = cylinder(f"MirrorStalkPianoBlack{side}", tuple(root), tuple(d), 0.013, 0.0, d.length, 16)
        st.data.materials.append(mats["PianoBlack"])
        st.scale = (1, 1, 1)
        parts.append(st)
    return parts


def build_rear(body, mats):
    parts = []
    # Twin centre exhausts.
    for side in (1, -1):
        c = (side * 0.07, U(0.997), 0.31)
        pipe = lathe(
            f"ExhaustTitanium{side}",
            [(0.0, 0.047), (0.0, 0.041), (-0.25, 0.041), (-0.25, 0.047)],
            48,
            (c[0], c[1], c[2]),
            1,
            mats["ExhaustTitanium"],
        )
        # The lathe spins about x; turn it to run along the car.
        pipe.rotation_euler = (0, 0, math.pi / 2)
        pipe.location = B(*c)
        for v in pipe.data.vertices:
            v.co = v.co - B(*c)
        bpy.context.view_layer.objects.active = pipe
        pipe.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        pipe.select_set(False)
        smooth(pipe, 50)
        parts.append(pipe)
        cap, _ = cylinder(f"ExhaustInner{side}", (c[0], c[1] + 0.03, c[2]), (0, 1, 0), 0.041, -0.003, 0.003, 32)
        cap.data.materials.append(mats["ExhaustInner"])
        parts.append(cap)

    # Diffuser strakes under the tail.
    for x in (-0.52, -0.32, 0.32, 0.52):
        poly = [(U(0.9), 0.15), (U(0.99), 0.13), (U(0.99), 0.24), (U(0.9), 0.2)]
        p = prism(f"DiffuserCarbon{x:+.2f}", poly, x, 0.008, mats["Carbon"])
        parts.append(p)

    # Front splitter.
    rings = []
    pts = []
    for i in range(25):
        xf = 0.12 * i / 24
        pts.append((0.93 * half_width(xf), U(xf) + 0.02 * (1 - xf / 0.12)))
    outline = [(-x, u) for x, u in reversed(pts)] + pts
    for h in (0.155, 0.17):
        rings.append([B(x, u, h) for x, u in outline])
    bm = bmesh.new()
    lo = [bm.verts.new(p) for p in rings[0]]
    hi = [bm.verts.new(p) for p in rings[1]]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(len(lo)):
        j = (i + 1) % len(lo)
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    parts.append(bm_object("SplitterCarbon", bm, [mats["Carbon"]]))

    # Raised fins on the inboard side of each bonnet nostril.
    for side in (1, -1):
        x = side * 0.125
        u0, u1 = U(0.168), U(0.085)
        h0, h1 = surface_h(body, x, u0), surface_h(body, x, u1)
        poly = [(u1, h1 - 0.08), (u1, h1 + 0.004), (u0 + 0.04, h0 + 0.075), (u0, h0 + 0.06), (u0, h0 - 0.08)]
        fin = prism(f"NostrilFinCarbon{side}", poly, x, 0.012, mats["GrilleBlack"])
        bevel(fin, 0.003, 2)
        parts.append(fin)
    # Mesh behind the front intake.
    mesh, _ = obox("FrontIntakeGrille", (0.0, U(0.0) - 0.05, 0.27), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.6, 0.004, 0.075)
    mesh.data.materials.append(mats["GrilleBlack"])
    parts.append(mesh)

    # PORSCHE across the tail, under the light.
    parts.append(lettering("PORSCHE", (0.0, None, 0.765), 0.034, 0.19, body, mats["PianoBlack"]))

    # Black lower bumper round the diffuser and exhausts.
    val, _ = hexa(
        "RearValanceTrimBlack",
        [
            (-0.8, U(0.878), 0.15), (0.8, U(0.878), 0.15), (0.78, U(0.99), 0.22), (-0.78, U(0.99), 0.22),
            (-0.82, U(0.878), 0.5), (0.82, U(0.878), 0.5), (0.8, U(0.99), 0.5), (-0.8, U(0.99), 0.5),
        ],
    )
    bevel(val, 0.03, 3)
    val.data.materials.append(mats["TrimBlackPlastic"])
    smooth(val, 40)
    parts.append(val)
    return parts


def lettering(text, where, height, spacing_width, body, mat):
    """Chrome letters standing on the rear face."""
    cu = bpy.data.curves.new(text, "FONT")
    cu.body = text
    cu.size = height * 1.35
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.0015
    cu.space_character = 2.2
    ob = new_object(f"Badge{text}", cu)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    ob = new_object(f"Badge{text}", me)
    x, _, h = where
    hit = ray(body, (x, -L, h), (0, 1, 0))
    u = hit[0][1] + 0.002
    # Text is built in the x-y plane; stand it up facing rearward.
    ob.rotation_euler = (math.pi / 2, 0, math.pi)
    ob.location = B(x, u, h)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.select_set(False)
    ob.data.materials.append(mat)
    return ob


# --- interior ---------------------------------------------------------------------------
def build_interior(mats):
    parts = []

    def block(name, c, size, mat, lean=0.0, round_=0.02):
        ob, _ = obox(name, c, (1, 0, 0), (0, math.cos(lean), -math.sin(lean)), (0, math.sin(lean), math.cos(lean)), *size)
        ob.data.materials.append(mat)
        bevel(ob, round_, 3)
        smooth(ob, 50)
        return ob

    # Carbon buckets: shell, cushion, red accent.
    for side in (1, -1):
        x = side * 0.36
        parts.append(block(f"SeatCarbon{side}", (x, U(0.585), 0.74), (0.26, 0.05, 0.36), mats["Carbon"], math.radians(-22), 0.04))
        parts.append(block(f"SeatLeatherBack{side}", (x, U(0.575), 0.74), (0.2, 0.03, 0.32), mats["SeatLeather"], math.radians(-22), 0.03))
        parts.append(block(f"SeatLeatherCushion{side}", (x, U(0.52), 0.45), (0.21, 0.2, 0.05), mats["SeatLeather"], 0.0, 0.03))
        parts.append(block(f"SeatAccent{side}", (x, U(0.57), 0.93), (0.05, 0.02, 0.06), mats["SeatAccent"], math.radians(-22), 0.01))
    # Dashboard and centre tunnel.
    parts.append(block("DashAlcantara", (0.0, U(0.39), 0.78), (0.68, 0.1, 0.07), mats["InteriorAlcantara"], 0.0, 0.04))
    parts.append(block("TunnelAlcantara", (0.0, U(0.47), 0.5), (0.1, 0.16, 0.12), mats["InteriorAlcantara"], 0.0, 0.03))
    # Steering wheel, left-hand drive.
    ring = lathe(
        "SteeringWheelAlcantara",
        [(0.012, 0.18), (0.0, 0.195), (-0.012, 0.18), (0.0, 0.165)],
        48,
        (0, 0, 0),
        1,
        mats["InteriorAlcantara"],
    )
    ring.rotation_euler = (math.radians(-18), 0, math.pi / 2)
    ring.location = B(-0.36, U(0.445), 0.86)
    parts.append(ring)
    # Clubsport half cage behind the seats.
    hoop = []
    for i in range(13):
        t = math.pi * i / 12
        hoop.append((0.62 * math.cos(t), U(0.635) - 0.03 * math.sin(t), 0.45 + 0.66 * math.sin(t) ** 0.6))
    tubes = list(zip(hoop, hoop[1:]))
    tubes += [
        (hoop[1], (0.5, U(0.76), 0.6)),
        (hoop[-2], (-0.5, U(0.76), 0.6)),
        (hoop[3], (-0.55, U(0.64), 0.5)),
    ]
    for i, (p, q) in enumerate(tubes):
        d = Vector(q) - Vector(p)
        t, _ = cylinder(f"CageBlack{i}", p, tuple(d), 0.02, 0.0, d.length, 16)
        t.data.materials.append(mats["CageBlack"])
        smooth(t, 60)
        parts.append(t)
    return parts


def cut_many(body, made, material_name):
    """Subtract several cutters in one boolean (they must not overlap each other)."""
    obs = [ob for ob, _ in made]
    ob = join("Cutter", obs) if len(obs) > 1 else obs[0]
    boolean(body, ob)
    bpy.data.objects.remove(ob)
    for _, test in made:
        CUTS.append((test, material_name))


def bisect(ob, planes):
    """Split the mesh along planes (model point, model normal) so material edges run clean."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=B(*co), plane_no=dirB(*no))
    bm.to_mesh(ob.data)
    bm.free()


def _window_2d(p, axis):
    x, u, h = p
    return (x, u) if axis == "h" else (u, h)


def _window_local(p, axis, side, split):
    """Is this point on the part of the shell a window outline applies to?

    split(xf) is the half-width dividing the glass seen from above (windscreen,
    rear window) from the side glass, down the middle of the pillars.
    """
    x, u, h = p
    if axis == "h":
        return h > 0.8 and abs(x) < split(xf_of(u))
    return x * side > split(xf_of(u))


def _inside(q, outline):
    inside = False
    n = len(outline)
    for i in range(n):
        (x1, y1), (x2, y2) = outline[i], outline[(i + 1) % n]
        if (y1 > q[1]) != (y2 > q[1]) and q[0] < x1 + (q[1] - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def window_edge_distance(p, outline, axis, side, split):
    if not _window_local(p, axis, side, split):
        return 1e9
    q = Vector(_window_2d(p, axis))
    best = 1e9
    n = len(outline)
    for i in range(n):
        p1, p2 = Vector(outline[i]), Vector(outline[(i + 1) % n])
        d = p2 - p1
        t = max(0.0, min(1.0, (q - p1).dot(d) / max(d.length_squared, 1e-12)))
        best = min(best, (q - (p1 + d * t)).length)
    return best


def triangulate_ngons(bm):
    """Split faces of more than four sides properly here, rather than leave the
    exporter to fan-triangulate them: slicing and booleans leave concave ones,
    and a fan across a concave face folds over and shades as a dark notch."""
    ngons = [f for f in bm.faces if len(f.verts) > 4]
    if ngons:
        bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")


def triangulate_object(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    triangulate_ngons(bm)
    bm.to_mesh(ob.data)
    bm.free()


def open_window(ob, outline, axis, side, split):
    """Cut an opening in a thin shell: slice it along the outline, then drop the faces inside.

    outline is 2D: plan (x, u) for glass seen from above, side (u, h) for side
    windows. Only the part of the shell the window is on is touched.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = len(outline)
    for i in range(n):
        p1, p2 = Vector(outline[i]), Vector(outline[(i + 1) % n])
        d = p2 - p1
        if d.length < 1e-6:
            continue
        n2 = Vector((-d.y, d.x)).normalized()
        if axis == "h":
            co, no = (p1.x, p1.y, 0.0), (n2.x, n2.y, 0.0)
        else:
            co, no = (0.0, p1.x, p1.y), (0.0, n2.x, n2.y)
        lo = Vector((min(p1.x, p2.x) - 0.08, min(p1.y, p2.y) - 0.08))
        hi = Vector((max(p1.x, p2.x) + 0.08, max(p1.y, p2.y) + 0.08))
        faces = []
        for f in bm.faces:
            for v in f.verts:
                c = to_model(v.co)
                q = _window_2d(c, axis)
                if lo.x <= q[0] <= hi.x and lo.y <= q[1] <= hi.y and _window_local(c, axis, side, split):
                    faces.append(f)
                    break
        if not faces:
            continue
        edges = {e for f in faces for e in f.edges}
        verts = {v for f in faces for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, plane_co=B(*co), plane_no=dirB(*no))
    drop = []
    for f in bm.faces:
        c = to_model(f.calc_center_median())
        # Seen from the side, the top of the A-pillar overlaps the side-window
        # outline; only faces that face sideways are side glass.
        facing = axis == "h" or to_model(f.normal)[0] * side > 0.25
        if facing and _window_local(c, axis, side, split) and _inside(_window_2d(c, axis), outline):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    # Slicing leaves slivers along the edge; thickened, they would stick out as teeth.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0008)
    triangulate_ngons(bm)
    bm.to_mesh(ob.data)
    bm.free()


def pane_down(shell, name, xf0, xf1, half, mat, n=26):
    """A pane on the shell's surface between xf0 and xf1, `half(xf)` wide, found by casting down onto it."""
    grid = []
    for i in range(n + 1):
        xf = xf0 + (xf1 - xf0) * i / n
        row = []
        for j in range(n + 1):
            x = half(xf) * (-1 + 2 * j / n)
            hit = ray(shell, (x, U(xf), 3.0), (0, 0, -1))
            row.append(None if not hit else B(hit[0][0], hit[0][1], hit[0][2] - 0.003))
        grid.append(row)
    return grid_object(name, grid, mat)


def pane_side(shell, name, outline, side, mat, n=26):
    """A side pane under an outline in (u, h), found by casting in from the side."""
    hs = [p[1] for p in outline]
    h0, h1 = min(hs), max(hs)
    grid = []
    for i in range(n + 1):
        h = h0 + (h1 - h0) * i / n
        # Extent of the outline along u at this height.
        us = []
        m = len(outline)
        for k in range(m):
            (ua, ha), (ub, hb) = outline[k], outline[(k + 1) % m]
            if (ha - h) * (hb - h) <= 0 and ha != hb:
                us.append(ua + (h - ha) * (ub - ua) / (hb - ha))
        if len(us) < 2:
            grid.append([None] * (n + 1))
            continue
        ua, ub = min(us), max(us)
        row = []
        for j in range(n + 1):
            u = ua + (ub - ua) * j / n
            hit = ray(shell, (side * 3.0, u, h), (-side, 0, 0))
            row.append(None if not hit else B(hit[0][0] - side * 0.003, hit[0][1], hit[0][2]))
        grid.append(row)
    return grid_object(name, grid, mat)


def grid_object(name, grid, mat):
    bm = bmesh.new()
    vs = [[bm.verts.new(p) if p is not None else None for p in row] for row in grid]
    for i in range(len(vs) - 1):
        for j in range(len(vs[i]) - 1):
            q = (vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j])
            if all(v is not None for v in q):
                bm.faces.new(q)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    ob = bm_object(name, bm, [mat])
    smooth(ob, 80)
    return ob


# --- build ------------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main(out):
    import time

    t0 = time.time()
    reset()
    mats = make_materials()
    body, lamps = build_body(mats)
    print(f"body {time.time() - t0:.1f}s, {len(body.data.polygons)} faces")
    build_greenhouse(mats)
    for side in (1, -1):
        build_wheel("F", U_FA, TRACK_F, TYRE_F, 10, 0.204, mats, side)
        build_wheel("R", U_RA, TRACK_R, TYRE_R, 13, 0.190, mats, side)
    build_wing(body, mats)
    build_mirrors(body, mats)
    build_rear(body, mats)
    build_interior(mats)
    print(f"built {time.time() - t0:.1f}s")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_apply=True)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[-1] if sys.argv[-1].endswith(".glb") else os.path.join(HERE, "gt3rs.glb"))
