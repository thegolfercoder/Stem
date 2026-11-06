// =============================================================================
//  Stem launch monitor - CLUB-MOUNTED MOTION POD enclosure
//  OpenSCAD 2021.01 or newer.  All dimensions in millimetres.
// =============================================================================
//
//  Body 32 x 26 x 14 mm with rounded edges, and a snap-on C-clamp underneath
//  for a 13.0 mm golf shaft section.
//
//  COORDINATES - these are the pod's reference axes. The IMU is held
//  coplanar to them and the firmware reports in them.
//      +X  along the shaft, toward the clubhead. The USB-C port faces -X,
//          up the shaft toward the grip, away from turf and the clubhead.
//      +Y  across the shaft
//      +Z  away from the shaft (out of the lid)
//  The clamp bore's axis is parallel to X. The floor the IMU sits on is the
//  datum plane, parallel to X/Y. The pocket walls are parallel to X and Y.
//
//  STACK (inside the body, from the floor up)
//      floor (datum)  1.2
//      IMU breakout   1.6 PCB + 1.2 parts        <- STEMMA QT sockets removed
//      LiPo           3.0  (302020 class, ~100 mAh) with the charger beside it
//      foam           0.5
//      ESP32-C3 SuperMini, USB-C at the -X wall
//      lid            1.2
//  The Adafruit breakouts are 25.4 x 17.8 mm (1.0" x 0.7"), not 18 x 18, so
//  the pocket follows the real board. Their two STEMMA QT sockets add 1.75 mm.
//  Set `imu_stemma_fitted = true` to keep them, and fit_report() gives the body
//  height that needs; 14 mm is not enough. Wires on the 0.1" pads are just as good.
//
//  DESIGN (../docs/design_language.md says why)
//  It shares the ground unit's finish and details: matte black, soft edges, a
//  shadow gap at the seam, one debossed mark. The mark is functional: the
//  arrow on the lid points to the clubhead, the pod's +X axis. Between the two
//  jaws a saddle follows the shaft, so the pod reads as one form on the club.
//
//  The clamp is a C, wrapping 230 degrees, with a recessed band for a
//  0.8 mm silicone or neoprene liner. The liner stands 0.2 mm proud and grips.
//  A zip-tie tunnel and an outside groove on each jaw take a tie that closes
//  the C. FIT THE TIE: at clubhead speed a pod that comes loose is a
//  projectile. The clamp alone is not enough to rely on.
//
//  POD PARK
//  The pod parks on the ground unit, +X end up in a hood on the unit's lid
//  (script_ground_radar.scad, "pod_park"), and charges from it there. Two
//  brass contacts stand in its +X end face, the end the arrow points to, with
//  a hidden 4 x 2 mm magnet either side. The magnets pull the pod up into the
//  hood against the hood's spring pins. The contacts are wired to the
//  SuperMini's 5V and GND (through D2: docs/wiring_schematic.md, "dock
//  contacts"). "Park", not "dock": the dock is the radar unit's stand.
//
//  PRINTED PARTS (set `part`):
//      "base"      body + clamp   (print standing on the USB end, bore vertical)
//      "lid"       snap-on lid    (print flat, outside face down)
//      "strap"     reusable strap, TPU 95A (print flat, outer face down; sized from shaft_d)
//      "assembly"  both, with ghost components
//      "section"   2D cut across the shaft, through the jaw
// =============================================================================

/* [Render] */
part            = "assembly";   // [assembly, base, lid, strap, section, print_plate]
// Also: "in_place:base|lid" and "ghost:<name>" export one part in its
// assembled position (used by cad/blender/).
show_components = true;
explode         = 0;            // [0:1:20]
$fn             = 64;

/* [Body] */
pod         = [32, 26, 14];     // [X along shaft, Y across, Z height]
edge_r      = 3.0;              // rounded edges and corners
wall        = 1.6;              // side walls
floor_t     = 1.2;              // floor = IMU datum plane
lid_t       = 1.2;
lip_h       = 1.5;              // lid lip depth into the base
lip_w       = 0.8;
fit_clear   = 0.15;
snap_bump   = 0.35;             // lid snap bump height

/* [IMU - Adafruit LSM6DS3TR-C (#4503) / LSM6DSOX (#4438)] */
imu_pcb     = [25.4, 17.8, 1.6];
imu_parts_h = 1.2;              // tallest part with STEMMA QT sockets removed
imu_stemma_fitted = false;      // true = sockets kept (2.95 mm tall)
imu_fence_h = 2.0;              // pocket wall height above the floor
imu_fence_t = 1.0;
imu_clear   = 0.15;             // per side, before crush ribs

/* [Power and MCU] */
batt        = [20.0, 20.0, 3.0];  // [X, Y, thickness]; 302020 ~100 mAh. 402020 (~150 mAh) needs 1 mm more height
chg         = [7.5, 12.0, 3.0];   // micro charger board (MCP73831/TP4054 class)
foam_t      = 0.5;
esp_pcb     = [22.52, 18.0, 1.0];
esp_usb     = [8.94, 3.26];       // USB-C receptacle [width, height]
esp_usb_overhang = 0.5;           // receptacle nose past the PCB edge
esp_antenna = 4.0;                // ceramic antenna zone at the far end of the board

/* [Clamp] */
shaft_d     = 13.0;               // printed bore = nominal shaft diameter
jaw_t       = 2.2;                // C wall thickness (sets snap force)
wrap_deg    = 230;                // how far the C wraps; the rest is the mouth
jaw_w       = 10.0;               // width of each jaw along X
web         = 3.2;                // material between the bore and the body floor
liner_t     = 0.8;                // liner strip thickness
liner_proud = 0.2;                // how far the liner stands above the bore
tie_w       = 3.0;                // zip-tie slot width (2.5 mm ties)
tie_h       = 1.6;
saddle_clear = 0.6;               // between the jaws the underside follows the shaft at this gap

/* [Strap - reusable TPU 95A strap, in place of the zip ties] */
// One strap round the middle of the pod: from a hook post on one side face,
// round the body's lower edge, under the shaft between the jaws, and up to the
// same post on the other side. It holds the shaft up in the C, so the shaft
// cannot leave through the mouth without stretching the strap. Both ends are
// the same: a slot that hooks over the post, and a tab with a lift ridge.
// Its length comes from shaft_d, so it follows the bore. The tie tunnels and
// grooves stay, so zip ties still work as a fallback.
strap_w       = 8.0;   // across the strap (along X), centred between the jaws
strap_t       = 1.0;   // five 0.20 mm layers of TPU
strap_preload = 0.08;  // stretch with the shaft in: 8 % of TPU 95A (E about 26 MPa) is about 17 N per leg
strap_tab     = 4.5;   // tab beyond each slot's bearing edge
strap_ridge   = [1.2, 0.8];  // lift ridge across each tab's tip, on the inner face [width, height]
strap_clear   = 0.2;   // slot over the post, and the saddle cut clear of the strap
// Hook post on each side face: a shank and a head with a lip above and below it.
// The strap's slot bears on the shank's top; the upper lip covers that edge, the
// lower lip is the click (the slot is shorter than the head).
strap_post_z  = 5.6;   // shank centre above the floor's underside
strap_post    = [2.4, 2.0, 1.0, 0.6, 1.0];  // [shank width X at its outer end, shank height Z,
                       //  upper lip (engagement), lower lip (detent), head thickness]

/* [Pod park - charging contacts in the +X end face] */
pod_park_pitch = 6.0;  // contact centres across the end face (Y), either side of the centre line
pod_park_z     = 8.8;  // contact and magnet centres above the floor's underside: over the charger, under the lid lip.
                       // 8.8 keeps the heads 0.3 mm inside the end face's flat (fit report) and the magnets 0.45 under the lip
// Contacts: M2 x 4 brass cheese-head screws (DIN 84), threaded into the end wall
// and glued, wire soldered to the tip inside. MEASURE THE ONES YOU BUY.
pod_park_pad   = [3.8, 1.3, 4.0, 1.7]; // [head d, head height (= how far it stands proud), length under the head, pilot d]
pod_park_mag   = [4.0, 2.0];  // N52 disc magnet [d, t]. 6 x 2 mm does not fit behind the end wall: fit_report()
pod_park_mag_y = 4.65;        // magnet centres in from each side face: 0.3 mm from the charger, 0.4 mm of web to the hood's wells
pod_park_mag_clear = 0.1;     // magnet pocket diameter over the magnet. Printed with its axis vertical, the 0.4 mm
                              // skin bridged over it: the fit test coupon's "POD" pockets (0 / +0.1) tell you this

pod_park_skin  = 0.4;         // plastic over the magnets: two layers. Its fit-report line (thinnest skin - 0.3)
                              // cannot pass 0.1: the skin is two layers by design, every extra layer costs pull
// Two 4 x 2 mm N52 pairs, 0.4 mm apart, pull about 3.7 N each (coaxial-loop
// model, Br 1.43 T): 7 N against about 1 N from the two pins and 0.15 N of pod.
// The LSM6DS3TR-C / LSM6DSOX have no magnetometer, so the magnets do not
// disturb them. Do not fit a 9-axis IMU with a magnetometer.
pod_park_diode = [3.7, 1.6, 1.2];  // D2 (SOD-123 / SOD-323) beside the DOCK+ contact [X, Y, Z]

/* [Surface details] */
mark_depth  = 0.4;                // debossed arrow on the lid: two layers at 0.20 mm
reveal      = [0.3, 0.5];         // shadow gap at the lid seam [depth, height]

// ----------------------------------------------------------------------------
//  Derived values
// ----------------------------------------------------------------------------
in_x  = pod[0] - 2 * wall;          // 28.8
in_y  = pod[1] - 2 * wall;          // 22.8
in_r  = max(0.5, edge_r - wall);
base_h = pod[2] - lid_t;            // split line (12.8)

imu_h   = imu_pcb[2] + (imu_stemma_fitted ? 2.95 : imu_parts_h);
z_imu   = floor_t;                              // IMU underside (datum)
z_batt  = z_imu + imu_h + 0.1;                  // Kapton between IMU and cell
z_esp   = z_batt + batt[2] + foam_t;            // SuperMini PCB underside
z_usb_c = z_esp + esp_pcb[2] + esp_usb[1] / 2;  // receptacle centre
z_top   = z_esp + esp_pcb[2] + esp_usb[1];      // tallest point of the stack

imu_x0  = wall + (in_x - imu_pcb[0]) / 2;
imu_y0  = wall + (in_y - imu_pcb[1]) / 2;
esp_x0  = wall;                                  // USB end against the -X wall
esp_y0  = (pod[1] - esp_pcb[1]) / 2;
batt_x0 = wall + 0.4;
batt_y0 = (pod[1] - batt[1]) / 2;
chg_x0  = batt_x0 + batt[0] + 0.6;
chg_y0  = (pod[1] - chg[1]) / 2;

// Pod park positions on the +X end face, [Y, Z]. Contact [0] is GND (DOCK-),
// [1] is +5 V (DOCK+), marked "+". Magnet [0] and [1] face out with opposite poles.
function pod_park_pads() = [[pod[1] / 2 - pod_park_pitch / 2, pod_park_z], [pod[1] / 2 + pod_park_pitch / 2, pod_park_z]];
function pod_park_mags() = [[pod_park_mag_y, pod_park_z], [pod[1] - pod_park_mag_y, pod_park_z]];

bore_r  = shaft_d / 2;
jaw_R   = bore_r + jaw_t;
bore_z  = -(bore_r + web);                       // bore centre
bore_y  = pod[1] / 2;
jaw_xs  = [[0, jaw_w], [pod[0] - jaw_w, pod[0]]];

// ---- Strap geometry (pod frame, the cut across the shaft: [Y, Z]) ----
strap_x      = pod[0] / 2;                          // strap and posts centred along X
st_shank_l   = strap_t + 0.3;                       // shank stands out past the strap
st_hole      = [strap_post[0] + st_shank_l + strap_clear,      // slot across the strap: the post's
                strap_post[1] + strap_post[2] + 0.3];          // 45-degree underside widens it at the root
st_zb        = strap_post_z + strap_post[1] / 2;    // the slot's bearing edge: the shank's top
st_c1        = [edge_r, edge_r];                    // the body's lower edge round, -Y side
st_r1        = edge_r + strap_t / 2;                // strap centre line round it
st_c2        = [pod[1] / 2, -(shaft_d / 2 + web)];  // the shaft (bore centre)
st_r2        = shaft_d / 2 + strap_t / 2;           // strap centre line round the shaft
// The external tangent from the edge round to the shaft, on the outside (lower left).
st_d   = norm(st_c2 - st_c1);
st_n   = atan2(st_c2[1] - st_c1[1], st_c2[0] - st_c1[0]) - acos((st_r1 - st_r2) / st_d);  // normal angle
st_t1  = st_c1 + st_r1 * [cos(st_n), sin(st_n)];   // leaves the body here
st_t2  = st_c2 + st_r2 * [cos(st_n), sin(st_n)];   // meets the shaft here
st_tan = sqrt(st_d * st_d - pow(st_r2 - st_r1, 2));
st_arc1 = st_r1 * (st_n + 360 - 180) * PI / 180;   // round the body's edge, from the side face
st_arc2 = st_r2 * (540 - 2 * (st_n + 360)) * PI / 180;  // under the shaft, tangent to tangent
st_path = 2 * ((st_zb - edge_r) + st_arc1 + st_tan) + st_arc2;  // bearing edge to bearing edge, fitted
st_span = st_path / (1 + strap_preload);           // the same, as printed
st_len  = st_span + 2 * strap_tab;                 // overall

// What the ground unit's script reads through `use <script_shaft_imu.scad>`,
// so the hood it parks in is drawn from the pod's own numbers.
function pod_back_z() = bore_z - jaw_R * cos((360 - wrap_deg) / 2);   // jaw tips: the clamp side's lowest point
// [7] and [8] are for the fit test coupon: the end wall the contacts and magnets sit in, and the magnet pocket's clearance.
function pod_park_spec() = [pod, pod_park_pads(), pod_park_mags(), pod_park_pad, pod_park_mag, pod_park_skin, pod_back_z(),
                            wall, pod_park_mag_clear];

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------
module rbox(size, r) {
    // Box with every edge and corner rounded to r.
    hull() for (x = [r, size[0] - r], y = [r, size[1] - r], z = [r, size[2] - r])
        translate([x, y, z]) sphere(r = r, $fn = 32);
}

module rrect(w, h, r) { translate([r, r]) offset(r = r) square([w - 2 * r, h - 2 * r]); }

module sector(r, a0, a1, steps = 48) {
    // 2D pie slice from angle a0 to a1 (degrees, counter-clockwise from +x).
    polygon(concat([[0, 0]], [for (i = [0 : steps]) r * [cos(a0 + (a1 - a0) * i / steps), sin(a0 + (a1 - a0) * i / steps)]]));
}

// 2D shapes in the Y/Z plane extruded along X between x0 and x1.
module x_extrude(x0, x1) { translate([x0, 0, 0]) rotate([90, 0, 90]) linear_extrude(x1 - x0) children(); }

// ----------------------------------------------------------------------------
//  Base: body below the split line, the IMU pocket, the stack guides, the clamp
// ----------------------------------------------------------------------------
module base() {
    difference() {
        union() {
            intersection() {
                rbox(pod, edge_r);
                translate([-1, -1, -1]) cube([pod[0] + 2, pod[1] + 2, base_h + 1]);
            }
            clamp();
        }
        // Main cavity.
        translate([wall, wall, floor_t]) linear_extrude(pod[2]) rrect(in_x, in_y, in_r);
        snap_groove();
        usb_port();
        pry_notch();
        clamp_bore();
        saddle_relief();
        park_cuts();
        strap_saddle_cut();
    }
    imu_pocket();
    battery_stops();
    strap_posts();
}

// ---- Strap: hook posts, the saddle cut, the strap itself --------------------------
// One post on each side face. Profile across the shaft [Y, Z]: a shank and a
// head with an upper lip (it covers the slot's loaded edge) and a lower lip
// (the click). It prints with X vertical, so its underside is cut at 45
// degrees and needs no support.
module strap_post_2d() {
    sh = strap_post[1]; up = strap_post[2]; lo = strap_post[3]; ht = strap_post[4];
    c = 0.3;  // the head's outer edges
    translate([0, strap_post_z]) {
        translate([-0.01, -sh / 2]) square([st_shank_l + 0.02, sh]);
        polygon([[st_shank_l, -sh / 2 - lo], [st_shank_l + ht - c, -sh / 2 - lo], [st_shank_l + ht, -sh / 2 - lo + c],
                 [st_shank_l + ht, sh / 2 + up - c], [st_shank_l + ht - c, sh / 2 + up], [st_shank_l, sh / 2 + up]]);
    }
}
module strap_post_one() {
    // On the -Y face, standing out along -Y. Its top face (+X) is square; its
    // underside rises at 45 degrees, X + Y >= x_b, so the post prints unsupported.
    px1 = strap_x + st_hole[0] / 2 - strap_clear / 2;        // top face
    x_b = px1 - strap_post[0] - st_shank_l;                   // underside, at the side face
    intersection() {
        mirror([0, 1, 0]) x_extrude(x_b - 1, px1) strap_post_2d();
        translate([x_b, 0, -1]) rotate([0, 0, 45]) translate([0, -50, 0]) cube([100, 100, pod[2] + 2]);
    }
}
module strap_posts() {
    strap_post_one();
    translate([0, pod[1], 0]) mirror([0, 1, 0]) strap_post_one();
}
// Between the jaws the strap runs straight from the body's edge to the shaft;
// the bottom corners of the middle saddle are cut back clear of it.
module strap_saddle_cut() {
    u = st_t2 - st_t1; nn = [cos(st_n), sin(st_n)];
    off = strap_t / 2 + strap_clear;          // strap's inner face, less the clearance
    for (side = [0, 1]) translate([0, side * pod[1], 0]) mirror([0, side, 0])
        x_extrude(strap_x - strap_w / 2 - 0.4, strap_x + strap_w / 2 + 0.4) intersection() {
            translate([-50, -50]) square([50 + pod[1] / 2, 50]);   // below the body, this side
            polygon([st_t1 - off * nn, st_t1 - off * nn + 40 * u / norm(u),
                     st_t1 - off * nn + 40 * u / norm(u) + 30 * nn, st_t1 - off * nn - 10 * u / norm(u) + 30 * nn,
                     st_t1 - off * nn - 10 * u / norm(u)]);
        }
}

// The strap, printed flat in TPU, outer face down: X along it, Y across.
module strap() {
    w = strap_w; t = strap_t; r = w / 2;
    difference() {
        union() {
            hull() {   // 0.2 mm step at the bed edge, then the full outline
                for (x = [r, st_len - r]) translate([x, 0, 0]) cylinder(h = 0.2, r = r - 0.2);
                for (x = [r, st_len - r]) translate([x, 0, 0.2]) cylinder(h = t - 0.2, r = r);
            }
            // Lift ridges across each tip, on the inner face.
            for (x = [r - 0.6, st_len - r + 0.6]) translate([x, 0, t - 0.01]) hull() {
                translate([0, 0, 0]) cube([strap_ridge[0], w - 2.4, 0.01], center = true);
                translate([0, 0, strap_ridge[1] - 0.2]) cube([strap_ridge[0] - 0.6, w - 2.8, 0.4], center = true);
            }
        }
        // Slots: bearing edges strap_tab in from each tip, st_span apart.
        for (e = [[strap_tab, 1], [st_len - strap_tab, -1]]) translate([e[0], 0, -1])
            hull() for (dx = [0, e[1] * (st_hole[1] - 0.8)], dy = [-1, 1])
                translate([dx + e[1] * 0.4, dy * (st_hole[0] / 2 - 0.4), 0]) cylinder(h = t + 2, r = 0.4, $fn = 16);
    }
}
// The strap as fitted, for the assembly view: sides, edge rounds, tangents, under the shaft.
module strap_fitted() {
    c1 = [st_c1, [pod[1] - st_c1[0], st_c1[1]]];
    x_extrude(strap_x - strap_w / 2, strap_x + strap_w / 2) difference() {
        offset(delta = strap_t / 2) hull_path();
        offset(delta = -strap_t / 2) hull_path();
    }
    module hull_path() hull() {
        for (y = [-strap_t / 2, pod[1] + strap_t / 2]) translate([y, st_zb]) circle(r = 0.01);
        for (c = c1) translate(c) circle(r = st_r1, $fn = 48);
        translate(st_c2) circle(r = st_r2, $fn = 96);
    }
}

module park_cuts() {
    // Pilots for the two contact screws through the +X end wall (vertical as
    // printed), pockets for the magnets behind a two-layer skin, opening
    // inward, and a "+" beside the +5 V contact.
    for (p = pod_park_pads()) translate([pod[0] - wall - 1, p[0], p[1]])
        rotate([0, 90, 0]) cylinder(h = wall + 2, d = pod_park_pad[3], $fn = 24);
    for (m = pod_park_mags()) translate([pod[0] - pod_park_skin - pod_park_mag[1] - 0.1, m[0], m[1]])
        rotate([0, 90, 0]) cylinder(h = pod_park_mag[1] + 0.1, d = pod_park_mag[0] + pod_park_mag_clear, $fn = 32);
    translate([pod[0] - mark_depth, pod_park_pads()[1][0], pod_park_z - pod_park_pad[0] / 2 - 2.0])
        rotate([0, 90, 0]) linear_extrude(1) plus_mark();
}

module plus_mark() { for (r = [0, 90]) rotate(r) square([2.4, 0.6], center = true); }

module imu_pocket() {
    // Fence around the breakout on the datum floor. Crush ribs on the inside
    // faces centre the board and stop it rotating, so the board edges, and with
    // them the sensor axes, stay parallel to the pod's X and Y.
    c = imu_clear; t = imu_fence_t;
    x0 = imu_x0 - c; y0 = imu_y0 - c;
    w = imu_pcb[0] + 2 * c; d = imu_pcb[1] + 2 * c;
    translate([0, 0, floor_t - 0.01]) {
        difference() {
            translate([x0 - t, y0 - t, 0]) cube([w + 2 * t, d + 2 * t, imu_fence_h]);
            translate([x0, y0, -1]) cube([w, d, imu_fence_h + 2]);
            // Finger gaps at the short ends for lifting the board out.
            for (x = [x0 - t - 1, x0 + w - 1]) translate([x, y0 + d / 2 - 3, -1]) cube([t + 2, 6, imu_fence_h + 2]);
        }
        for (x = [x0 + w * 0.25, x0 + w * 0.75]) {
            translate([x, y0, 0]) cylinder(h = imu_fence_h, r = c + 0.1, $fn = 12);
            translate([x, y0 + d, 0]) cylinder(h = imu_fence_h, r = c + 0.1, $fn = 12);
        }
        for (y = [y0 + d / 2 + 4.5, y0 + d / 2 - 4.5]) {
            translate([x0, y, 0]) cylinder(h = imu_fence_h, r = c + 0.1, $fn = 12);
            translate([x0 + w, y, 0]) cylinder(h = imu_fence_h, r = c + 0.1, $fn = 12);
        }
    }
}

module battery_stops() {
    // Two posts on the side walls between the cell and the charger keep the
    // cell from sliding along X.
    for (y = [wall - 0.01, pod[1] - wall - 1.2 + 0.01])
        translate([chg_x0 - 0.5, y, floor_t - 0.01]) cube([0.5, 1.2, z_batt + batt[2] - floor_t]);
}

module snap_groove() {
    // Half-round groove around the inside of the wall, just below the split
    // line, for the bumps on the lid lip.
    zc = base_h - lip_h / 2;
    translate([0, 0, zc]) linear_extrude(0.9, center = true) difference() {
        translate([wall - 0.4, wall - 0.4]) rrect(in_x + 0.8, in_y + 0.8, in_r + 0.4);
        translate([wall, wall]) rrect(in_x, in_y, in_r);
    }
}

module usb_port() {
    // Plug-shell opening through the -X wall plus a shallow outer recess so
    // the plug's overmold can seat, which lets the shell reach full engagement.
    // Both are rounded, as the plug is.
    x_extrude(-1, wall + 1) translate([bore_y - 9.2 / 2, z_usb_c - 3.8 / 2]) rrect(9.2, 3.8, 1.2);
    x_extrude(-1, 0.6) translate([bore_y - 12.4 / 2, z_usb_c - 6.4 / 2]) rrect(12.4, 6.4, 2.4);
}

module pry_notch() {
    translate([pod[0] / 2 - 4, -1, base_h - 0.8]) cube([8, 1.6, 1.6]);
}

// ---- Clamp ----------------------------------------------------------------------
module clamp() {
    mouth = 360 - wrap_deg;
    for (j = jaw_xs) x_extrude(j[0], j[1]) translate([bore_y, bore_z]) difference() {
        union() {
            circle(r = jaw_R);
            // Saddle joining the C to the underside of the body.
            translate([-(jaw_R - 0.8), 0]) square([2 * (jaw_R - 0.8), -bore_z + 0.5]);
        }
        // Mouth, centred on -Z.
        rotate(-90) sector(jaw_R + 2, -mouth / 2, mouth / 2);
    }
    // Between the jaws, a saddle that follows the top of the shaft, so the
    // underside reads as one form sitting on the shaft rather than two clips.
    // It stands clear of the shaft: only the lined jaws grip.
    // Its outline is the jaws' own, cut off level with the shaft's centre.
    x_extrude(jaw_xs[0][1] - 0.01, jaw_xs[1][0] + 0.01) translate([bore_y, bore_z]) intersection() {
        union() {
            circle(r = jaw_R);
            translate([-(jaw_R - 0.8), 0]) square([2 * (jaw_R - 0.8), -bore_z + 0.5]);
        }
        translate([-jaw_R - 1, 0]) square([2 * jaw_R + 2, -bore_z + 1]);
    }
}

module saddle_relief() {
    x_extrude(jaw_xs[0][1] - 0.02, jaw_xs[1][0] + 0.02) translate([bore_y, bore_z]) circle(r = bore_r + saddle_clear);
}

module clamp_bore() {
    mouth = 360 - wrap_deg;
    for (j = jaw_xs) {
        x_extrude(j[0] - 1, j[1] + 1) translate([bore_y, bore_z]) {
            circle(r = bore_r);
            // Lead-in: chamfer the inner edges of the jaw tips so the shaft
            // pushes the C open instead of stopping against it.
            intersection() {
                rotate(-90) sector(bore_r + 1.6, -mouth / 2 - 22, mouth / 2 + 22);
                difference() { circle(r = bore_r + 1.6); circle(r = bore_r - 0.01); }
            }
        }
        // Liner band: recessed so the strip stands liner_proud above the bore.
        x_extrude(j[0] + 1.0, j[1] - 1.0) translate([bore_y, bore_z])
            circle(r = bore_r + liner_t - liner_proud);
        // Zip-tie tunnel across the saddle, and an outside groove round the jaw.
        xc = (j[0] + j[1]) / 2;
        translate([xc - tie_w / 2, -1, bore_z + bore_r + (web - tie_h) / 2])
            cube([tie_w, pod[1] + 2, tie_h]);
        x_extrude(xc - tie_w / 2, xc + tie_w / 2) translate([bore_y, bore_z]) difference() {
            circle(r = jaw_R + 1);
            circle(r = jaw_R - 0.6);
            translate([-jaw_R - 2, 0]) square([2 * jaw_R + 4, jaw_R + 2]);  // lower half only
        }
    }
}

// ----------------------------------------------------------------------------
//  Lid
// ----------------------------------------------------------------------------
module lid() {
    difference() {
        union() {
            intersection() {
                rbox(pod, edge_r);
                translate([-1, -1, base_h]) cube([pod[0] + 2, pod[1] + 2, lid_t + 1]);
            }
            // Lip, with snap bumps at the middle of each side.
            translate([0, 0, base_h - lip_h]) difference() {
                linear_extrude(lip_h + 0.01) difference() {
                    translate([wall + fit_clear, wall + fit_clear])
                        rrect(in_x - 2 * fit_clear, in_y - 2 * fit_clear, in_r);
                    translate([wall + fit_clear + lip_w, wall + fit_clear + lip_w])
                        rrect(in_x - 2 * (fit_clear + lip_w), in_y - 2 * (fit_clear + lip_w), max(0.3, in_r - lip_w));
                }
                // Relief over the USB-C receptacle.
                translate([-1, bore_y - 7, -1]) cube([wall + 6, 14, lip_h + 2]);
            }
            // Bumps protrude snap_bump past the lip face, stretched along it.
            for (y = [wall + fit_clear, pod[1] - wall - fit_clear])
                translate([pod[0] / 2, y, base_h - lip_h / 2]) scale([3, 1, 1]) sphere(r = snap_bump, $fn = 16);
            translate([pod[0] - wall - fit_clear, pod[1] / 2, base_h - lip_h / 2])
                scale([1, 3, 1]) sphere(r = snap_bump, $fn = 16);
            esp32_retainer();
        }
        usb_port();
        // Shadow gap at the seam: the lid's edge steps in for its first 0.5 mm.
        translate([0, 0, base_h - 0.01]) linear_extrude(reveal[1] + 0.01) difference() {
            translate([-1, -1]) square([pod[0] + 2, pod[1] + 2]);
            seam_inset = edge_r - sqrt(edge_r * edge_r - pow(base_h - (pod[2] - edge_r), 2));
            translate([seam_inset + reveal[0], seam_inset + reveal[0]])
                rrect(pod[0] - 2 * (seam_inset + reveal[0]), pod[1] - 2 * (seam_inset + reveal[0]), edge_r - seam_inset - reveal[0]);
        }
        // Arrow on the lid pointing along +X, toward the clubhead: the pod's
        // reference direction, and the way round it goes on the shaft.
        translate([pod[0] / 2, pod[1] / 2, pod[2] - mark_depth]) linear_extrude(1) head_arrow();
    }
}

module head_arrow() {
    // A chevron and a short shaft, 11 mm long.
    translate([-5.5, -0.6]) square([10.5, 1.2]);
    translate([5.5, 0]) rotate(180) for (s = [-1, 1]) rotate(s * 40) translate([0, -0.6]) square([5, 1.2]);
}

module esp32_retainer() {
    // Side fences locate the SuperMini in Y and at its antenna end in X. The
    // USB end is located by the port in the wall. Corner pads press the stack
    // (board, foam, cell, IMU) down onto the datum floor when the lid snaps on.
    t = 0.8; c = 0.2;
    x0 = esp_x0; y0 = esp_y0; L = esp_pcb[0]; W = esp_pcb[1];
    z_pcb_top = z_esp + esp_pcb[2];
    fence_bottom = z_esp + 0.2;
    translate([0, 0, fence_bottom]) {
        for (y = [y0 - c - t, y0 + W + c])
            translate([x0 + 6, y, 0]) cube([L - 6, t, base_h - fence_bottom + 0.01]);
        translate([x0 + L + c, y0 + 3, 0]) cube([t, W - 6, base_h - fence_bottom + 0.01]);
    }
    for (p = [[x0 + 9.5, y0 + 0.2], [x0 + 9.5, y0 + W - 2.2], [x0 + L - 2.2, y0 + 0.2], [x0 + L - 2.2, y0 + W - 2.2]])
        translate([p[0], p[1], z_pcb_top]) cube([2, 2, base_h - z_pcb_top + 0.01]);
}

// ----------------------------------------------------------------------------
//  Ghost components
// ----------------------------------------------------------------------------
// Named ghosts, so each can be exported alone in place (`part = "ghost:imu"`).
// The Blender scene in cad/blender/ is built that way.
ghost_names = ["imu", "imu_axes", "battery", "charger", "esp32", "shaft", "liner", "park_contacts", "park_magnets", "park_diode", "strap"];

module ghosts() { for (n = ghost_names) ghost(n); }

module ghost(name) {
    if (name == "imu") color("Purple", 0.7) translate([imu_x0, imu_y0, z_imu])
        cube([imu_pcb[0], imu_pcb[1], imu_pcb[2]]);
    // Sensor axes as printed on the Adafruit silkscreen (X red, Y green, Z blue): check yours.
    if (name == "imu_axes") translate([imu_x0 + imu_pcb[0] / 2, imu_y0 + imu_pcb[1] / 2, z_imu + imu_pcb[2]]) {
        color("Red")   rotate([0, 90, 0]) cylinder(h = 8, d = 0.8);
        color("Green") rotate([-90, 0, 0]) cylinder(h = 8, d = 0.8);
        color("Blue")  cylinder(h = 8, d = 0.8);
    }
    if (name == "battery") color("SteelBlue", 0.5) translate([batt_x0, batt_y0, z_batt]) cube(batt);
    if (name == "charger") color("Teal", 0.6) translate([chg_x0, chg_y0, z_batt]) cube(chg);
    if (name == "esp32") color("Black", 0.7) translate([esp_x0, esp_y0, z_esp]) {
        cube([esp_pcb[0], esp_pcb[1], esp_pcb[2]]);
        translate([-esp_usb_overhang, esp_pcb[1] / 2 - esp_usb[0] / 2, esp_pcb[2]]) cube([7.3, esp_usb[0], esp_usb[1]]);
    }
    if (name == "shaft") color("Gray", 0.35)
        translate([-20, bore_y, bore_z]) rotate([0, 90, 0]) cylinder(h = pod[0] + 40, d = shaft_d);
    // Liner strips in the jaw bands, standing liner_proud above the bore.
    if (name == "liner") color("DimGray") for (j = jaw_xs)
        x_extrude(j[0] + 1.0, j[1] - 1.0) translate([bore_y, bore_z]) difference() {
            intersection() {
                circle(r = bore_r + liner_t - liner_proud);
                rotate(90) sector(bore_r + 2, -wrap_deg / 2, wrap_deg / 2);
            }
            circle(r = bore_r - liner_proud);
        }
    // Pod park: the two brass contact screws, the magnets behind the end wall,
    // and D2 behind the wall between the screws.
    if (name == "park_contacts") color("Gold") for (p = pod_park_pads())
        translate([pod[0], p[0], p[1]]) rotate([0, 90, 0]) {
            cylinder(h = pod_park_pad[1], d = pod_park_pad[0], $fn = 24);
            translate([0, 0, -pod_park_pad[2]]) cylinder(h = pod_park_pad[2], d = 2.0, $fn = 16);
        }
    if (name == "park_magnets") color("Silver") for (m = pod_park_mags())
        translate([pod[0] - pod_park_skin - pod_park_mag[1], m[0], m[1]]) rotate([0, 90, 0])
            cylinder(h = pod_park_mag[1], d = pod_park_mag[0], $fn = 32);
    // The TPU strap as fitted on the shaft (a printed part; "strap" exports it flat).
    if (name == "strap") color("#3a3a3a") strap_fitted();
    if (name == "park_diode") color("Black")
        translate([park_parts_x0(), pod[1] / 2 - pod_park_diode[1] / 2, z_batt + chg[2] + 0.2]) cube(pod_park_diode);
}
function park_parts_x0() = esp_x0 + esp_pcb[0] + 0.2 + 0.8 + 0.2;   // just past the lid's fence at the antenna end

// The whole pod as it parks, for the ground unit's script: body and lid, and
// optionally its parts (not the shaft).
module pod_parked_parts(with_parts = true) {
    color("#2b2b2b") { base(); lid(); }
    if (with_parts) for (n = ghost_names) if (n != "shaft" && n != "imu_axes" && n != "strap") ghost(n);
}
module pod_park_solid() { base(); lid(); }

// ----------------------------------------------------------------------------
//  Fit report
// ----------------------------------------------------------------------------
function chk(name, v) = str(v >= 0 ? "  ok   " : "  FAIL ", name, ": ", v, " mm");

module fit_report() {
    needed_h = z_top + 0.2 + lid_t;
    antenna_over_cell = max(0, (batt_x0 + batt[0]) - (esp_x0 + esp_pcb[0] - esp_antenna));
    mouth = 2 * bore_r * sin((360 - wrap_deg) / 2);
    echo(chk("stack height under the lid      ", base_h - 0.2 - z_top));
    echo(chk("IMU board inside the walls (X)  ", in_x - imu_pcb[0] - 2 * (imu_clear + imu_fence_t)));
    echo(chk("cell + charger along X          ", in_x - (batt[0] + 0.4 + 0.6 + chg[0])));
    echo(chk("SuperMini inside the walls (Y)  ", in_y - esp_pcb[1] - 2 * (0.2 + 0.8)));
    echo(str("  info  body height needed for this stack: ", needed_h, " mm (body is ", pod[2], ")"));
    echo(str("  info  antenna zone over the cell: ", antenna_over_cell,
             " mm of ", esp_antenna, " (0 is ideal; a 1-3 m link tolerates a little)"));
    echo(str("  info  clamp mouth ", mouth, " mm for a ", shaft_d, " mm bore; each jaw deflects ",
             (shaft_d - mouth) / 2, " mm to snap on"));
    echo(str("  info  overall height incl. clamp: ", pod[2] - (bore_z - jaw_R), " mm"));
    // Pod park: contacts and magnets in the +X end, and D2 behind it.
    pads = pod_park_pads(); mags = pod_park_mags();
    mr = (pod_park_mag[0] + pod_park_mag_clear) / 2;  // pocket radius
    ye = pod_park_mag_y - mr;         // magnet pocket's outer edge, toward the side face
    skin_min = (ye >= edge_r ? pod[0] : pod[0] - edge_r + sqrt(edge_r * edge_r - pow(edge_r - ye, 2)))
             - (pod[0] - pod_park_skin);
    lip_low = base_h - lip_h;         // lowest point of the lid's lip
    echo(chk("park contacts in the end-face flat ", (pod[2] - edge_r) - (pod_park_z + pod_park_pad[0] / 2)));
    echo(chk("park contact screws over charger  ", (pod_park_z - 1.0) - (z_batt + chg[2])));
    echo(chk("park contact screws under lid lip ", lip_low - (pod_park_z + 1.0)));
    echo(chk("park screw tips + solder to fence ", (pod[0] - pod_park_pad[2] - 1.0) - (esp_x0 + esp_pcb[0] + 0.2 + 0.8)));
    echo(chk("park magnets under the lid lip    ", lip_low - (pod_park_z + mr)));
    echo(chk("park magnets beside the charger   ", chg_y0 - (pod_park_mag_y + mr)));
    echo(chk("park magnets inside the side walls", ye - wall));
    echo(chk("park magnets to contact heads     ", (pads[0][0] - pod_park_pad[0] / 2) - (pod_park_mag_y + mr)));
    // Stays under 0.3 by design: the skin is two 0.2 mm layers, and at the pocket's outer edge the
    // body's R3 edge takes a few hundredths off it. The fit test coupon prints the same skin.
    echo(chk("park magnet skin, thinnest - 0.3  ", skin_min - 0.3));
    echo(chk("park D2 space along X             ", (pod[0] - wall) - park_parts_x0() - pod_park_diode[0]));
    echo(chk("park D2 space between the screws  ", (pod_park_pitch - 2.0 - 0.4) - pod_park_diode[1]));
    echo(chk("park D2 + divider height          ", lip_low - (z_batt + chg[2]) - 0.2 - pod_park_diode[2] - 1.0));
    echo(str("  info  park contacts: pitch ", pod_park_pitch, " mm, heads ", pod_park_pad[0], " mm standing ",
             pod_park_pad[1], " mm proud of the +X end, ", pod_park_z, " mm up; magnets ",
             pod_park_mag[0], " x ", pod_park_mag[1], " mm, ", pod[0] - pod_park_skin - pod_park_mag[1] - (esp_x0 + esp_pcb[0]),
             " mm past the antenna end"));
    // Strap. The strap is outside the walls: nothing of it, or of its posts, reaches the IMU, the cell,
    // the charger or the SuperMini; these lines check its place on the outside.
    lo = strap_post[1] / 2 + strap_post[3];
    echo(chk("strap band clear of the jaws (X)   ", min(jaw_xs[1][0] - (strap_x + strap_w / 2), (strap_x - strap_w / 2) - jaw_xs[0][1]) - 1.0));
    echo(chk("strap band clear of the USB-C end  ", (strap_x - strap_w / 2) - (wall + 1.0)));
    echo(chk("strap posts outside the side walls ", wall - 0));
    echo(chk("strap slot above the lower edge rnd", (st_zb - st_hole[1]) - edge_r));
    echo(chk("strap tab below the pry notch      ", (base_h - 0.8) - (st_zb + strap_tab) - 0.5));
    echo(chk("strap post head below the pry notch", (base_h - 0.8) - (st_zb + strap_post[2]) - 0.5));
    echo(chk("strap leaves the body above Z 0    ", st_t1[1]));
    echo(chk("strap meets the shaft below centre ", st_c2[1] - st_t2[1]));
    // The latch: the slot's loaded edge sits under the upper lip; the slot is shorter than the
    // head, so it clicks over the lower lip and cannot fall off when slack.
    echo(chk("strap latch: upper lip over the slot", strap_post[2] - 0.6));
    echo(chk("strap latch: strap clear under head", st_shank_l - strap_t));
    // Under 0.3 by design: this is the click, the slot stretching 0.3 mm (9 %) over the head.
    // More makes it hard to fit with gloves; the upper lip, not this, carries the load.
    echo(chk("strap latch: detent (head - slot)  ", (strap_post[1] + strap_post[2] + strap_post[3]) - st_hole[1]));
    echo(chk("strap: bars beside the slot >= 1.6 ", (strap_w - st_hole[0]) / 2 - 1.6));
    echo(chk("strap: tab beyond the slot  >= 3.0 ", strap_tab - 3.0));
    echo(str("  info  strap ", strap_w, " x ", strap_t, " mm TPU 95A, ", st_len, " mm long; slots ", st_hole, " mm, bearing edges ",
             st_span, " mm apart; fitted path ", st_path, " mm on a ", shaft_d, " mm shaft (", strap_preload * 100, " % stretch)"));
    echo(str("  info  strap section ", strap_w * strap_t, " mm2, ", (strap_w - st_hole[0]) * strap_t,
             " mm2 at the slots; preload about ", 26 * strap_w * strap_t * strap_preload, " N per leg at E = 26 MPa"));
    echo(str("  info  strap strength: about ", round(25 * (strap_w - st_hole[0]) * strap_t), "-", round(35 * (strap_w - st_hole[0]) * strap_t),
             " N at the slots from TPU 95A's 25-35 MPa datasheet tensile strength; the hold on a club needs a physical pull test"));
    echo(str("  info  park magnets: the largest disc that fits behind the end wall is ",
             lip_low - (z_batt + chg[2]), " mm across (a 6 x 2 mm disc does not)"));
}

// ----------------------------------------------------------------------------
//  Part selector
// ----------------------------------------------------------------------------
fit_report();

if (part == "base") {
    base_print();
} else if (part == "lid") {
    lid_print();
} else if (part == "strap") {
    strap();
} else if (part == "section") {
    // Cut across the shaft through the middle of the -X jaw, looking along +X.
    rotate([0, 0, -90]) projection(cut = true) rotate([0, -90, 0]) translate([-jaw_w / 2, 0, 0]) union() {
        base();
        if (show_components) ghosts();
    }
} else if (part == "in_place:base") {
    base();
} else if (part == "in_place:lid") {
    lid();
} else if (len(part) > 6 && part[0] == "g" && part[5] == ":") {
    ghost(str_join(part, 6));
} else if (part == "print_plate") {
    base_print();
    translate([pod[2] - bore_z + jaw_R + 6, 0, 0]) lid_print();
} else {
    base();
    translate([0, 0, explode]) lid();
    if (show_components) ghosts();
}

// Characters of s from index i to the end ("ghost:imu" -> "imu").
function str_join(s, i) = i >= len(s) ? "" : str(s[i], str_join(s, i + 1));

// Base: printed standing on its -X (USB) end, so the bore axis is vertical and
// every layer contains a complete C. The jaws then flex along the layers rather
// than prying them apart, which is where a clamp printed lying down breaks.
module base_print() { translate([pod[2], 0, 0]) rotate([0, -90, 0]) base(); }
// Lid: outside face down.
module lid_print()  { translate([0, 0, pod[2]]) mirror([0, 0, 1]) lid(); }
