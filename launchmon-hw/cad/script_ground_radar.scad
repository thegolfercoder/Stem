// =============================================================================
//  Stem launch monitor - GROUND RADAR UNIT enclosure
//  OpenSCAD 2021.01 or newer.  All dimensions in millimetres.
// =============================================================================
//
//  Envelope: 96 x 64 x 21 mm with R12 plan corners and 2.4 mm walls, the shape
//  of a phone-sized MagSafe battery pack.
//
//  HOW IT STANDS
//  The unit stands on one of its long 96 x 21 edges, behind the ball, with
//  the large 96 x 64 face looking down the target line. The radar's 25.4 mm
//  window is in that face. It cannot go anywhere else: the 21 mm faces are
//  too narrow for a 25.4 mm aperture. Standing on its edge, a 21 mm deep box
//  tips over easily, so an optional cradle (`part = "stand"`) adds a rear
//  outrigger and a channel for a right-angle USB-C cable.
//
//  COORDINATES (as used, not as printed)
//      X  0 -> 96   left to right, seen from in front (the target side)
//      Z  0 -> 64   ground up.  Z = 0 is the bottom face the unit stands on
//      Y  0 -> 21   front face (radar window) to back face (removable lid)
//
//  INTERNAL LAYOUT (front view)
//
//      Z 64 +--------------------------------------------------------------+
//           | [ESP32-C3 SuperMini] [LM358 preamp] [ radar, 15 deg tilted ]  |
//           |                                     [  BGT24LTR11 window   ]  |
//      Z 40 |== divider ====================== |                         |  |
//           |                                  |                     [SW]-> side slot
//           |      3.7 V 1500 mAh LiPo         |  [TP4056]                |
//           |   (MT3608 boost on the lid,      |  USB-C                   |
//           |    behind the cell)              |    |                     |
//      Z  0 +----------------------------------+----v---------------------+
//                                               bottom USB-C cutout
//
//  The power parts (LiPo, TP4056, MT3608) share the lower cavity. The cell
//  and both modules will not fit side by side in a 91 mm interior with R9.6
//  corners, so the MT3608 sits on the lid behind the cell, in the same cavity.
//  `fit_report()` prints every clearance at render time, so a change to any
//  part size shows up as a number rather than as a part that won't go in.
//
//  PRINTED PARTS (set `part`):
//      "shell"             front face + side walls (print front face DOWN)
//      "lid"               rear cover, carries the MT3608   (print flat, lip UP)
//      "esp32_clamp_tab"   x2, M2 clamp tabs for the SuperMini (no holes on it)
//      "stand"             optional anti-tip cradle
//      "assembly"          everything placed, with ghost components (viewing only)
//      "print_plate"       shell + lid + tabs laid out for one export
// =============================================================================

/* [Render] */
part            = "assembly";   // [assembly, shell, lid, esp32_clamp_tab, stand, phone_mount, print_plate, section]
// Also: "in_place:shell|lid|tab0|tab1|stand" and "ghost:<name>" export one
// part in its assembled position (used by cad/blender/).
show_components = true;         // ghost components in the assembly view
explode         = 0;            // [0:1:40] pull the lid back in the assembly view
$fn             = 64;

/* [Envelope - MagSafe battery-pack form factor] */
body_w      = 96;     // X
body_h      = 64;     // Z
body_d      = 21;     // Y (thickness)
corner_r    = 12;     // R12 plan corners
wall        = 2.4;    // outer wall: 6 perimeters at 0.4 mm, or 4 at 0.6 mm
lid_t       = 2.4;    // rear lid plate thickness
edge_chamfer = 1.0;   // soft 45-degree edge on the front and rear perimeter

/* [Radar window - Infineon BGT24LTR11] */
win_size    = 25.4;   // square aperture, measured in the plane of the window
win_t       = 1.1;    // window skin: 1.0 - 1.2 mm keeps PETG/ABS nearly transparent at 24 GHz
win_tilt    = 15;     // boresight elevation above horizontal, degrees
win_cx      = 76.1;   // window centre, X
win_zb      = 33.0;   // window bottom edge, Z, where it meets the front face
win_frame   = 1.2;    // wall thickness of the window's internal housing
radar_pcb   = [25.4, 25.4, 1.6];  // module PCB, measured in the window plane [w, h, t]
radar_gap   = 6.2;    // antenna to inner window surface. 6.2 mm = half a free-space
                      // wavelength at 24.125 GHz; see docs/build_instructions.md
radar_back_clear = 3.0;            // component height on the module's rear face
// M2 holes on the radar module, relative to the PCB's bottom-centre [x, z].
// MEASURE YOUR MODULE: modules from different vendors drill different patterns.
radar_holes = [[-10.2, 2.5], [10.2, 2.5], [-10.2, 22.9], [10.2, 22.9]];

/* [ESP32-C3 SuperMini] */
// The SuperMini has no mounting holes. It sits on two rails, its USB end hooks
// under two fixed lips, and two M2 standoffs with printed tabs clamp the far end.
esp_pcb     = [22.52, 18.0, 1.0];  // [X, Z, thickness]
esp_pos     = [11.5, 41.0];        // lower-left corner of the board, [X, Z]
esp_rail_h  = 2.5;                 // board underside above the front wall
esp_usb     = [8.94, 3.26];        // USB-C receptacle [width, height]

/* [LM358 pre-amp board] */
lm_pcb      = [23.0, 20.0, 1.6];   // [X, Z, thickness]; a 9 x 8 hole perfboard
lm_pos      = [38.8, 40.5];        // lower-left corner [X, Z]
lm_hole_inset = 2.5;               // M2 holes inset from each corner
lm_standoff_h = 4.0;               // clears through-hole leads under the board

/* [Power: LiPo, TP4056, MT3608, switch, LED] */
batt        = [50.0, 34.0, 8.0];   // 803450-class 1500 mAh cell [X, Z, thickness]
batt_pos    = [10.4, 2.4];         // bay lower-left [X, Z]
batt_clear  = 0.5;                 // per side
tp_pcb      = [17.5, 28.0, 1.6];   // TP4056 USB-C module [X, Z, t], USB end down
tp_x        = 64.25;               // module left edge
tp_pad_h    = 1.5;                 // PCB underside above the front wall
tp_usb_h    = 3.3;                 // receptacle height above the PCB
mt_pcb      = [36.0, 17.0, 1.6];   // MT3608 boost module [X, Z, t]
mt_parts_h  = 5.0;                 // tallest part above its PCB (trimmer / inductor): MEASURE
mt_pos      = [19.0, 12.0];        // lower-left on the lid, in front-view [X, Z]
usb_cut     = [11.5, 6.0];         // bottom USB-C cutout [X, Y]
sw_body     = [8.7, 3.7, 3.7];     // SS12D00-style slide switch body [Y-long, Z, X-depth]
sw_slot     = [4.6, 2.2];          // actuator slot [Y, Z]
sw_center   = [10.5, 20.0];        // slot centre [Y, Z] on the right wall
led_d       = 5.1;                 // 5 mm LED, through hole
led_flange_d = 6.0;                // LED rim, seated from inside
led_pos     = [22.75, 13.0];       // [X, Y] on the top face

/* [Phone holder - MagSafe, on the lid] */
// A plate screwed to the lid with the lid's own four screws (M2 x 10 instead
// of M2 x 6). It carries a MagSafe-compatible magnet ring. The phone's back
// sits on the plate: its screen faces the user behind the unit, and its rear
// camera, above the unit's top edge, looks down the target line beside the radar.
// A phone is much taller than the unit, so the ring sits high enough for the
// phone's bottom edge to clear the stand's rear wall: the plate rises above the
// unit's top edge. Use the stand whenever a phone is fitted; it carries the weight.
phone_mount   = true;
mount_t       = 4.0;            // plate thickness
ring_center   = [48, 92];       // magnet ring centre, front-view [X, Z]
ring_od       = 56.5;           // aftermarket MagSafe magnet ring: MEASURE YOURS
ring_id       = 45.5;
ring_depth    = 1.8;            // pocket depth; the ring sits flush, under a 0.5 mm grip pad
orient_slot   = [12.5, 6.5];    // alignment ("tail") magnet below the ring [X, Z]; [0, 0] for none
orient_gap    = 2.5;            // ring OD to the slot's top edge
phone         = [71.6, 147.6, 8.3];  // stand-in phone for fit checks and renders [W, H, T]
phone_lens_from_top = 25;       // main camera centre below the phone's top edge (typical)
phone_vfov    = 65;             // camera vertical field of view, portrait, degrees
stand_wall_top = 8;             // top of the stand's channel walls above the unit's bottom (stand() wall_h):
                                // the phone hangs just behind the rear wall, so its bottom edge must clear it

/* [Fasteners - M2] */
m2_pilot    = 1.7;    // thread-forming M2 straight into PETG/ABS
m2_clear    = 2.4;
m2_head_d   = 4.4;
m2_head_h   = 1.2;
boss_d      = 5.6;
// Lid screw bosses, front-view [X, Z]. Three corners plus one on the right wall:
// the radar housing fills the top-right corner.
lid_bosses  = [[8, 8], [88, 8], [8, 56], [91, 28]];
lid_lip_h   = 2.0;
lid_lip_w   = 1.2;
fit_clear   = 0.25;

// ----------------------------------------------------------------------------
//  Derived values
// ----------------------------------------------------------------------------
in_r     = corner_r - wall;            // inner corner radius (9.6)
z_floor  = wall;                       // inner face of the bottom wall
y_front  = wall;                       // inner face of the front wall
y_back   = body_d - lid_t;             // inner face of the lid (18.6)
inner_d  = y_back - y_front;           // usable depth (16.2)

tp_usb_y = y_front + tp_pad_h + tp_pcb[2] + tp_usb_h / 2;   // receptacle centre, Y
tp_usb_x = tp_x + tp_pcb[0] / 2;

esp_top_y = y_front + esp_rail_h + esp_pcb[2];

// The radar module's rearmost point (top edge, rear components), in global Y.
radar_stack   = win_t + radar_gap + radar_pcb[2] + radar_back_clear;
radar_back_y  = radar_stack * cos(win_tilt) + win_size * sin(win_tilt);
radar_low_z   = win_zb - (win_t + radar_gap) * sin(win_tilt);  // module bottom edge

assert(win_t >= 1.0 && win_t <= 1.2, "Radar window must be 1.0 - 1.2 mm for 24 GHz transparency");
assert(win_tilt == 15, "Brief specifies a 15 degree upward tilt; remove this assert to experiment");

// ----------------------------------------------------------------------------
//  2D / helper primitives
// ----------------------------------------------------------------------------
module rrect(w, h, r) {
    // Rounded rectangle with its lower-left corner at the origin.
    translate([r, r]) offset(r = r) square([w - 2 * r, h - 2 * r]);
}

module xz_extrude(y0, y1) {
    // Extrude a 2D shape drawn in the X/Z plane between Y = y0 and Y = y1.
    translate([0, y1, 0]) rotate([90, 0, 0]) linear_extrude(y1 - y0) children();
}

module outline(inset = 0) {
    translate([inset, inset]) rrect(body_w - 2 * inset, body_h - 2 * inset, corner_r - inset);
}

module envelope() {
    // The full closed body, with chamfered front and rear perimeter edges.
    c = edge_chamfer;
    hull() {
        xz_extrude(0, 0.01)             outline(c);
        xz_extrude(c, body_d - c)       outline(0);
        xz_extrude(body_d - 0.01, body_d) outline(c);
    }
}

// Window frame: local x across the window, local y inward (into the box)
// along the window normal, local z up the window. Origin at the bottom-centre
// of the window's outer surface, which lies on the front face.
module in_window_frame() {
    translate([win_cx, 0, win_zb]) rotate([-win_tilt, 0, 0]) children();
}

module y_cylinder(h, d) { rotate([-90, 0, 0]) cylinder(h = h, d = d); }

// ----------------------------------------------------------------------------
//  Shell (front face + side walls)
// ----------------------------------------------------------------------------
module shell() {
    difference() {
        union() {
            difference() {
                intersection() {
                    envelope();
                    translate([-1, -1, -1]) cube([body_w + 2, y_back + 1, body_h + 2]);
                }
                xz_extrude(y_front, y_back + 1) outline(wall);   // main cavity
                window_recess();
                window_rear_clearance();
            }
            intersection() {
                envelope();
                union() {
                    window_housing();
                    lid_screw_bosses();
                }
            }
            radar_posts();
            esp32_mount();
            lm358_standoffs();
            battery_bay();
            tp4056_pocket();
            switch_holder();
        }
        // Holes and cutouts through everything above.
        lid_screw_pilots();
        standoff_pilots();
        usb_c_cutout();
        switch_slot();
        led_hole();
        aim_groove();
    }
}

// ---- Radar window -----------------------------------------------------------
module window_recess() {
    // Everything in front of the tilted window surface, inside the aperture.
    in_window_frame() translate([-win_size / 2, -40, 0]) cube([win_size, 40, win_size]);
}

module window_rear_clearance() {
    // Hollow out the front wall behind the window skin, so the skin is win_t
    // thick everywhere and the module can sit square behind it.
    in_window_frame() translate([-win_size / 2, win_t, 0])
        cube([win_size, radar_stack + 2, win_size]);
}

module window_housing() {
    // A rectangular collar around the aperture plus the skin itself. Above the
    // bottom edge the window sits behind the front face, so the collar forms
    // the side walls and roof of the recess and holds the skin in place.
    in_window_frame() difference() {
        translate([-win_size / 2 - win_frame, -40, -win_frame])
            cube([win_size + 2 * win_frame, 40 + win_t, win_size + 2 * win_frame]);
        translate([-win_size / 2, -41, 0]) cube([win_size, 41, win_size]);
    }
}

module radar_posts() {
    // M2 standoffs on the inside of the window skin, normal to it, so the module
    // sits parallel to the window at radar_gap behind it.
    in_window_frame() for (h = radar_holes)
        translate([h[0], win_t - 0.01, h[1]]) difference() {
            y_cylinder(radar_gap + 0.01, 4.6);
            translate([0, radar_gap - 4.5, 0]) y_cylinder(5, m2_pilot);
        }
}

// ---- ESP32-C3 SuperMini -----------------------------------------------------
module esp32_mount() {
    x0 = esp_pos[0]; z0 = esp_pos[1];
    L = esp_pcb[0];  W = esp_pcb[1];
    // Two rails under the short ends of the board. The pin rows run along the
    // long edges and stay clear, so wires can be soldered from underneath.
    for (x = [x0 + 1, x0 + L - 3])
        translate([x, y_front - 0.01, z0]) cube([2, esp_rail_h + 0.01, W]);
    // Fixed lips at the USB end, either side of the receptacle. The board's USB
    // end hooks under these, then the far end drops onto the rails.
    lip_len = (W - esp_usb[0]) / 2 - 1.6;   // stays clear of the plug overmold
    for (z = [z0, z0 + W - lip_len])
        translate([x0 - 1.2, y_front - 0.01, z]) difference() {
            cube([2.2, esp_rail_h + esp_pcb[2] + 1.2 + 0.01, lip_len]);
            translate([1.2, -0.1, -0.1])
                cube([2, esp_rail_h + esp_pcb[2] + 0.1 + 0.01, lip_len + 0.2]);
        }
    // Two M2 standoffs beyond the far (antenna) end, for the clamp tabs.
    for (z = esp32_tab_z())
        translate([x0 + L + 2.2, y_front - 0.01, z]) y_cylinder(esp_rail_h + esp_pcb[2] + 0.01, 4.2);
}
function esp32_tab_z() = [esp_pos[1] + 1.5, esp_pos[1] + esp_pcb[1] - 1.5];

module esp32_clamp_tab() {
    // Printed tab: screws to one standoff and overlaps the board end by 1.5 mm.
    difference() {
        hull() {
            cylinder(h = 1.6, d = 4.6);
            translate([-2.2 - 1.5, -2.3, 0]) cube([0.1, 4.6, 1.6]);
        }
        translate([0, 0, -1]) cylinder(h = 4, d = m2_clear);
    }
}

// ---- LM358 pre-amp ------------------------------------------------------------
function lm_holes() = [
    for (dx = [lm_hole_inset, lm_pcb[0] - lm_hole_inset])
        for (dz = [lm_hole_inset, lm_pcb[1] - lm_hole_inset])
            [lm_pos[0] + dx, lm_pos[1] + dz]
];

module lm358_standoffs() {
    for (h = lm_holes())
        translate([h[0], y_front - 0.01, h[1]]) y_cylinder(lm_standoff_h + 0.01, 5.0);
}

module standoff_pilots() {
    // Pilot holes are cut after the union so they continue into the front wall
    // where a standoff is shorter than the screw. At least 1.4 mm of front wall
    // is always left intact.
    max_into_wall = wall - 1.4;
    esp_top = esp_rail_h + esp_pcb[2];
    for (z = esp32_tab_z())
        translate([esp_pos[0] + esp_pcb[0] + 2.2, y_front - min(max_into_wall, 4.4 - esp_top), z])
            y_cylinder(esp_top + 5, m2_pilot);
    for (h = lm_holes())
        translate([h[0], y_front - min(max_into_wall, 4.4 - lm_standoff_h), h[1]])
            y_cylinder(lm_standoff_h + 5, m2_pilot);
}

// ---- Lower cavity: battery bay ----------------------------------------------
module battery_bay() {
    // A low fence locates the cell against the front wall. The top bar doubles
    // as the divider between the power cavity and the signal electronics. The
    // right bar has a gap for the cell's tab leads.
    bw = batt[0] + 2 * batt_clear;
    bh = batt[1] + 2 * batt_clear;
    fh = 4.0; t = 1.2;
    x0 = batt_pos[0]; z0 = batt_pos[1];
    translate([0, y_front - 0.01, 0]) {
        translate([x0 - t, 0, z0])          cube([t, fh, bh]);          // left
        translate([x0 - t, 0, z0 + bh])     cube([bw + 2 * t, inner_d * 0.6, t]); // divider
        translate([x0 + bw, 0, z0])         cube([t, fh, bh * 0.3]);    // right, lower
        translate([x0 + bw, 0, z0 + bh * 0.7]) cube([t, fh, bh * 0.3]); // right, upper
    }
}

// ---- Lower cavity: TP4056 -----------------------------------------------------
module tp4056_pocket() {
    // Pad rails under the long edges, side guides, and an upper stop that takes
    // the plug's insertion force. A rib on the lid presses the module down.
    t = 1.0;
    x0 = tp_x; w = tp_pcb[0]; L = tp_pcb[1];
    z0 = z_floor;   // the receptacle nose sits on the inner face of the bottom wall
    guide_h = tp_pad_h + tp_pcb[2] + 0.4;
    translate([0, y_front - 0.01, 0]) {
        for (x = [x0, x0 + w - 1.5]) translate([x, 0, z0 + 8]) cube([1.5, tp_pad_h + 0.01, L - 8]);
        for (x = [x0 - t - fit_clear, x0 + w + fit_clear])
            translate([x, 0, z0]) cube([t, guide_h, L]);
        translate([x0 - t - fit_clear, 0, z0 + L + fit_clear])
            cube([w + 2 * t + 2 * fit_clear, guide_h, 1.2]);
    }
}

// ---- Bottom USB-C cutout ----------------------------------------------------
module usb_c_cutout() {
    // Through the bottom wall, centred on the TP4056 receptacle. The port faces
    // the ground while the unit stands, which keeps rain off it; use the stand
    // and a right-angle cable to charge it upright.
    translate([tp_usb_x - usb_cut[0] / 2, tp_usb_y - usb_cut[1] / 2, -1])
        rounded_slot(usb_cut[0], usb_cut[1], wall + 1.6, 1.2);
}

module rounded_slot(w, d, h, r) {
    linear_extrude(h) translate([r, r]) offset(r = r) square([w - 2 * r, d - 2 * r]);
}

// ---- SPST slide switch, right side wall --------------------------------------
module switch_holder() {
    // A pocket that holds the switch body against the inside of the right wall.
    t = 1.0;
    by = sw_body[0]; bz = sw_body[1]; bx = sw_body[2];
    translate([body_w - wall - bx - t, sw_center[0] - by / 2 - t, sw_center[1] - bz / 2 - t])
        difference() {
            cube([bx + t + 0.01, by + 2 * t, bz + 2 * t]);
            translate([t, t, t]) cube([bx + 1, by, bz]);
            translate([-1, t + 1, t + 0.6]) cube([t + 2, by - 2, bz - 1.2]);  // legs exit inward
        }
}

module switch_slot() {
    // Actuator slot through the wall, plus a 1 mm outside recess so the lever
    // sits below the surface and a stray club or foot does not switch it.
    translate([body_w - wall - 1, sw_center[0] - sw_slot[0] / 2, sw_center[1] - sw_slot[1] / 2])
        cube([wall + 2, sw_slot[0], sw_slot[1]]);
    translate([body_w - 1.0, sw_center[0] - 4.5, sw_center[1] - 2.8]) cube([2, 9, 5.6]);
}

// ---- 5 mm status LED, top face ------------------------------------------------
module led_hole() {
    translate([led_pos[0], led_pos[1], body_h - wall - 1]) cylinder(h = wall + 2, d = led_d);
    // A seat for the LED's rim on the inside, so it is pushed in from inside and
    // cannot be pushed through.
    translate([led_pos[0], led_pos[1], body_h - wall - 0.01]) cylinder(h = 1.0 + 0.01, d = led_flange_d);
}

// ---- Aiming groove ------------------------------------------------------------
module aim_groove() {
    // A shallow groove on the top face, directly over the radar boresight, for
    // lining the unit up with the target line.
    translate([win_cx - 0.5, -1, body_h - 0.6]) cube([1.0, body_d + 2, 1]);
}

// ---- Lid fixings ---------------------------------------------------------------
module boss_shape(p) {
    // Each boss is hulled toward the nearest wall so it fuses into the shell.
    toward = (p[0] < body_w / 2 ? -1 : 1);
    up     = (p[1] < body_h / 2 ? -1 : 1);
    corner = (p[0] < 15 || p[0] > body_w - 15) && (p[1] < 15 || p[1] > body_h - 15);
    hull() {
        translate([p[0], y_front - 1, p[1]]) y_cylinder(y_back - y_front + 1, boss_d);
        if (corner)
            translate([p[0] + 2 * toward, y_front - 1, p[1] + 2 * up]) y_cylinder(y_back - y_front + 1, boss_d);
        else
            translate([p[0] + 2.5 * toward, y_front - 1, p[1]]) y_cylinder(y_back - y_front + 1, boss_d);
    }
}

module lid_screw_bosses() { for (p = lid_bosses) boss_shape(p); }

module lid_screw_pilots() {
    for (p = lid_bosses) translate([p[0], y_back - 6.5, p[1]]) y_cylinder(7, m2_pilot);
}

// ----------------------------------------------------------------------------
//  Lid
// ----------------------------------------------------------------------------
module lid() {
    difference() {
        union() {
            intersection() {
                envelope();
                translate([-1, y_back, -1]) cube([body_w + 2, lid_t + 1, body_h + 2]);
            }
            // Locating lip inside the shell.
            difference() {
                xz_extrude(y_back - lid_lip_h, y_back + 0.01) difference() {
                    outline(wall + fit_clear);
                    outline(wall + fit_clear + lid_lip_w);
                }
                for (p = lid_bosses) translate([p[0], 0, p[1]]) y_cylinder(body_d, boss_d + 3.6);
                switch_lid_relief();
            }
            mt3608_fence();
            tp4056_presser();
        }
        aim_groove();
        for (p = lid_bosses) {
            translate([p[0], y_back - 1, p[1]]) y_cylinder(lid_t + 2, m2_clear);
            translate([p[0], body_d - m2_head_h, p[1]]) y_cylinder(m2_head_h + 1, m2_head_d);
        }
    }
}

module switch_lid_relief() {
    translate([body_w - wall - 6, 0, sw_center[1] - 4]) cube([6, body_d, 8]);
}

module mt3608_fence() {
    // Locating fence for the MT3608. Its PCB lies flat on the lid inside the
    // fence and its parts face the cell, with the clearance fit_report() prints.
    // Put Kapton tape on the cell where the module faces it.
    t = 1.0; h = 1.6;
    x0 = mt_pos[0]; z0 = mt_pos[1];
    translate([0, y_back - h, 0]) difference() {
        translate([x0 - t - fit_clear, 0, z0 - t - fit_clear])
            cube([mt_pcb[0] + 2 * (t + fit_clear), h + 0.01, mt_pcb[1] + 2 * (t + fit_clear)]);
        translate([x0 - fit_clear, -1, z0 - fit_clear])
            cube([mt_pcb[0] + 2 * fit_clear, h + 2, mt_pcb[1] + 2 * fit_clear]);
        // Gaps for the four wire pads at the module's short ends.
        translate([x0 - 3, -1, z0 + 3]) cube([mt_pcb[0] + 6, h + 2, mt_pcb[1] - 6]);
    }
}

module tp4056_presser() {
    // Rib from the lid down onto the TP4056's receptacle shell, which keeps the
    // module seated when a cable is plugged in or pulled out.
    top_y = y_front + tp_pad_h + tp_pcb[2] + tp_usb_h;   // receptacle top
    translate([tp_usb_x - esp_usb[0] / 2, top_y + 0.2, z_floor + 1])
        cube([esp_usb[0], y_back - top_y - 0.2 + 0.01, 6]);
}

// ----------------------------------------------------------------------------
//  MagSafe phone holder (screws onto the lid)
// ----------------------------------------------------------------------------
module phone_mount_profile() {
    // The lid's outline, joined smoothly to a disc round the magnet ring that
    // rises above the unit's top edge.
    rc = ring_od / 2 + 3;
    union() {
        outline(0.6);
        hull() {
            translate([ring_center[0], ring_center[1]]) circle(r = rc);
            translate([ring_center[0] - rc * 0.95, body_h - 14]) square([2 * rc * 0.95, 13.4]);
        }
    }
}

module phone_mount() {
    y0 = body_d; y1 = body_d + mount_t;
    c = 0.8;   // soft edge on the phone side
    difference() {
        hull() {
            xz_extrude(y0, y1 - c) phone_mount_profile();
            xz_extrude(y1 - 0.01, y1) offset(delta = -c) phone_mount_profile();
        }
        // Magnet ring pocket, open on the phone side.
        translate([ring_center[0], y1 - ring_depth, ring_center[1]]) difference() {
            y_cylinder(ring_depth + 1, ring_od);
            translate([0, -1, 0]) y_cylinder(ring_depth + 3, ring_id);
        }
        // Alignment magnet below the ring, as on a MagSafe accessory.
        if (orient_slot[0] > 0)
            translate([ring_center[0] - orient_slot[0] / 2, y1 - ring_depth,
                       ring_center[1] - ring_od / 2 - orient_gap - orient_slot[1]])
                cube([orient_slot[0], ring_depth + 1, orient_slot[1]]);
        // Through the lid's screw positions, heads countersunk on the phone side.
        for (p = lid_bosses) {
            translate([p[0], y0 - 1, p[1]]) y_cylinder(mount_t + 2, m2_clear);
            translate([p[0], y1 - m2_head_h, p[1]]) y_cylinder(m2_head_h + 1, m2_head_d);
        }
    }
}

// Print orientation: lid side on the bed, ring pocket facing up.
module phone_mount_print() { translate([0, ring_center[1] + ring_od / 2 + 5, -body_d]) rotate([90, 0, 0]) phone_mount(); }

// ----------------------------------------------------------------------------
//  Optional anti-tip stand
// ----------------------------------------------------------------------------
module stand() {
    floor_z = 12;     // underside of the unit: leaves room for a right-angle plug
    wall_h  = stand_wall_top;   // how far the cradle walls rise up the unit's faces
    gap     = 0.3;
    depth   = body_d + (phone_mount ? mount_t : 0);    // the phone plate stands in the channel too
    cx0 = corner_r - 1; cx1 = body_w - corner_r + 1;    // flat part of the bottom edge
    difference() {
        union() {
            // Base plate: short in front, long behind, which is the side it tips toward.
            translate([0, -8, 0]) linear_extrude(3) rrect(body_w, 70, 6);
            // Cradle block.
            translate([cx0 - wall, -gap - wall, 0])
                cube([cx1 - cx0 + 2 * wall, depth + 2 * gap + 2 * wall, floor_z + wall_h]);
        }
        // Channel the unit stands in.
        translate([cx0, -gap, floor_z]) cube([cx1 - cx0, depth + 2 * gap, wall_h + 1]);
        // Pocket and exit channel for a right-angle USB-C plug, running out the back.
        translate([tp_usb_x - 8, tp_usb_y - 5, 3]) cube([16, 80, floor_z - 3 + 0.01]);
        // Lighten and drain.
        translate([cx0 + 6, 3, 3]) cube([tp_usb_x - 8 - cx0 - 9, body_d - 6, floor_z]);
    }
}

// ----------------------------------------------------------------------------
//  Ghost components (assembly view only)
// ----------------------------------------------------------------------------
// Each component is a named ghost so other tools can export them one at a
// time: `part = "ghost:battery"` exports just the cell, in place. The Blender
// scenes in cad/blender/ are built that way.
ghost_names = ["battery", "tp4056", "mt3608", "esp32", "lm358", "radar", "switch", "led", "boresight", "phone", "magsafe_ring"];

module ghosts() { for (n = ghost_names) ghost(n); }

module ghost(name) {
    if (name == "battery") color("SteelBlue", 0.45)
        translate([batt_pos[0] + batt_clear, y_front, batt_pos[1] + batt_clear])
            cube([batt[0], batt[2], batt[1]]);
    // TP4056 + receptacle
    if (name == "tp4056") color("RoyalBlue", 0.6) translate([tp_x, y_front + tp_pad_h, z_floor - 0.6]) {
        cube([tp_pcb[0], tp_pcb[2], tp_pcb[1]]);
        translate([tp_pcb[0] / 2 - esp_usb[0] / 2, tp_pcb[2], 0]) cube([esp_usb[0], tp_usb_h, 7.3]);
    }
    // MT3608 on the lid
    if (name == "mt3608") color("MediumPurple", 0.6) translate([mt_pos[0], y_back - mt_pcb[2] - mt_parts_h, mt_pos[1]])
        cube([mt_pcb[0], mt_pcb[2] + mt_parts_h, mt_pcb[1]]);
    // ESP32-C3 SuperMini
    if (name == "esp32") color("Black", 0.7) translate([esp_pos[0], y_front + esp_rail_h, esp_pos[1]]) {
        cube([esp_pcb[0], esp_pcb[2], esp_pcb[1]]);
        translate([-0.5, esp_pcb[2], esp_pcb[1] / 2 - esp_usb[0] / 2]) cube([7.3, esp_usb[1], esp_usb[0]]);
    }
    // LM358 board
    if (name == "lm358") color("Green", 0.6) translate([lm_pos[0], y_front + lm_standoff_h, lm_pos[1]])
        cube([lm_pcb[0], lm_pcb[2], lm_pcb[1]]);
    // Radar module, parallel to the window
    if (name == "radar") color("Gold", 0.7) in_window_frame()
        translate([-radar_pcb[0] / 2, win_t + radar_gap, 0]) cube([radar_pcb[0], radar_pcb[2], radar_pcb[1]]);
    if (name == "switch") color("Silver")
        translate([body_w - wall - sw_body[2], sw_center[0] - sw_body[0] / 2, sw_center[1] - sw_body[1] / 2])
            cube([sw_body[2], sw_body[0], sw_body[1]]);
    if (name == "led") color("Red", 0.8) translate([led_pos[0], led_pos[1], body_h - wall - 8.6]) cylinder(h = 8.6, d = 5);
    // Stand-in phone on the MagSafe plate: back on the plate, camera bump at the top.
    if (name == "phone" && phone_mount) color("DimGray") {
        y = body_d + mount_t + 0.5;   // 0.5 mm grip pad
        translate([0, y, 0]) xz_extrude(0, phone[2])
            translate([ring_center[0] - phone[0] / 2, ring_center[1] - phone[1] / 2]) rrect(phone[0], phone[1], 10);
        translate([ring_center[0] - phone[0] / 2 + 4, y - 2, ring_center[1] + phone[1] / 2 - 42])
            cube([36, 2.01, 38]);
    }
    if (name == "magsafe_ring" && phone_mount) color("Silver")
        translate([ring_center[0], body_d + mount_t - ring_depth, ring_center[1]]) difference() {
            y_cylinder(ring_depth - 0.2, ring_od - 0.4);
            translate([0, -1, 0]) y_cylinder(ring_depth + 2, ring_id + 0.4);
        }
    // Boresight indicator: a cone along the radar's 15-degree axis
    if (name == "boresight") color("Orange", 0.5) in_window_frame() translate([0, 0, win_size / 2])
        rotate([90, 0, 0]) cylinder(h = 60, d1 = 1, d2 = 20);
}

// Clamp tab i (0 or 1) where it sits when fitted: on its standoff, over the
// end of the SuperMini.
module esp32_clamp_tab_in_place(i) {
    translate([esp_pos[0] + esp_pcb[0] + 2.2, y_front + esp_rail_h + esp_pcb[2], esp32_tab_z()[i]])
        rotate([-90, 0, 0]) esp32_clamp_tab();
}

// ----------------------------------------------------------------------------
//  Fit report: every clearance that the layout depends on, printed in the
//  console at render time. A negative number is a collision.
// ----------------------------------------------------------------------------
function chk(name, v) = str(v >= 0 ? "  ok   " : "  FAIL ", name, ": ", v, " mm");

module fit_report() {
    radar_x0 = win_cx - win_size / 2 - win_frame;
    radar_x1 = win_cx + win_size / 2 + win_frame;
    // Window opening on the front face must stay inside the R12 outline with a full wall.
    top_on_face = win_size * cos(win_tilt) + win_size * tan(win_tilt) * sin(win_tilt);
    cz = body_h - corner_r; cxr = body_w - corner_r;
    dx = max(0, win_cx + win_size / 2 - cxr); dz = max(0, win_zb + top_on_face - cz);
    lines = [
        chk("depth behind radar module      ", y_back - radar_back_y),
        chk("radar module above TP4056       ", radar_low_z - (z_floor + tp_pcb[1] - 0.6)),
        chk("window opening inside outline   ", (corner_r - wall) - sqrt(dx * dx + dz * dz)),
        chk("LM358 board to radar housing    ", radar_x0 - (lm_pos[0] + lm_pcb[0])),
        chk("ESP32 tab posts to LM358 board  ", lm_pos[0] - (esp_pos[0] + esp_pcb[0] + 2.2 + 2.1)),
        chk("battery bay to TP4056 guide     ", (tp_x - 1 - fit_clear) - (batt_pos[0] + batt[0] + 2 * batt_clear + 1.2)),
        chk("cell + MT3608 depth stack       ", inner_d - (batt[2] + 0.2 + mt_pcb[2] + mt_parts_h)),
        chk("divider to ESP32 board          ", esp_pos[1] - (batt_pos[1] + batt[1] + 2 * batt_clear + 1.2)),
        chk("radar housing to right wall     ", (body_w - wall) - radar_x1),
        // Phone holder: the stand-in phone's bottom edge must clear the stand
        // base, and its camera must see over the unit's top edge.
        chk("phone bottom above stand wall   ", phone_mount ? (ring_center[1] - phone[1] / 2) - (stand_wall_top + 1) : 0),
        chk("phone camera clears unit top    ", phone_mount ? (ring_center[1] + phone[1] / 2 - phone_lens_from_top)
            - (body_h + (body_d + mount_t) * tan(phone_vfov / 2)) : 0),
        chk("alignment magnet inside plate   ", phone_mount ? (ring_center[1] - ring_od / 2 - orient_gap - orient_slot[1]) - 1.5 : 0),
    ];
    for (l = lines) echo(l);
    echo(str("  info  radar window centre ", [win_cx, win_zb + top_on_face / 2],
             ", boresight ", win_tilt, " deg up, skin ", win_t, " mm"));
    echo(str("  info  USB-C receptacle centre X ", tp_usb_x, " Y ", tp_usb_y));
    if (phone_mount) {
        echo(str("  info  tallest phone that clears the stand: ", 2 * (ring_center[1] - stand_wall_top - 1), " mm"));
        echo(str("  info  magnet ring to MT3608 PCB: ", (body_d + mount_t - ring_depth) - (y_back - mt_pcb[2]),
                 " mm (check the 5 V rail with a phone attached)"));
    }
}

// ----------------------------------------------------------------------------
//  Part selector
// ----------------------------------------------------------------------------
fit_report();

if (part == "shell") {
    shell_print();
} else if (part == "lid") {
    lid_print();
} else if (part == "esp32_clamp_tab") {
    esp32_clamp_tab();
} else if (part == "stand") {
    stand();
} else if (part == "phone_mount") {
    phone_mount_print();
} else if (part == "section") {
    // 2D cut through the radar boresight (the Y/Z plane at X = win_cx), for
    // checking the window skin thickness and tilt. Horizontal = Y, vertical = Z.
    mirror([1, 0, 0]) rotate([0, 0, 90]) projection(cut = true) rotate([0, 90, 0]) translate([-win_cx, 0, 0]) union() {
        shell();
        if (show_components) ghosts();
    }
} else if (part == "in_place:shell") {
    shell();
} else if (part == "in_place:lid") {
    lid();
} else if (part == "in_place:tab0") {
    esp32_clamp_tab_in_place(0);
} else if (part == "in_place:tab1") {
    esp32_clamp_tab_in_place(1);
} else if (part == "in_place:stand") {
    stand();
} else if (part == "in_place:phone_mount") {
    phone_mount();
} else if (len(part) > 6 && part[0] == "g" && part[5] == ":") {
    ghost(str_join(part, 6));
} else if (part == "print_plate") {
    shell_print();
    translate([body_w + 8, 0, 0]) lid_print();
    translate([-10, 10, 0]) esp32_clamp_tab();
    translate([-10, 20, 0]) esp32_clamp_tab();
} else {
    shell();
    translate([0, explode, 0]) lid();
    for (i = [0, 1]) esp32_clamp_tab_in_place(i);
    if (phone_mount) translate([0, explode, 0]) phone_mount();
    if (show_components) ghosts();
}

// Characters of s from index i to the end, as a string ("ghost:radar" -> "radar").
function str_join(s, i) = i >= len(s) ? "" : str(s[i], str_join(s, i + 1));

// Print orientations.
// Shell: front face on the bed (Y = 0 -> Z = 0). The window recess then needs
// support, which "tree supports touching the build plate only" provides.
module shell_print() { translate([0, body_h, 0]) rotate([90, 0, 0]) shell(); }
// Lid: outside face on the bed (Y = body_d -> Z = 0), lip and fence facing up.
module lid_print()   { translate([0, 0, body_d]) rotate([-90, 0, 0]) lid(); }
