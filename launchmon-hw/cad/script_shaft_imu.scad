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
//  The clamp is a C, wrapping 230 degrees, with a recessed band for a
//  0.8 mm silicone or neoprene liner. The liner stands 0.2 mm proud and grips.
//  A zip-tie tunnel and an outside groove on each jaw take a tie that closes
//  the C. FIT THE TIE: at clubhead speed a pod that comes loose is a
//  projectile. The clamp alone is not enough to rely on.
//
//  PRINTED PARTS (set `part`):
//      "base"      body + clamp   (print standing on the USB end, bore vertical)
//      "lid"       snap-on lid    (print flat, outside face down)
//      "assembly"  both, with ghost components
//      "section"   2D cut across the shaft, through the jaw
// =============================================================================

/* [Render] */
part            = "assembly";   // [assembly, base, lid, section, print_plate]
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

bore_r  = shaft_d / 2;
jaw_R   = bore_r + jaw_t;
bore_z  = -(bore_r + web);                       // bore centre
bore_y  = pod[1] / 2;
jaw_xs  = [[0, jaw_w], [pod[0] - jaw_w, pod[0]]];

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
    }
    imu_pocket();
    battery_stops();
}

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
    translate([-1, bore_y - 9.2 / 2, z_usb_c - 3.8 / 2]) cube([wall + 2, 9.2, 3.8]);
    translate([-1, bore_y - 12.4 / 2, z_usb_c - 6.4 / 2]) cube([1 + 0.6, 12.4, 6.4]);
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
    }
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
ghost_names = ["imu", "imu_axes", "battery", "charger", "esp32", "shaft", "liner"];

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
}

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
}

// ----------------------------------------------------------------------------
//  Part selector
// ----------------------------------------------------------------------------
fit_report();

if (part == "base") {
    base_print();
} else if (part == "lid") {
    lid_print();
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
