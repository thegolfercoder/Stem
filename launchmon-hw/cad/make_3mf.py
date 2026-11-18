"""Bambu Lab plates: pack the print-oriented STLs onto a 256 x 256 mm bed, one 3MF per plate.

    python3 make_3mf.py stl bambu

One plate per material and per option, so each opens in Bambu Studio ready to
slice: the parts are already in their print orientation (no supports anywhere),
so only the filament profile is set there. Run it after export_stl.sh.
"""
import struct, sys, zipfile
from pathlib import Path
import numpy as np

STL = Path(sys.argv[1]); OUT = Path(sys.argv[2])
BED, GAP = 256.0, 8.0

def load(name):
    d = (STL / name).read_bytes(); n = struct.unpack_from('<I', d, 80)[0]
    tri = np.frombuffer(d, dtype=np.dtype([('n','<f4',3),('v','<f4',(3,3)),('a','<u2')]), count=n, offset=84)['v'].astype(np.float64)
    v, idx = np.unique(np.round(tri.reshape(-1, 3), 5), axis=0, return_inverse=True)
    f = idx.reshape(-1, 3)
    f = f[(f[:,0]!=f[:,1]) & (f[:,1]!=f[:,2]) & (f[:,0]!=f[:,2])]
    v = v - [v[:,0].min(), v[:,1].min(), v[:,2].min()]
    return v, f

def pack(items):
    items = sorted(items, key=lambda it: -it[1][0][:,1].max())
    x = y = shelf = 0.0; placed = []
    for name, (v, f) in items:
        w, d = v[:,0].max(), v[:,1].max()
        if x + w > BED - 2*GAP:
            x, y, shelf = 0.0, y + shelf + GAP, 0.0
        placed.append((name, v, f, x, y)); x += w + GAP; shelf = max(shelf, d)
    W = max(p[3] + p[1][:,0].max() for p in placed); D = max(p[4] + p[1][:,1].max() for p in placed)
    if W > BED or D > BED: raise SystemExit(f'does not fit: {W:.0f} x {D:.0f}')
    ox, oy = (BED - W)/2, (BED - D)/2
    return [(n, v, f, x+ox, y+oy) for n, v, f, x, y in placed]

def write(path, plate):
    objs, build = [], []
    for i, (name, v, f, x, y) in enumerate(plate, 1):
        vs = ''.join(f'<vertex x="{a:.5f}" y="{b:.5f}" z="{c:.5f}"/>' for a, b, c in v)
        ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in f)
        objs.append(f'<object id="{i}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>')
        build.append(f'<item objectid="{i}" transform="1 0 0 0 1 0 0 0 1 {x:.3f} {y:.3f} 0"/>')
    model = ('<?xml version="1.0" encoding="UTF-8"?>'
             '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             '<metadata name="Title">' + path.stem + '</metadata>'
             '<resources>' + ''.join(objs) + '</resources><build>' + ''.join(build) + '</build></model>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr('3D/3dmodel.model', model)
    print(f'{path.name}: ' + ', '.join(n for n, *_ in plate))

PLATES = {
  # The kit: print these.
  'Stem_ground_unit_black_PETG.3mf': ['ground_radar_shell.stl', 'ground_radar_lid.stl', 'ground_radar_dock_base.stl',
                                      'ground_radar_arm_slide.stl', 'ground_radar_arm_swivel.stl',
                                      'ground_radar_arm_head_magsafe.stl', 'ground_radar_arm_pin.stl',
                                      ('ground_radar_esp32_clamp_tab_x2.stl', 2)],
  'Stem_ground_unit_translucent_PETG.3mf': ['ground_radar_radome.stl', 'ground_radar_led_pipe.stl'],
  'Stem_club_pod_black_PETG.3mf': ['shaft_pod_base.stl', 'shaft_pod_lid.stl'],
  'Stem_club_pod_strap_TPU95A.3mf': [('shaft_pod_strap_TPU.stl', 2)],
  # Instead of the MagSafe head, for a phone without MagSafe.
  'Stem_clamp_head_option_black_PETG.3mf': ['ground_radar_arm_head_clamp.stl', 'ground_radar_arm_clamp_jaw.stl'],
  # Print first: about 15 minutes, tests the arm's and the strap's fits on your printer.
  'Stem_fit_coupon_PRINT_FIRST_PETG.3mf': ['ground_radar_arm_fit_coupon.stl', 'shaft_pod_strap_fit_coupon_post.stl'],
  'Stem_fit_coupon_PRINT_FIRST_TPU95A.3mf': ['shaft_pod_strap_fit_coupon_latch_TPU.stl'],
}
OUT.mkdir(parents=True, exist_ok=True)
for out, parts in PLATES.items():
    items = []
    for p in parts:
        name, qty = (p if isinstance(p, tuple) else (p, 1))
        mesh = load(name)
        for k in range(qty):
            items.append((name.replace('.stl', '') + (f' #{k+1}' if qty > 1 else ''), mesh))
    write(OUT / out, pack(items))
