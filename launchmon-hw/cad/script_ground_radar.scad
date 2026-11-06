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
//  tips over easily, so it stands in a dock: a base with lips front and rear,
//  and a stem behind the unit with a standard 1/4"-20 tripod stud on top.
//
//  DESIGN (docs/design_language.md says why)
//  One matte black object with one focal point, the radar window: a smoked
//  radome in a bevelled pocket. Edges that print on the bed are chamfered,
//  edges that stand up are rounded. The seam is a deliberate shadow gap.
//  Everything printed is printed without supports.
//
//  COORDINATES (as used, not as printed)
//      X  0 -> 96   left to right, seen from in front (the target side)
//      Z  0 -> 64   ground up.  Z = 0 is the bottom face the unit stands on
//      Y  0 -> 21   front face (radar window) to back face (removable lid)
//
//  INTERNAL LAYOUT (front view)
//
//      Z 64 +--------------------------------------------------------------+
//           | [ESP32-C3 SuperMini]                [ radar, 15 deg tilted ]  |
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
//  POD PARK: the club pod parks on the back of this unit, left of the dock's
//  stem, hanging +X end up in a small hood screwed to the lid, and charges
//  there from the MT3608's 5 V. One object to carry, one cable to charge.
//  SIGHT: a front post and rear notch on the top face, over the boresight.
//  BUZZER: a bare piezo disc on the inside of the left end wall, sounding
//  through louvred slots hidden in the grip ribs.
//
//  PRINTED PARTS (set `part`):
//      "shell"             front face + side walls (print front face DOWN)
//      "lid"               rear cover, carries the MT3608   (print flat, lip UP)
//      "radome"            radar window, translucent smoke PETG (print flat)
//      "led_pipe"          status light pipe, natural PETG (print flange down)
//      "esp32_clamp_tab"   x2, M2 clamp tabs for the SuperMini (no holes on it)
//      "dock_base"         dock base with lips and the stem's socket
//      "dock_stem"         stem with the 1/4"-20 stud cap, or the MagSafe ring (print flat)
//      "pod_park_hood"     the hood the pod parks and charges in, on the lid (print rear face down)
//      "fit_test_coupon"   print this first: every tight fit of both units on one 10-minute plate
//      "assembly"          everything placed, with ghost components (viewing only)
//      "print_plate"       shell + lid + small parts laid out for one export
// =============================================================================

// The pod's own geometry and numbers, for the parked pod and the hood's socket.
// `use` imports its modules and functions only; its variables stay its own.
use <script_shaft_imu.scad>

/* [Render] */
part            = "assembly";   // [assembly, shell, lid, radome, led_pipe, esp32_clamp_tab, dock_base, dock_stem, pod_park_hood, fit_test_coupon, print_plate, section]
// Also: "in_place:shell|lid|radome|led_pipe|tab0|tab1|dock_base|dock_stem|pod_park_hood" and "ghost:<name>" export one
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
front_chamfer = 1.6;  // 45-degree edge round the front face: catches the light as one crisp line,
                      // and on the bed it stops the first layers squashing out ("elephant's foot")
rear_chamfer  = 1.0;
reveal      = [0.5, 0.8];  // shadow gap at the shell/lid seam [depth, width]: a printed seam never
                           // lines up perfectly, so it is made a deliberate line instead

/* [Surface details] */
rib_pitch   = 1.6;    // grip ribs on both end faces, upper half
rib_w       = 0.8;
rib_d       = 0.4;
rib_z       = [27, 49];
wordmark    = "STEM";
wordmark_size = 5.5;
mark_depth  = 0.4;    // debossed marks: two layers at 0.20 mm
font        = "Liberation Sans:style=Bold";

/* [Radar window - Infineon BGT24LTR11] */
win_size    = 25.4;   // square aperture, measured in the plane of the window
win_t       = 1.0;    // radome: 1.0 - 1.2 mm keeps PETG/ABS nearly transparent at 24 GHz.
                      // 1.0 mm is five 0.20 mm layers, so the slicer prints exactly this
win_tilt    = 15;     // boresight elevation above horizontal, degrees
win_cx      = 76.1;   // window centre, X
win_zb      = 33.0;   // window bottom edge, Z, where it meets the front face
win_frame   = 1.2;    // wall thickness of the window's internal housing
win_r       = 3.0;    // radome corner radius
win_chamfer = 0.8;    // bevel round the window opening on the front face
radome_clear = 0.15;  // radome to pocket, per side
ledge_w     = 1.2;    // ledge the radome sits on, round the aperture
ledge_t     = 1.2;
ledge_pad   = 5.1;    // square pads in the ledge's corners carry the radar posts, 0.3 mm round each post
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
led_pos     = [22.75, 13.0];       // [X, Y] on the top face
led_hole_d  = 3.0;                 // the light pipe shows as a 2.8 mm dot, flush with the face
pipe_d      = 2.8;
pipe_flange = [6.0, 0.8];          // [diameter, thickness]; the 5 mm LED's dome sits under it

/* [Dock - stand and phone holder in one] */
// The unit drops into the dock's base between a front lip and the stem. The
// stem rises behind the unit and carries a phone, screen toward the golfer, as
// a results display. The stem is printed flat, so both faces are smooth, then
// screwed into the base.
//
// THE CAMERA IS NOT ON THE DOCK. A phone here sits 15 cm off the ground,
// 1.4 m behind the ball: too low and too close to frame the golfer for swingml.
// Film from a tripod about 3 m behind, at hip height (docs/build_instructions.md,
// "Placing it"). Fusion aligns the video by the sound of the strike, so the
// camera does not need to be on the unit.
//
// Two stem heads:
//   "stud"     a 1/4"-20 tripod stud on a cap above the unit. Any phone clamp,
//              any phone size, MagSafe or not, screws on. The default.
//   "magsafe"  a ring carrying a MagSafe-compatible magnet ring, for iPhones
//              (or phones in a MagSafe case) with nothing else to buy.
phone_mount   = true;           // false: dock base only, no stem
holder        = "stud";         // [stud, magsafe]
dock_t        = 2.4;            // base plate
dock_lip_h    = 6.0;            // lips up the unit's front and rear faces
dock_gap      = 0.3;            // unit to lips and stem
dock_depth    = 58;             // base, front lip to rear edge
stem_t        = 4.0;            // stem and ring thickness
stem_neck_w   = 24;
stem_fillet   = 10;             // where the neck meets the ring
stem_hole_d   = 30;             // opening in the middle of the ring
stem_chamfer  = 0.6;            // edges of the stem, printed as three 0.2 mm steps
buttress      = [28, 6, 10];    // block behind the stem's foot [X, Y, Z]
foot_d        = 8.2;            // recesses for 8 mm silicone bumpers under the base
// 1/4"-20 stud: a 1/4"-20 x 1/2" hex bolt, glued head-down in a hex pocket that
// opens under the cap, thread up. Tripod screws stand 4.5-6 mm proud.
cap           = [30, 22, 11.4]; // [X, Y from the stem's front face, Z]
cap_top       = 74;             // 10 mm above the unit's top edge
bolt_len      = 12.7;           // 1/2", under the head
bolt_head     = [11.11, 3.97];  // 7/16" across flats, head height
bolt_d        = 6.35;
bolt_clear    = [0.3, 0.25, 0.25];  // pocket over the bolt: [across flats, head height, thread hole d]. The fit
                                    // test coupon's "1/4" hex is this pocket: the head should push in snug
stud_behind   = 8;              // stud axis behind the stem's rear face

// MagSafe ring head
ring_center   = [48, 104];      // magnet ring centre, front-view [X, Z] above the unit's bottom: the ring clears
                                // the unit's top edge by 9 mm, so the neck shows between them
ring_od       = 56.5;           // aftermarket MagSafe magnet ring: MEASURE YOURS
ring_id       = 45.5;
ring_depth    = 1.8;            // pocket depth; the ring sits flush, under a 0.5 mm grip pad
orient_slot   = [12.5, 6.5];    // alignment ("tail") magnet below the ring [X, Z]; [0, 0] for none
orient_gap    = 2.5;            // ring OD to the slot's top edge
phone         = [71.6, 147.6, 8.3];  // stand-in phone for fit checks and renders [W, H, T]
phone_lens_from_top = 25;       // main camera centre below the phone's top edge (typical)
phone_vfov    = 65;             // camera vertical field of view, portrait, degrees

/* [Pod park - the club pod parks on the lid and charges from this unit] */
// Not the dock: the dock is the stand. The pod hangs +X end up (its arrow
// points into the hood) under a hood screwed to the lid from inside, left of
// the stem. Two magnet pairs pull it up against two spring pins, which meet
// the brass contacts in the pod's end face (script_shaft_imu.scad, "pod park").
// The pins carry the MT3608's 5 V through the protection board in the pocket
// on the lid behind them. Everything for it lives on the lid.
pod_park        = true;         // false: no hood, no holes in the lid, no board pocket
pod_park_cx     = 18;           // pod centre line, X: between the left end and the stem neck (X 36)
pod_park_z0     = 11;           // pod's USB end, Z: above the lower-left lid screw and the dock's rear lip
pod_park_gap    = 0.6;          // pod's jaw tips to the lid's outer face
pod_park_hood   = [30, 11.4, 4, 0.8];  // [X, Z, corner R, chamfer]: the stem cap's face, so the two read as a pair
pod_park_wall   = 1.6;
pod_park_rim    = 2.0;          // hood behind the pod's lid
pod_park_socket = [1.5, 0.3];   // [depth, clearance] of the pocket the pod's end sits in: its outline keys it.
                                // The fit test coupon's socket frame and pod-end key are this fit
// Spring (pogo) pins, one per contact, pointing down. MEASURE THE PINS YOU BUY
// and set these: the defaults are a common 2 x 6 mm, 1 mm stroke pin.
pod_park_pogo   = [2.0, 6.0, 1.0, 1.5, 1.0];  // [barrel d, length extended, stroke, plunger exposed, tip d]
pod_park_pogo_fit = -0.05;      // bore = barrel d + this: a press fit, plus a drop of CA. Print the fit test
                                // coupon first: add the offset of the bore the pin presses into snugly
pod_park_mag_fit = 0.1;         // magnet pocket over the magnet, diameter and depth (the coupon's "HOOD" pockets)
pod_park_recess = 0.6;          // extended pin tip above the socket floor, up inside its well: a coin or a
                                // wet leaf across the socket cannot reach both, and the hood faces down.
                                // The pod's heads (1.3 proud) then press the pins 0.7 of their 1 mm stroke.
                                // Compression >= 0.4 and stroke left >= 0.1 share that 1 mm, so their fit-report
                                // margins add up to 0.5 and cannot both reach 0.3. Compression gets 0.3; stroke
                                // left keeps 0.2, and only grows in practice: DIN 84 heads are 1.16-1.3 mm tall,
                                // never taller than pod_park_pad's 1.3. Set the pins with the coupon's key.
pod_park_well   = 0.8;          // well diameter over the pod's contact head
pod_park_plate  = 5.5;          // pin plate, socket floor up to the wiring space
pod_park_screws = [6.5, 29.5];  // X of the two M2 x 6 that hold the hood, driven from inside the lid
pod_park_wire   = [[16.3, 19.7], 1.6];  // [[X, X], d] one hole per wire through the lid, behind the hood, 0.3 mm clear of its rib
pod_park_board  = [15, 12, 4.3];  // protection board [X, Z, room reserved off the lid]: MOSFET switch, polyfuse, passives
pod_park_board_pos = [10.0, 35.6];  // its pocket's lower-left [X, Z] on the lid's inner face, 0.3 mm under the wire holes

/* [Fit test coupon - print it before anything else] */
// A small flat print with the fits the build depends on, cut by the same
// modules and parameters as the parts, so it always tests what is about to be
// printed (docs/build_instructions.md, "Print the test piece first"). Each
// label is an offset from its parameter's current value: "+.1" is that
// parameter + 0.1. Pick the one that fits, add its offset, re-export.
coupon_pin_steps = [-0.1, 0, 0.1, 0.2];  // spring-pin bores, added to pod_park_pogo_fit
coupon_mag_steps = [0, 0.1];             // magnet pockets: hood + pod_park_mag_fit, pod + pod_park_mag_clear
coupon_text      = 3.0;                  // label height: 3 mm bold is about the smallest a 0.4 mm nozzle draws cleanly
coupon_text_pins = 2.6;                  // the pin block's labels, which share the pins' 6 mm pitch
coupon_key_t     = 1.2;                  // the pod-end key's plate
coupon_t         = 1.2;                  // the coupon's flat plate; under the pod's features it is the pod's end wall
coupon_rim       = 1.6;                  // plastic round the coupon's holes
coupon_gap       = 4.0;                  // between the pieces on the plate

/* [Sight - front post and rear notch over the boresight] */
// Lines the unit up with the target line quickly and repeatably. The speed
// error from a small misaim is tiny (1 - cos), so this is for fast setup and
// for keeping the target well inside the beam, not for precision.
sight_h      = 2.5;           // post tip and notch top above the top face
sight_post   = [1.2, 1.2];    // front post [width X, flat top along Y]
sight_notch  = [2.2, 1.4];    // rear notch [width, depth]: 0.5 mm of light each side of the post, which a
                              // printed notch keeps and the eye can still compare
sight_blade  = 8.0;           // rear blade width, X

/* [Buzzer - bare piezo disc] */
// Brass face toward the inside of the left end wall, glued by its rim onto a
// seat that holds it pz_cavity off the wall: a disc glued down flat cannot
// flex and is nearly silent. It sounds through louvred slots in the grip ribs.
pz_d        = 15.0;           // brass disc diameter
pz_t        = 0.3;            // brass thickness
pz_ceramic  = [10.0, 0.25];   // piezo ceramic on the inner face [d, t]
pz_seat     = 0.8;            // rim glued to the seat
pz_cavity   = 1.2;            // air between the brass and the wall
pz_cy       = 10.45;          // disc centre, Y (middle of the inside depth; the seat 0.3 mm short of the lid)
pz_slot_ribs = [0, 2, 4, 6];  // which grip-rib grooves (from the lowest) open through as slots
pz_slot_len = 7.8;            // along Y; keeps the slots' ends 0.3 mm inside the cavity
pz_slant    = 45;             // slots rise inward, so rain cannot run in and water inside drains out

/* [Fasteners - M2] */
m2_pilot    = 1.7;    // thread-forming M2 straight into PETG/ABS (the fit test coupon's "M2x6" boss)
m2_len      = 6.0;    // every M2 screw on the unit is an M2 x 6
lid_pilot_depth = 6.5;  // lid screw pilots into the shell's bosses
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

/* [Lid seam gasket - TPU 95A, printed flat] */
// A groove round the lid's inner face, between the shadow gap and the lip,
// holds a flat-printed TPU ring: a base that sits in the groove and a single
// fin that stands gasket[4] proud and meets the shell's rim when the four lid
// screws are driven. Hidden: the shadow gap and the outer size are unchanged.
gasket       = [1.35, 1.2, 1.0, 0.5, 0.2];  // [groove's outer edge in from the outline, groove width, groove depth,
                                            //  fin width (one line), fin proud of the lid face]
gasket_base  = 0.6;    // base thickness (three layers); the fin rises gasket[2] + gasket[4] - this above it
gasket_fit   = 0.05;   // base narrower than the groove, each side: it presses in and stays when the lid is off

/* [Power / wake board - on the lid's inner face, beside the protection board] */
power_board     = [20, 15, 4.3];   // perfboard [X, Z, room reserved off the lid]
power_board_pos = [36.0, 41.0];    // its pocket's lower-left [X, Z] on the lid's inner face: where the
                                   // LM358 was, between the SuperMini's clamp tabs and the radar housing

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
stem_y0       = body_d + dock_gap;          // stem front face
stem_y1       = stem_y0 + stem_t;           // stem rear face (the phone side)
stud_y        = stem_y1 + stud_behind;      // 1/4"-20 stud axis, Y
radar_back_y  = radar_stack * cos(win_tilt) + win_size * sin(win_tilt);
radar_low_z   = win_zb - (win_t + radar_gap) * sin(win_tilt);  // module bottom edge

// Pod park: the pod's numbers come from its own script.
pp       = pod_park_spec();     // [size, pads, magnets, pad, magnet, skin, back z, end wall, magnet clearance]
pp_size  = pp[0];
pp_pad   = pp[3];
pp_mag   = pp[4];
pp_tx    = pod_park_cx - pp_size[1] / 2;             // pod (x, y, z) -> unit (pp_tx + y, pp_ty + z, pp_tz + x)
pp_ty    = body_d + pod_park_gap - pp[6];
pp_tz    = pod_park_z0;
function pp_at(p) = [pp_tx + p[0], pp_ty + p[1]];    // a point on the pod's end face, [Y, Z] -> unit [X, Y]
pp_pads  = [for (p = pp[1]) pp_at(p)];               // [0] GND, [1] +5 V
pp_mags  = [for (m = pp[2]) pp_at(m)];
pp_floor = pp_tz + pp_size[0];                       // socket floor = the pod's +X end face
pp_hz0   = pp_floor - pod_park_socket[0];
pp_hz1   = pp_hz0 + pod_park_hood[1];
pp_hx0   = pod_park_cx - pod_park_hood[0] / 2;
pp_hx1   = pod_park_cx + pod_park_hood[0] / 2;
pp_hy1   = pp_ty + pp_size[2] + pod_park_rim;
pp_well_top = pp_floor + pod_park_recess + pod_park_pogo[3];   // barrel's lower end
pp_tail  = pp_floor + pod_park_recess + pod_park_pogo[1];      // barrel's upper end
pp_screw_z = pp_floor + pod_park_plate / 2;
pp_wire_z  = (pp_floor + pod_park_plate + pp_hz1 - 1.2) / 2;   // middle of the wiring space
pp_bin   = [pod_park_board[0] + 0.4, pod_park_board[1] + 0.4]; // board pocket inside the fence [X, Z]

// Sight
sight_rear_y = (y_back + reveal[1] + body_d) / 2;     // rear blade, mid-thickness
sight_radius = sight_rear_y - sight_post[1] / 2;

// Buzzer: the slots rise from the rib grooves outside to the cavity inside;
// the disc is centred on their inner ends.
pz_rise  = wall * tan(pz_slant);
pz_slot_z = [for (k = pz_slot_ribs) rib_z[0] + k * rib_pitch];   // outer ends
pz_cz    = (pz_slot_z[0] + pz_slot_z[len(pz_slot_z) - 1]) / 2 + pz_rise;
pz_seat_r = pz_d / 2 + 0.15;
pz_x1    = wall + pz_cavity + pz_t + 0.1;             // inner face of the mount
pz_block = [y_front - 0.01, min(y_back - 0.2, pz_cy + pz_seat_r + 0.25), pz_cz - pz_seat_r - 1.0, pz_cz + pz_seat_r + 1.0];  // [y0, y1, z0, z1]

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
    hull() {
        xz_extrude(0, 0.01)                         outline(front_chamfer);
        xz_extrude(front_chamfer, body_d - rear_chamfer) outline(0);
        xz_extrude(body_d - 0.01, body_d)           outline(rear_chamfer);
    }
}

// The radome's outline in the window plane: local x across, local z up from
// the window's bottom edge.
module win_shape(inset = 0) {
    translate([-win_size / 2 + inset, inset])
        rrect(win_size - 2 * inset, win_size - 2 * inset, max(0.5, win_r - inset));
}

// The clear aperture behind the radome: the ledge round it, with square pads
// in the corners where the radar module's posts stand.
module ledge_opening() {
    difference() {
        win_shape(ledge_w);
        for (sx = [-1, 1], z = [0, win_size - ledge_pad])
            translate([sx > 0 ? win_size / 2 - ledge_pad : -win_size / 2, z]) square(ledge_pad);
    }
}

module y_cone(h, d1, d2) { rotate([-90, 0, 0]) cylinder(h = h, d1 = d1, d2 = d2); }

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
            battery_bay();
            tp4056_pocket();
            switch_holder();
            sight_post();
            pz_mount();
        }
        // Holes and cutouts through everything above.
        lid_screw_pilots();
        standoff_pilots();
        usb_c_cutout();
        switch_slot();
        led_hole();
        aim_groove();
        window_bevel();
        side_ribs();
        front_wordmark();
        pz_cuts();
    }
}

// ---- Radar window -----------------------------------------------------------
// The window is a separate part, the radome: a 1.0 mm plate printed flat, so
// its thickness is exact and both faces are smooth. It drops into a rounded
// pocket in the front face, flush at its bottom edge, and is glued onto a ledge.
// Printing the window as part of the shell would put it on supports, with a
// rough face and a thickness that varies. As a separate part it needs neither,
// and the shell prints with no supports at all.
module window_recess() {
    // The pocket in front of the tilted radome, and the radome's own slot.
    in_window_frame() xz_extrude(-40, win_t) win_shape();
}

module window_bevel() {
    // A 45-degree bevel round the opening on the front face.
    hull() {
        intersection() {
            in_window_frame() xz_extrude(-40, 12) offset(delta = win_chamfer) win_shape();
            translate([0, -1, 0]) cube([body_w, 1, body_h]);
        }
        intersection() {
            in_window_frame() xz_extrude(-40, 12) win_shape();
            translate([0, win_chamfer, 0]) cube([body_w, 0.01, body_h]);
        }
    }
}

module window_rear_clearance() {
    // Hollow out the front wall behind the radome, so the module can sit square
    // behind it.
    in_window_frame() translate([-win_size / 2, win_t, 0])
        cube([win_size, radar_stack + 2, win_size]);
}

module window_housing() {
    // A collar round the aperture. Above the bottom edge the window sits behind
    // the front face, so the collar forms the side walls and roof of the pocket.
    // Behind the radome it closes in to the ledge and corner pads.
    in_window_frame() difference() {
        translate([-win_size / 2 - win_frame, -40, -win_frame])
            cube([win_size + 2 * win_frame, 40 + win_t + ledge_t, win_size + 2 * win_frame]);
        xz_extrude(-41, win_t) win_shape();
        xz_extrude(win_t - 0.01, win_t + ledge_t + 1) ledge_opening();
    }
}

module radar_posts() {
    // M2 standoffs on the corner pads, normal to the window, so the module sits
    // parallel to the radome at radar_gap behind it.
    post = radar_gap - ledge_t;
    in_window_frame() for (h = radar_holes)
        translate([h[0], win_t + ledge_t - 0.01, h[1]]) difference() {
            y_cylinder(post + 0.01, 4.6);
            translate([0, post - 4.5, 0]) y_cylinder(5, m2_pilot);
        }
}

module radome() {
    // As fitted: outer face on the window plane, flush with the front face at
    // its bottom edge.
    in_window_frame() xz_extrude(0, win_t) offset(delta = -radome_clear) win_shape();
}
// Print flat, outer face up, with ironing on the top surface for a smooth finish.
module radome_print() {
    translate([win_size / 2, 0, 0]) linear_extrude(win_t) offset(delta = -radome_clear) win_shape();
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

module standoff_pilots() {
    // Pilot holes are cut after the union so they continue into the front wall
    // where a standoff is shorter than the screw. At least 1.4 mm of front wall
    // is always left intact. (The LM358 pre-amp and its four standoffs are gone:
    // the radar module's own IF amplifiers drive the ADC.)
    max_into_wall = wall - 1.4;
    esp_top = esp_rail_h + esp_pcb[2];
    for (z = esp32_tab_z())
        translate([esp_pos[0] + esp_pcb[0] + 2.2, y_front - min(max_into_wall, 4.4 - esp_top), z])
            y_cylinder(esp_top + 5, m2_pilot);
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
    // the ground while the unit stands, which keeps rain off it. Charge the
    // unit out of the dock, lying on its back.
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

// 2D shapes drawn in the Y/Z plane, extruded along X from x0 to x1.
module yz_extrude(x0, x1) { translate([x0, 0, 0]) rotate([90, 0, 90]) linear_extrude(x1 - x0) children(); }

module switch_slot() {
    // Actuator slot through the wall, plus a 1 mm pill-shaped recess outside so
    // the lever sits below the surface and a stray club or foot does not switch it.
    translate([body_w - wall - 1, sw_center[0] - sw_slot[0] / 2, sw_center[1] - sw_slot[1] / 2])
        cube([wall + 2, sw_slot[0], sw_slot[1]]);
    yz_extrude(body_w - 1.0, body_w + 1)
        translate([sw_center[0] - 4.5, sw_center[1] - 2.8]) rrect(9, 5.6, 2.8);
}

// ---- Status light, top face ---------------------------------------------------
module led_hole() {
    // A 3 mm hole for the light pipe, with a seat inside for its flange. The 5 mm
    // LED sits under the flange, so the light shows as a small flush dot.
    translate([led_pos[0], led_pos[1], body_h - wall - 1]) cylinder(h = wall + 2, d = led_hole_d);
    translate([led_pos[0], led_pos[1], body_h - wall - 0.01]) cylinder(h = pipe_flange[1] + 0.01, d = pipe_flange[0] + 0.3);
    translate([led_pos[0], led_pos[1], body_h - 0.4]) cylinder(h = 0.41, d1 = led_hole_d, d2 = led_hole_d + 0.8);
}

module led_pipe() {
    // Printed in natural (translucent) PETG, flange down. Glue the LED to it.
    cylinder(h = pipe_flange[1], d = pipe_flange[0]);
    cylinder(h = wall, d = pipe_d);
}
module led_pipe_in_place() { translate([led_pos[0], led_pos[1], body_h - wall]) led_pipe(); }

// ---- Aiming: sight and groove ----------------------------------------------------
module aim_groove() {
    // A round-ended groove on the top face, directly over the radar boresight,
    // joining the front post to the rear notch, so the three read as one line.
    hull() for (y = [sight_post[1] + sight_h + 1.0, y_back - 1.6])
        translate([win_cx, y, body_h - mark_depth]) cylinder(h = 1, d = 0.8, $fn = 16);
}

module sight_post() {
    // Front post: a ramped blade at the top front edge, over the window centre.
    // Its front face is in the plane of the front face, so it starts on the bed
    // as the shell prints; the ramp behind it faces up. No supports.
    t = body_h + sight_h; f = sight_post[1];
    yz_extrude(win_cx - sight_post[0] / 2, win_cx + sight_post[0] / 2)
        polygon([[0, body_h - front_chamfer - 0.4], [0, t], [f, t], [f + sight_h + 0.5, body_h - 0.5],
                 [front_chamfer, body_h - 0.5]]);
}

module sight_rear() {
    // Rear blade with a U notch, on the lid's top edge behind the shadow gap.
    // Its rear face is the lid's outer face, so it starts on the bed as the lid
    // prints. Its bed edges are chamfered 0.4 mm like every other.
    y0 = y_back + reveal[1]; z0 = body_h - rear_chamfer - 0.5; z1 = body_h + sight_h;
    x0 = win_cx - sight_blade / 2;
    difference() {
        hull() {
            translate([x0 + 0.4, body_d - 0.01, z0]) cube([sight_blade - 0.8, 0.01, z1 - z0 - 0.4]);
            translate([x0, y0, z0]) cube([sight_blade, body_d - 0.4 - y0, z1 - z0]);
        }
        translate([win_cx - sight_notch[0] / 2, y0 - 1, z1 - sight_notch[1]]) cube([sight_notch[0], 4, 2]);
    }
}

// ---- Buzzer: piezo disc on the left end wall ------------------------------------
module pz_mount() {
    // A frame on the inside of the left wall. The disc's brass face sits in a
    // shallow seat on it, glued by its rim, over a cavity that opens through
    // the wall into the grip-rib grooves.
    b = pz_block;
    translate([wall - 0.01, b[0], b[2]]) cube([pz_x1 - wall + 0.01, b[1] - b[0], b[3] - b[2]]);
}

module pz_cuts() {
    // Cavity (teardrop-topped: the shell prints with Y up), the disc's seat,
    // and the louvred slots: each rises pz_slant from a rib groove outside to
    // the cavity inside.
    r = pz_d / 2 - pz_seat;
    yz_extrude(wall, pz_x1 - pz_t - 0.1 + 0.01) intersection() {
        translate([pz_cy, pz_cz]) hull() { circle(r = r); translate([r * sqrt(2), 0]) circle(r = 0.01); }
        translate([0, 0]) square([pz_cy + pz_seat_r, 100]);
    }
    yz_extrude(pz_x1 - pz_t - 0.1, pz_x1 + 0.01) translate([pz_cy, pz_cz]) circle(r = pz_seat_r);
    for (z = pz_slot_z)
        translate([0, pz_cy - pz_slot_len / 2, 0]) rotate([90, 0, 0]) mirror([0, 0, 1]) linear_extrude(pz_slot_len)
            polygon([[-1, z - rib_w / 2 - tan(pz_slant)], [-1, z + rib_w / 2 - tan(pz_slant)],
                     [wall + 0.5, z + rib_w / 2 + (wall + 0.5) * tan(pz_slant)],
                     [wall + 0.5, z - rib_w / 2 + (wall + 0.5) * tan(pz_slant)]]);
}

// ---- Grip ribs and wordmark -------------------------------------------------------
module side_ribs() {
    // Fine grooves along both end faces, upper half, where the unit is held.
    for (x = [-1, body_w - rib_d], z = [rib_z[0] : rib_pitch : rib_z[1]])
        translate([x, front_chamfer + 2, z - rib_w / 2]) cube([rib_d + 1, y_back - front_chamfer - 3.5, rib_w]);
}

module front_wordmark() {
    xz_extrude(-1, mark_depth) translate([10, 9])
        text(wordmark, size = wordmark_size, font = font, spacing = 1.25);
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
    for (p = lid_bosses) translate([p[0], y_back - lid_pilot_depth, p[1]]) y_cylinder(lid_pilot_depth + 0.5, m2_pilot);
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
                pz_lid_relief();
            }
            mt3608_fence();
            tp4056_presser();
            if (pod_park) pod_park_board_fence();
            board_fence(power_board_pos, pb_bin);
            sight_rear();
        }
        // Shadow gap at the seam: the lid's edge steps in for its first 0.8 mm.
        xz_extrude(y_back - 0.01, y_back + reveal[1]) difference() { outline(-2); outline(reveal[0]); }
        for (p = lid_bosses) {
            translate([p[0], y_back - 1, p[1]]) y_cylinder(lid_t + 2, m2_clear);
            translate([p[0], body_d - m2_head_h, p[1]]) y_cylinder(m2_head_h + 1, m2_head_d);
            translate([p[0], body_d - 0.4, p[1]]) y_cone(0.41, m2_head_d, m2_head_d + 0.8);
        }
        if (pod_park) pod_park_lid_holes();
        gasket_groove();
    }
}

// ---- Lid seam gasket --------------------------------------------------------------
gk_in  = gasket[0];                       // groove, outer edge (in from the outline)
gk_out = gasket[0] + gasket[1];           // groove, inner edge
gk_c   = gasket[0] + gasket[1] / 2;       // fin centre line
gk_h   = gasket[2] + gasket[4];           // gasket overall height
module gasket_groove() {
    xz_extrude(y_back - 0.01, y_back + gasket[2]) difference() { outline(gk_in); outline(gk_out); }
}
// Printed flat, base down (the 2D outline's [X, Z] laid on the bed as [X, Y]).
module lid_gasket() {
    linear_extrude(gasket_base) difference() { outline(gk_in + gasket_fit); outline(gk_out - gasket_fit); }
    linear_extrude(gk_h) difference() { outline(gk_c - gasket[3] / 2); outline(gk_c + gasket[3] / 2); }
}
// As fitted, in the lid's groove, fin toward the shell (for the assembly view).
module lid_gasket_in_place() { translate([0, y_back + gasket[2], 0]) rotate([90, 0, 0]) lid_gasket(); }
// How far in from the outline a point [X, Z] on the lid is.
function inset_of(p) = let(cx = min(max(p[0], corner_r), body_w - corner_r), cz = min(max(p[1], corner_r), body_h - corner_r))
    (cx == p[0] && cz == p[1]) ? min(p[0], body_w - p[0], p[1], body_h - p[1]) : corner_r - norm([p[0] - cx, p[1] - cz]);

// ---- Power / wake board pocket ------------------------------------------------------
pb_bin = [power_board[0] + 0.4, power_board[1] + 0.4];   // pocket inside its fence [X, Z]
module board_fence(pos, bin) {
    // A pocket on the lid's inner face, 1.6 mm deep, with gaps top and bottom for
    // its wires. Fix the board with a dab of hot glue.
    t = 1.0; h = 1.6;
    translate([0, y_back - h, 0]) difference() {
        translate([pos[0] - t, 0, pos[1] - t]) cube([bin[0] + 2 * t, h + 0.01, bin[1] + 2 * t]);
        translate([pos[0], -1, pos[1]]) cube([bin[0], h + 2, bin[1]]);
        translate([pos[0] + bin[0] / 2 - 3, -1, pos[1] - t - 1]) cube([6, h + 2, bin[1] + 2 * t + 2]);
    }
}

module pz_lid_relief() {
    // The lip steps round the buzzer's mount.
    translate([-1, 0, pz_block[2] - 0.5]) cube([wall + fit_clear + lid_lip_w + 2, body_d, pz_block[3] - pz_block[2] + 1]);
}

module pod_park_lid_holes() {
    // Clearance for the hood's two screws, driven from inside, and one hole per
    // wire into the hood's wiring space. The hood covers all of them.
    for (x = pod_park_screws) translate([x, y_back - 1, pp_screw_z]) y_cylinder(lid_t + 2, m2_clear);
    for (x = pod_park_wire[0]) translate([x, y_back - 1, pp_wire_z]) y_cylinder(lid_t + 2, pod_park_wire[1]);
}

module pod_park_board_fence() {
    // Pocket for the protection board (MOSFET switch, polyfuse, resistors) on
    // the lid's inner face, just below where the pins' wires come through.
    board_fence(pod_park_board_pos, pp_bin);
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
//  Dock: the stand and the MagSafe phone holder in one, in two printed parts
// ----------------------------------------------------------------------------
// Coordinates as the unit's: the base's top face is Z = 0, where the unit
// stands. The base is printed as it sits; the stem is printed flat.
dock_cx0 = corner_r - 1;               // the flat part of the unit's bottom edge
dock_cx1 = body_w - corner_r + 1;
dock_y0  = -dock_gap - wall;           // front face of the front lip
stem_foot = dock_t - 0.8;              // how far the stem sits down into the base
stem_screws = [[ring_center[0] - 7, 5], [ring_center[0] + 7, 5]];   // [X, Z], M2 x 6 from behind
stem_pilot_depth = 3.3;                // their pilots into the stem: 0.7 mm of the stem's front face left
stem_screw_seat  = 3.0;                // their heads seat this far behind the stem, so the tips stop 0.3 short

module dock_outline() {
    // Plan view [X, Y]: full width under the unit, narrowing behind it, where
    // it only has to stop the phone's weight tipping the dock backwards.
    hull() {
        translate([0, dock_y0]) rrect(body_w, stem_y1 + buttress[1] + 4 - dock_y0, 6);
        translate([ring_center[0] - 34, dock_y0 + dock_depth - 26]) rrect(68, 26, 13);
    }
}

module dock_base() {
    difference() {
        union() {
            // Plate: 0.8 mm bevel on top, 0.4 mm at the bed.
            hull() {
                translate([0, 0, -dock_t]) linear_extrude(0.01) offset(delta = -0.4) dock_outline();
                translate([0, 0, -dock_t + 0.4]) linear_extrude(dock_t - 1.2) dock_outline();
                translate([0, 0, -0.01]) linear_extrude(0.01) offset(delta = -0.8) dock_outline();
            }
            // Front lip, bevelled on its top front edge.
            yz_extrude(dock_cx0, dock_cx1) polygon([[dock_y0, -0.01], [-dock_gap, -0.01], [-dock_gap, dock_lip_h],
                [dock_y0 + 1.2, dock_lip_h], [dock_y0, dock_lip_h - 1.2]]);
            // Short rear lips at both ends stop the unit turning in the dock.
            for (x = [dock_cx0, dock_cx1 - 10])
                yz_extrude(x, x + 10) polygon([[stem_y0, -0.01], [stem_y0 + wall, -0.01],
                    [stem_y0 + wall, dock_lip_h - 1.2], [stem_y0 + wall - 1.2, dock_lip_h], [stem_y0, dock_lip_h]]);
            // Buttress behind the stem's foot: it takes the phone's weight.
            if (phone_mount)
                yz_extrude(ring_center[0] - buttress[0] / 2, ring_center[0] + buttress[0] / 2)
                    polygon([[stem_y1 + 0.1, -0.01], [stem_y1 + 0.1 + buttress[1], -0.01],
                             [stem_y1 + 0.1 + buttress[1], buttress[2] - 2], [stem_y1 + 0.1 + buttress[1] - 2, buttress[2]],
                             [stem_y1 + 0.1, buttress[2]]]);
        }
        if (phone_mount) {
            // Socket for the stem's foot.
            translate([ring_center[0] - stem_neck_w / 2 - 0.15, stem_y0 - 0.1, -stem_foot])
                cube([stem_neck_w + 0.3, stem_t + 0.2, stem_foot + 1]);
            // Two M2 x 6 from behind, heads sunk in the buttress, into the stem.
            for (p = stem_screws) {
                translate([p[0], stem_y1, p[1]]) y_cylinder(buttress[1] + 1, m2_clear);
                translate([p[0], stem_y1 + stem_screw_seat, p[1]]) y_cylinder(buttress[1], m2_head_d + 0.2);
            }
        }
        // Recesses for silicone bumpers, for hitting mats and hard floors.
        for (x = [10, body_w - 10], y = [dock_y0 + 6]) translate([x, y, -dock_t - 1]) cylinder(h = 1.6, d = foot_d);
        for (x = [ring_center[0] - 24, ring_center[0] + 24])
            translate([x, dock_y0 + dock_depth - 9, -dock_t - 1]) cylinder(h = 1.6, d = foot_d);
    }
}

module stem_profile() {
    // Front view [X, Z]. MagSafe: a ring on a neck, joined by a generous fillet.
    // Stud: the neck up to the cap, flaring into it the same way.
    rc = ring_od / 2 + 3;
    difference() {
        offset(r = -stem_fillet) offset(r = stem_fillet) union() {
            if (holder == "magsafe") {
                translate(ring_center) circle(r = rc, $fn = 128);
                translate([ring_center[0] - stem_neck_w / 2, -stem_foot]) square([stem_neck_w, ring_center[1]]);
            } else {
                translate([ring_center[0] - cap[0] / 2, cap_top - cap[2]]) rrect(cap[0], cap[2], 4);
                translate([ring_center[0] - stem_neck_w / 2, -stem_foot]) square([stem_neck_w, cap_top - 4 + stem_foot]);
            }
        }
        translate([0, -stem_foot - 20]) square([body_w, 20]);   // keep the foot square
        if (holder == "magsafe") translate(ring_center) circle(d = stem_hole_d, $fn = 96);
    }
}

module stud_cap() {
    // The block behind the stem's top that carries the stud. Chamfered on
    // every edge, as the stem is.
    c = 0.8;
    x0 = ring_center[0] - cap[0] / 2; z0 = cap_top - cap[2];
    hull() {
        xz_extrude(stem_y0, stem_y0 + 0.01)     translate([x0 + c, z0 + c]) rrect(cap[0] - 2 * c, cap[2] - 2 * c, 4 - c);
        xz_extrude(stem_y0 + c, stem_y0 + cap[1] - c) translate([x0, z0]) rrect(cap[0], cap[2], 4);
        xz_extrude(stem_y0 + cap[1] - 0.01, stem_y0 + cap[1]) translate([x0 + c, z0 + c]) rrect(cap[0] - 2 * c, cap[2] - 2 * c, 4 - c);
    }
}

module stud_cut() {
    // Hex pocket for the bolt's head, open underneath, and the hole its thread
    // passes up through. A vertex of the hex points along Y, so printed flat
    // the pocket has a peaked roof and needs no support.
    z0 = cap_top - cap[2];
    translate([ring_center[0], stud_y, z0 - 1]) {
        bolt_hex(bolt_head[1] + bolt_clear[1] + 1);
        cylinder(h = cap[2] + 2, d = bolt_d + bolt_clear[2], $fn = 32);
    }
}
// The hex pocket for the bolt's head, vertex along Y, along Z from the origin.
function bolt_hex_ac() = (bolt_head[0] + bolt_clear[0]) / cos(30);   // across corners
module bolt_hex(h) { rotate([0, 0, 30]) cylinder(h = h, d = bolt_hex_ac(), $fn = 6); }

module stem() {
    // Edges chamfered as three 0.2 mm steps on each face, which is how the
    // printer lays down a 45-degree chamfer on a flat part anyway.
    c = stem_chamfer; n = 3; s = c / n;
    for (i = [0 : n - 1]) {
        xz_extrude(stem_y0 + i * s, stem_y0 + (i + 1) * s + 0.01) offset(delta = -(c - i * s)) stem_profile();
        xz_extrude(stem_y1 - (i + 1) * s - 0.01, stem_y1 - i * s) offset(delta = -(c - i * s)) stem_profile();
    }
    xz_extrude(stem_y0 + c, stem_y1 - c) stem_profile();
}

module stem_cut() {
    if (holder == "stud") stud_cut();
    // Magnet ring pocket, open on the phone side.
    if (holder == "magsafe") translate([ring_center[0], stem_y1 - ring_depth, ring_center[1]]) difference() {
        y_cylinder(ring_depth + 1, ring_od);
        translate([0, -1, 0]) y_cylinder(ring_depth + 3, ring_id);
    }
    // Alignment magnet below the ring, as on a MagSafe accessory.
    if (holder == "magsafe" && orient_slot[0] > 0)
        translate([ring_center[0] - orient_slot[0] / 2, stem_y1 - ring_depth,
                   ring_center[1] - ring_od / 2 - orient_gap - orient_slot[1]])
            cube([orient_slot[0], ring_depth + 1, orient_slot[1]]);
    // Pilots for the two screws from the buttress.
    for (p = stem_screws) translate([p[0], stem_y1 - stem_pilot_depth, p[1]]) y_cylinder(stem_pilot_depth + 0.6, m2_pilot);
}

module dock_stem() {
    difference() {
        union() { stem(); if (holder == "stud") stud_cap(); }
        stem_cut();
    }
}

// Print orientations. Base: as it sits. Stem: flat, front face on the bed,
// ring pocket facing up.
module dock_base_print() { translate([0, -dock_y0, dock_t]) dock_base(); }
module dock_stem_print()  { translate([0, holder == "magsafe" ? ring_center[1] + ring_od / 2 + 3 : cap_top + 1, -stem_y0]) rotate([90, 0, 0]) dock_stem(); }

// ----------------------------------------------------------------------------
//  Pod park hood: the pod hangs in it, +X end up, and charges
// ----------------------------------------------------------------------------
// The pod's place, as parked: its +X end up (the arrow points into the hood),
// its lid facing back, its clamp toward the lid.
module pod_park_place() {
    multmatrix([[0, 1, 0, pp_tx], [0, 0, 1, pp_ty], [1, 0, 0, pp_tz], [0, 0, 0, 1]]) children();
}

module pp_hood_profile(i = 0) {
    // Front view [X, Z]: the stem cap's rounded rectangle, square at the bottom
    // where the pod enters.
    translate([pp_hx0 + i, pp_hz0 + i]) {
        rrect(pod_park_hood[0] - 2 * i, pod_park_hood[1] - 2 * i, max(0.5, pod_park_hood[2] - i));
        square([pod_park_hood[0] - 2 * i, pod_park_hood[1] / 2]);
    }
}

// Plan [X, Y] of the pod's last 1.5 mm as it parks, clamp included: the
// outline the socket follows, and the fit test coupon's pod-end key.
module pp_pod_end_2d() projection() intersection() {
    pod_park_place() pod_park_solid();
    translate([-1, -1, pp_floor - pod_park_socket[0]]) cube([body_w, 100, pod_park_socket[0] + 0.01]);
}

module pp_socket_2d() {
    // Plan [X, Y] of the pocket: that outline plus its clearance, so the pod
    // only goes in one way round. Open toward the lid.
    offset(delta = pod_park_socket[1]) union() { pp_pod_end_2d(); translate([0, -4]) pp_pod_end_2d(); }
}

// Teardrop hole along Z, its point toward -Y: as the hood prints, -Y is up.
module pp_tear(h, d) {
    linear_extrude(h) hull() { circle(d = d, $fn = 32); translate([0, -d / 2 * sqrt(2)]) circle(d = 0.01); }
}

module pod_park_hood() {
    c = pod_park_hood[3];
    difference() {
        hull() {
            xz_extrude(body_d, body_d + 0.01)          pp_hood_profile(c);
            xz_extrude(body_d + c, pp_hy1 - c)         pp_hood_profile(0);
            xz_extrude(pp_hy1 - 0.01, pp_hy1)          pp_hood_profile(c);
        }
        // The pocket the pod's end sits in.
        translate([0, 0, pp_hz0 - 1]) linear_extrude(pod_park_socket[0] + 1) pp_socket_2d();
        // Wells over the pod's contact heads, then the pins' bores.
        for (p = pp_pads) translate([p[0], p[1], 0]) pp_pin_cut();
        // Magnets, flush with the socket floor.
        for (m = pp_mags) translate([m[0], m[1], 0]) pp_mag_cut();
        // "+" by the +5 V pin, for wiring.
        translate([pp_pads[1][0], pp_pads[1][1] - 5.0, pp_floor - 0.01]) linear_extrude(mark_depth + 0.01)
            for (r = [0, 90]) rotate(r) square([2.4, 0.6], center = true);
        // Wiring space above the pins, open to the lid; a rib keeps the two wires apart.
        xz_extrude(body_d - 1, pp_hy1 - pod_park_wall) difference() {
            intersection() {
                pp_hood_profile(pod_park_wall);
                translate([0, pp_floor + pod_park_plate]) square([body_w, 30]);
            }
            translate([pod_park_cx - 0.6, 0]) square([1.2, body_h * 2]);
        }
        // Pilots for the two M2 x 6 from inside the lid.
        for (x = pod_park_screws) translate([x, body_d - 1, pp_screw_z]) y_cylinder(5.5, m2_pilot);
    }
}
// A pin's well over the pod's contact head, then its bore up through the pin
// plate, along Z from the socket floor. `fit` is the bore over the barrel.
module pp_pin_cut(fit = pod_park_pogo_fit) {
    translate([0, 0, pp_floor - 0.01]) pp_tear(pp_well_top - pp_floor + 0.01, pp_pad[0] + pod_park_well);
    translate([0, 0, pp_well_top - 0.01]) pp_tear(pp_floor + pod_park_plate - pp_well_top + 0.02, pod_park_pogo[0] + fit);
}
// A magnet's pocket, open at the socket floor. `fit` is over the magnet, diameter and depth.
module pp_mag_cut(fit = pod_park_mag_fit) {
    translate([0, 0, pp_floor - 0.01]) pp_tear(pp_mag[1] + fit, pp_mag[0] + fit);
}
// Print rear face down on the textured sheet: that is the face seen from
// behind. The wiring space then opens upward and the pin bores lie across.
module pp_print_place() { translate([-pp_hx0, -pp_hz0, pp_hy1]) rotate([-90, 0, 0]) children(); }
module pod_park_hood_print() { pp_print_place() pod_park_hood(); }


// ----------------------------------------------------------------------------
//  Fit test coupon: print it first
// ----------------------------------------------------------------------------
// Three pieces on one plate, each in the orientation its real part prints in:
//   pin block  A strip of the hood's pin plate, standing as the hood prints
//              (socket floor facing you, bores lying across, teardrops up),
//              lower than in the hood to save time: the four spring-pin bores of
//              coupon_pin_steps at the pins' pitch, each behind its contact-head
//              well, and a hood magnet pocket at each end (coupon_mag_steps),
//              at the hood's distance from the pins.
//   tab        Behind it, flat, as thick as the pod's end wall: the pod's two
//              magnet pockets open underneath under the pod's 0.4 mm skin, as
//              the pod prints them; the pod's M2 contact-screw pilot through the
//              wall; an M2 x 6 lid-screw boss; the 1/4"-20 bolt's hex pocket.
//   socket     The hood's own bottom 1.5 mm: the socket the pod's end sits in.
//   key        The pod's end outline, with two stand-in contact heads that set
//              the pins' height: pressed into the socket until it meets the floor,
//              they push each pin's plunger home and its barrel to depth.
cp_n      = len(coupon_pin_steps);
cp_pitch  = pp_pads[1][0] - pp_pads[0][0];            // the pins' pitch
cp_gap    = pp_pads[0][0] - pp_mags[0][0];            // magnet to pin, as in the hood
cp_well_d = pp_pad[0] + pod_park_well;
cp_axis   = cp_well_d / 2 + 1.2;                      // pins' axis above the bed: the hood's is higher, printed the same
cp_h      = cp_axis + cp_well_d / 2 * sqrt(2) + 1.2;  // over the wells' teardrop points
cp_mag_r  = (pp_mag[0] + pod_park_mag_fit + max(coupon_mag_steps)) / 2;
cp_w      = 2 * cp_gap + (cp_n - 1) * cp_pitch + 2 * (cp_mag_r + coupon_rim);
cp_depth  = pod_park_plate;                           // the block, socket floor to the wiring space
cp_t      = pp[7];                                    // the pod's end wall: the pad under its features
// The block's features, X from its left end: magnet, pins, magnet.
function cp_fx(i) = cp_mag_r + coupon_rim + (i == 0 ? 0 : i > cp_n ? 2 * cp_gap + (cp_n - 1) * cp_pitch
                                                                   : cp_gap + (i - 1) * cp_pitch);
// "0", "+.1", "-.1": an offset as the labels show it.
function cp_step(v) = v == 0 ? "0" : str(v > 0 ? "+" : "-", str_join(str(abs(v)), abs(v) < 1 ? 1 : 0));

// A label standing mark_depth proud of the face it is placed on (sunk 0.2 into it, so it fuses).
module cp_label(s, size = coupon_text) {
    translate([0, 0, -0.2]) linear_extrude(mark_depth + 0.2) text(s, size = size, font = font, halign = "center", valign = "center");
}

module coupon_pin_block() {
    // Built where the hood's plate is, then laid down with the hood's own print
    // placement, so the bores and pockets print exactly as the hood's do.
    translate([0, pp_hz0 - pp_floor, 0]) pp_print_place() difference() {
        translate([pp_hx0, pp_hy1 - cp_h, pp_floor]) cube([cp_w, cp_h, cp_depth]);
        for (i = [0 : cp_n - 1]) translate([pp_hx0 + cp_fx(i + 1), pp_hy1 - cp_axis, 0])
            pp_pin_cut(pod_park_pogo_fit + coupon_pin_steps[i]);
        for (j = [0, 1]) translate([pp_hx0 + cp_fx(j == 0 ? 0 : cp_n + 1), pp_hy1 - cp_axis, 0])
            pp_mag_cut(pod_park_mag_fit + coupon_mag_steps[j]);
    }
    // Labels on top, over each opening.
    // The magnets' labels sit a little outboard, clear of the pins'.
    for (i = [0 : cp_n - 1]) translate([cp_fx(i + 1), cp_depth / 2, cp_h])
        cp_label(cp_step(coupon_pin_steps[i]), coupon_text_pins);
    for (j = [0, 1]) translate([cp_fx(j == 0 ? 0 : cp_n + 1) + (j == 0 ? -0.8 : 0.8), cp_depth / 2, cp_h])
        cp_label(cp_step(coupon_mag_steps[j]), coupon_text_pins);
}

// The flat plate behind the block, with a pad as thick as the pod's end wall
// under the pod's features, and the hex for the 1/4"-20 bolt on its own tile
// at the left end.
cp_hex_w  = bolt_head[0] + bolt_clear[0] + 2 * coupon_rim;         // the hex tile, across flats plus rims
cp_plate_d = coupon_rim + bolt_hex_ac() + 1.0 + coupon_text + 1.2;  // front edge to back edge
cp_feat_y = cp_depth + coupon_rim + boss_d / 2;                     // the small features' row
cp_text_y = cp_plate_d - 1.2 - coupon_text / 2;                     // every label on the plate, one row
// Pod magnets (0, +.1), the pod's contact-screw pilot, the M2 x 6 boss: X centres and labels.
// Labels are 3 mm Liberation Sans Bold: "0" is 2.0 mm wide, "+.1" 5.5, "M2x4" and "M2x6" 9.9.
cp_pod_mag_x = [coupon_rim + (pp_mag[0] + pp[8]) / 2 + 0.6, coupon_rim + (pp_mag[0] + pp[8]) / 2 + 7.2];
cp_pilot_x = cp_pod_mag_x[1] + 2.75 + 2.5 + 4.95;
cp_boss_x  = cp_pilot_x + 4.95 + 2.5 + 4.95;
cp_plate_w = cp_boss_x + 4.95 + coupon_rim;   // the plate behind the block, a little wider than it
// The pad at the pod's wall thickness: [x, y, w, d], round the pod's two magnets and its pilot.
cp_pod_pad = [0, cp_depth - 1, cp_pilot_x + 3.0, cp_feat_y + (pp_mag[0] + pp[8]) / 2 + 1.2 - (cp_depth - 1)];

module coupon_plate() {
    difference() {
        union() {
            translate([-cp_hex_w, 0, 0]) linear_extrude(coupon_t) {
                rrect(cp_hex_w + cp_plate_w, cp_plate_d, 2);
                translate([cp_hex_w + cp_plate_w - 2, 0]) square([2, cp_plate_d]);   // square where the socket joins
            }
            // A ring round each of the pod's magnet pockets, which are hidden under their skin as on the pod.
            for (j = [0, 1]) translate([cp_pod_mag_x[j], cp_feat_y, cp_t - 0.2]) difference() {
                cylinder(h = mark_depth + 0.2, d = pp_mag[0] + pp[8] + coupon_mag_steps[j] + 1.8, $fn = 48);
                translate([0, 0, -1]) cylinder(h = mark_depth + 2, d = pp_mag[0] + pp[8] + coupon_mag_steps[j] + 0.8, $fn = 48);
            }
            translate([cp_pod_pad[0], cp_pod_pad[1], 0]) linear_extrude(cp_t) rrect(cp_pod_pad[2], cp_pod_pad[3], 1.5);
            // M2 x 6 boss: a lid-screw pilot as deep as the shell's, closed by the plate.
            translate([cp_boss_x, cp_feat_y, 0]) cylinder(h = coupon_t + lid_pilot_depth, d = boss_d);
        }
        // The pod's magnet pockets open underneath, under the pod's skin, as the pod prints them
        // (standing on its USB end, the pocket's skin bridged at the top).
        for (j = [0, 1]) translate([cp_pod_mag_x[j], cp_feat_y, -1])
            cylinder(h = 1 + cp_t - pp[5], d = pp_mag[0] + pp[8] + coupon_mag_steps[j], $fn = 32);
        // The pod's contact-screw pilot, through a wall as thick as its end wall.
        translate([cp_pilot_x, cp_feat_y, -1]) cylinder(h = cp_t + 2, d = pp_pad[3], $fn = 24);
        translate([cp_boss_x, cp_feat_y, coupon_t]) cylinder(h = lid_pilot_depth + 1, d = m2_pilot);
        // The bolt's hex, the cap's own pocket.
        translate([-cp_hex_w / 2, coupon_rim + bolt_hex_ac() / 2, -1]) bolt_hex(coupon_t + 2);
    }
    translate([0, 0, coupon_t]) {
        for (j = [0, 1]) translate([cp_pod_mag_x[j], cp_text_y]) cp_label(cp_step(coupon_mag_steps[j]));
        translate([cp_pilot_x, cp_text_y]) cp_label("M2x4");
        translate([cp_boss_x, cp_text_y]) cp_label("M2x6");
        translate([-cp_hex_w / 2, cp_text_y]) cp_label("1/4");
    }
}

// The hood's own bottom 1.5 mm, the socket, laid flat: the key slides through
// it. Round the clamp the hood's floor holds up what lies inside the C; here
// nothing would, so the socket is opened out to its hull there. The sides and
// the back, where the fit is felt, are the hood's own.
module coupon_socket() {
    translate([-pp_hx0, -body_d, -pp_hz0]) difference() {
        intersection() {
            pod_park_hood();
            translate([pp_hx0 - 1, body_d - 1, pp_hz0 - 1]) cube([pod_park_hood[0] + 2, pp_hy1 - body_d + 2, 1 + pod_park_socket[0]]);
        }
        translate([0, 0, pp_hz0 - 1]) linear_extrude(pod_park_socket[0] + 2) hull() pp_socket_2d();
    }
}

// The pod's end outline, and on it two stand-ins for its contact heads, as tall
// as the pins' recess plus their stroke: pressed home, each pushes its pin's
// plunger in to the stop and then the barrel to where the recess is right.
module coupon_key() {
    translate([-pp_tx, -(pp_ty + pod_back_z_unit()), 0]) {
        linear_extrude(coupon_key_t) pp_pod_end_2d();
        for (p = pp_pads) translate([p[0], p[1], coupon_key_t - 0.01])
            cylinder(h = pod_park_recess + pod_park_pogo[2] + 0.01, d = pp_pad[0], $fn = 24);
    }
}
function pod_back_z_unit() = pp[6];
cp_join = 0.6;   // the socket's side rim overlaps the plate's end, so the two are one piece   // the pod's lowest point (jaw tips), in its own Z

module fit_test_coupon() {
    coupon_pin_block();
    coupon_plate();
    translate([cp_plate_w - cp_join, 0, 0]) coupon_socket();
    translate([cp_plate_w - cp_join + pod_park_hood[0] + coupon_gap, 0, 0]) coupon_key();
}

// ----------------------------------------------------------------------------
//  Ghost components (assembly view only)
// ----------------------------------------------------------------------------
// Each component is a named ghost so other tools can export them one at a
// time: `part = "ghost:battery"` exports just the cell, in place. The Blender
// scenes in cad/blender/ are built that way.
ghost_names = ["battery", "tp4056", "mt3608", "esp32", "radar", "switch", "led", "boresight", "phone", "magsafe_ring", "stud_bolt",
               "parked_pod", "pod_park_pogo", "pod_park_magnets", "pod_park_board", "piezo"];
// The radome and light pipe are printed parts, exported with "in_place:radome" and "in_place:led_pipe".

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
    // Radar module, parallel to the window
    if (name == "radar") color("Gold", 0.7) in_window_frame()
        translate([-radar_pcb[0] / 2, win_t + radar_gap, 0]) cube([radar_pcb[0], radar_pcb[2], radar_pcb[1]]);
    if (name == "switch") color("Silver")
        translate([body_w - wall - sw_body[2], sw_center[0] - sw_body[0] / 2, sw_center[1] - sw_body[1] / 2])
            cube([sw_body[2], sw_body[0], sw_body[1]]);
    if (name == "led") color("Red", 0.8) translate([led_pos[0], led_pos[1], body_h - wall - 8.6]) cylinder(h = 8.6, d = 5);
    // Stand-in phone on the dock's ring: back on the ring, camera bump at the top.
    if (name == "phone" && phone_mount && holder == "magsafe") color("DimGray") {
        y = stem_y1 + 0.5;   // 0.5 mm grip pad
        translate([0, y, 0]) xz_extrude(0, phone[2])
            translate([ring_center[0] - phone[0] / 2, ring_center[1] - phone[1] / 2]) rrect(phone[0], phone[1], 10);
        translate([ring_center[0] - phone[0] / 2 + 4, y - 2, ring_center[1] + phone[1] / 2 - 42])
            cube([36, 2.01, 38]);
    }
    if (name == "stud_bolt" && phone_mount && holder == "stud") color("Silver")
        translate([ring_center[0], stud_y, cap_top - cap[2]]) {
            rotate([0, 0, 30]) cylinder(h = bolt_head[1], d = bolt_head[0] / cos(30), $fn = 6);
            cylinder(h = bolt_head[1] + bolt_len, d = bolt_d, $fn = 32);
        }
    if (name == "magsafe_ring" && phone_mount && holder == "magsafe") color("Silver")
        translate([ring_center[0], stem_y1 - ring_depth, ring_center[1]]) difference() {
            y_cylinder(ring_depth - 0.2, ring_od - 0.4);
            translate([0, -1, 0]) y_cylinder(ring_depth + 2, ring_id + 0.4);
        }
    // Pod park: the pod as it hangs in the hood, the hood's pins (pressed in by
    // the pod's contact heads) and magnets, and the protection board.
    if (name == "parked_pod" && pod_park) pod_park_place() pod_parked_parts(true);
    if (name == "pod_park_pogo" && pod_park) color("Gold") for (p = pp_pads) translate([p[0], p[1], 0]) {
        translate([0, 0, pp_well_top]) cylinder(h = pp_tail - pp_well_top, d = pod_park_pogo[0], $fn = 24);
        translate([0, 0, pp_floor + pp_pad[1]]) cylinder(h = pp_well_top - pp_floor - pp_pad[1], d = pod_park_pogo[4], $fn = 16);
    }
    if (name == "pod_park_magnets" && pod_park) color("Silver") for (m = pp_mags)
        translate([m[0], m[1], pp_floor]) cylinder(h = pp_mag[1], d = pp_mag[0], $fn = 32);
    if (name == "pod_park_board" && pod_park) color("ForestGreen", 0.7)
        translate([pod_park_board_pos[0] + 0.2, y_back - pod_park_board[2], pod_park_board_pos[1] + 0.2])
            cube([pod_park_board[0], pod_park_board[2], pod_park_board[1]]);
    // Piezo disc: brass on the seat, ceramic toward the inside.
    if (name == "piezo") {
        color("Goldenrod") translate([pz_x1 - pz_t - 0.1, pz_cy, pz_cz]) rotate([0, 90, 0]) cylinder(h = pz_t, d = pz_d);
        color("WhiteSmoke") translate([pz_x1 - 0.1, pz_cy, pz_cz]) rotate([0, 90, 0]) cylinder(h = pz_ceramic[1], d = pz_ceramic[0]);
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
    ms = phone_mount && holder == "magsafe";
    st = phone_mount && holder == "stud";
    stud_proud = bolt_len - (cap[2] - bolt_head[1] - bolt_clear[1]);
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
        chk("ESP32 tab posts to radar housing", radar_x0 - (esp_pos[0] + esp_pcb[0] + 2.2 + 2.1)),
        chk("battery bay to TP4056 guide     ", (tp_x - 1 - fit_clear) - (batt_pos[0] + batt[0] + 2 * batt_clear + 1.2)),
        chk("cell + MT3608 depth stack       ", inner_d - (batt[2] + 0.2 + mt_pcb[2] + mt_parts_h)),
        chk("divider to ESP32 board          ", esp_pos[1] - (batt_pos[1] + batt[1] + 2 * batt_clear + 1.2)),
        chk("radar housing to right wall     ", (body_w - wall) - radar_x1),
        // Stays under 0.3: the bevel's outer corner nearly meets the R12 corner's inner wall. Not a fit
        // between parts, nothing slides here. More room means moving the window, the unit's focal
        // point, off the boresight the sight is built over, or a smaller bevel, which would change the look.
        chk("window bevel inside outline     ", (corner_r - wall) - sqrt(dx * dx + dz * dz) - win_chamfer),
        chk("radar posts on their corner pads", ledge_pad - (win_size / 2 - abs(radar_holes[0][0]) + 2.3)),
        chk("radar post pilot under its depth", (radar_gap - ledge_t) - 4.5),
        chk("light pipe flange to ESP32 board", (body_h - wall) - (esp_pos[1] + esp_pcb[1]) - 0),
    ];
    // Dock: only the checks for the stem head being exported.
    ms_lines = !ms ? [] : [
        chk("phone bottom above buttress     ", (ring_center[1] - phone[1] / 2) - (buttress[2] + 1)),
        chk("phone clears unit top           ", (ring_center[1] + phone[1] / 2 - phone_lens_from_top)
            - (body_h + (stem_y1 + 0.5) * tan(phone_vfov / 2))),
        chk("alignment magnet inside neck    ", (stem_neck_w - orient_slot[0]) / 2 - 1.5),
        chk("stem behind the ring pocket     ", (stem_t - ring_depth) - 1.6),
        chk("opening inside the magnet ring  ", (ring_id - stem_hole_d) / 2 - 3),
    ];
    st_lines = !st ? [] : [
        chk("stud stands at least 4.5 mm     ", stud_proud - 4.5),
        chk("stud stands at most 6.0 mm      ", 6.0 - stud_proud),
        chk("hex pocket clear of the stem    ", (stud_y - bolt_hex_ac() / 2) - stem_y1 - 0.8),
        chk("hex pocket inside the cap (Y)   ", (stem_y0 + cap[1]) - (stud_y + bolt_hex_ac() / 2) - 1.6),
        chk("hex pocket inside the cap (X)   ", cap[0] / 2 - (bolt_head[0] + bolt_clear[0]) / 2 - 1.6),
        chk("cap above the unit's top edge   ", (cap_top - cap[2]) - body_h + 3),
    ];
    stem_lines = !phone_mount ? [] : [
        chk("stem face past the screw pilots  ", stem_t - stem_pilot_depth - 0.4),
        chk("stem screw tips short of pilots  ", stem_pilot_depth - (m2_len - stem_screw_seat)),
    ];

    // Pod park. The neck widens into the cap's fillet from z_fillet up.
    neck_x0  = ring_center[0] - stem_neck_w / 2;
    cap_x0   = ring_center[0] - cap[0] / 2;
    z_fillet = (cap_top - cap[2] + 4) - sqrt(pow(stem_fillet + 4, 2) - pow(cap_x0 + 4 - (neck_x0 - stem_fillet), 2));
    comp     = pp_pad[1] - pod_park_recess;           // pin compression with the pod parked
    hb       = [pod_park_board_pos[0] - 1, pod_park_board_pos[0] + pp_bin[0] + 1,
                pod_park_board_pos[1] - 1, pod_park_board_pos[1] + pp_bin[1] + 1];   // fence [x0, x1, z0, z1]
    esp_usb_z = esp_pos[1] + esp_pcb[1] / 2;
    pp_lines = !pod_park ? [] : [
        chk("pod park: hood clear of stem neck", neck_x0 - pp_hx1 - 0.5),
        chk("pod park: hood below stem fillet ", z_fillet - pp_hz1),
        chk("pod park: hood lifts under cap   ", (cap_top - cap[2]) - (pp_hz1 + dock_lip_h + 1)),
        chk("pod park: hood below top-left screw", (lid_bosses[2][1] - m2_head_d / 2) - pp_hz1 - 0.4),
        chk("pod park: pod above low-left screw", pp_tz - (lid_bosses[0][1] + m2_head_d / 2) - 0.4),
        chk("pod park: pod drops clear of lip ", (pp_tz - pod_park_socket[0]) - dock_lip_h - 1),
        chk("pod park: hood inside left edge  ", pp_hx0 - rear_chamfer - 1),
        chk("pod park: socket rim, sides      ", (pp_tx - pod_park_socket[1]) - pp_hx0 - 1.2),
        chk("pod park: socket rim, back       ", pp_hy1 - (pp_ty + pp_size[2] + pod_park_socket[1]) - 1.2),
        // These two share the pin's stroke and cannot both reach 0.3: see pod_park_recess.
        chk("pod park: pin compression >= 0.4 ", comp - 0.4),
        chk("pod park: pin stroke left >= 0.1 ", pod_park_pogo[2] - comp - 0.1),
        chk("pod park: pin tip recessed       ", pod_park_recess - 0.3),
        chk("pod park: well deeper than head  ", (pp_well_top - pp_floor) - pp_pad[1] - 0.3),
        chk("pod park: pin tail in wiring space", (pp_tail - (pp_floor + pod_park_plate)) - 0.5),
        chk("pod park: solder room over tails ", (pp_hz1 - 1.2) - pp_tail - 1.5),
        chk("pod park: wells apart            ", (pp_pads[1][0] - pp_pads[0][0]) - (pp_pad[0] + pod_park_well) - 1.0),
        chk("pod park: magnet to well         ", (pp_pads[0][0] - (pp_pad[0] + pod_park_well) / 2)
                                                 - (pp_mags[0][0] + (pp_mag[0] + pod_park_mag_fit) / 2) - 0.6),
        chk("pod park: magnet pocket in plate ", pod_park_plate - pp_mag[1] - pod_park_mag_fit - 1.2),
        chk("pod park: hood screws in plate   ", pod_park_plate / 2 - m2_pilot / 2 - 1.0),
        chk("pod park: wire holes in wiring sp.", ((pp_hz1 - 1.2) - (pp_floor + pod_park_plate)) / 2 - pod_park_wire[1] / 2 - 0.2),
        chk("pod park: wires either side of rib", min(pod_park_cx - 0.6 - (pod_park_wire[0][0] + pod_park_wire[1] / 2),
                                                     (pod_park_wire[0][1] - pod_park_wire[1] / 2) - (pod_park_cx + 0.6))),
        chk("board pocket >= 15 x 12 (X)      ", pp_bin[0] - 15),
        chk("board pocket >= 15 x 12 (Z)      ", pp_bin[1] - 12),
        chk("board pocket >= 4 deep           ", pod_park_board[2] - 4),
        chk("board depth clear of SuperMini   ", (y_back - pod_park_board[2]) - (y_front + esp_rail_h + esp_pcb[2] + esp_usb[1])),
        chk("board depth clear of the cell    ", (y_back - pod_park_board[2]) - (y_front + batt[2] + 1.0)),
        chk("board pocket above MT3608        ", hb[2] - (mt_pos[1] + mt_pcb[1] + 1 + fit_clear)),
        chk("board pocket below the LED       ", (body_h - wall - 8.6) - hb[3]),
        chk("board pocket below the wire holes", (pp_wire_z - pod_park_wire[1] / 2) - hb[3]),
        chk("board pocket to hood screw heads ", min(hb[0] - (pod_park_screws[0] + m2_head_d / 2),
                                                    (pod_park_screws[1] - m2_head_d / 2) - hb[1])),
        chk("board pocket to buzzer mount     ", hb[0] - pz_x1),
        chk("board pocket inside the lid lip  ", hb[0] - (wall + fit_clear + lid_lip_w)),
    ];

    // Sight
    top_on_face2 = win_size * cos(win_tilt) + win_size * tan(win_tilt) * sin(win_tilt);
    sight_lines = [
        chk("sight: light each side of post   ", (sight_notch[0] - sight_post[0]) / 2 - 0.2),
        chk("sight: notch bottom over top face", (sight_h - sight_notch[1]) - 0.5),
        chk("sight: post above window bevel   ", (body_h - front_chamfer - 0.4) - (win_zb + top_on_face2 + win_chamfer)),
        chk("sight: rear blade clear of cap   ", (win_cx - sight_blade / 2) - (ring_center[0] + cap[0] / 2) - 1),
        chk("sight: rear blade inside corner  ", (body_w - corner_r) - (win_cx + sight_blade / 2)),
        chk("sight: groove starts behind ramp ", (sight_post[1] + sight_h + 1.0 - 0.4) - (sight_post[1] + sight_h)),
    ];

    // Buzzer
    pz_inner = [for (z = pz_slot_z) z + pz_rise];
    pz_far = max([for (z = pz_inner) abs(z - pz_cz)]) + rib_w / 2;
    pz_r = pz_d / 2 - pz_seat;
    pz_lines = [
        chk("buzzer seat inside depth, front  ", (pz_cy - pz_seat_r) - y_front),
        chk("buzzer seat inside depth, lid    ", (y_back - 0.2) - (pz_cy + pz_seat_r)),
        chk("buzzer mount below SuperMini USB ", (esp_usb_z - 6) - pz_block[3]),
        chk("buzzer mount above low-left boss ", pz_block[2] - (lid_bosses[0][1] + boss_d / 2 + 2)),
        chk("buzzer + wires to battery fence  ", (batt_pos[0] - 1.2) - (pz_x1 + pz_ceramic[1] + 1.5)),
        chk("buzzer slots inside the cavity   ", sqrt(max(0, pz_r * pz_r - pz_far * pz_far)) - pz_slot_len / 2),
        chk("buzzer slots in the grip ribs (Z)", rib_z[1] - pz_slot_z[len(pz_slot_z) - 1]),
        chk("buzzer slots in the grip ribs (Y)", (pz_cy - pz_slot_len / 2) - (front_chamfer + 2)),
    ];
    for (l = concat(lines, ms_lines, st_lines, stem_lines, pp_lines, sight_lines, pz_lines)) echo(l);
    echo(str("  info  radar window centre ", [win_cx, win_zb + top_on_face / 2],
             ", boresight ", win_tilt, " deg up, skin ", win_t, " mm"));
    echo(str("  info  USB-C receptacle centre X ", tp_usb_x, " Y ", tp_usb_y));
    theta = atan(0.3 / sight_radius);
    echo(str("  info  sight radius ", sight_radius, " mm: 0.3 mm of eye misalignment = ", theta,
             " deg of aim, a Doppler speed error (1 - cos) of ", 100 * (1 - cos(theta)), " %; eyeballing 10 deg off costs ",
             100 * (1 - cos(10)), " %"));
    if (pod_park) {
        echo(str("  info  pod park: pod centre X ", pod_park_cx, ", Z ", pp_tz, " to ", pp_floor,
                 "; hood X ", pp_hx0, "-", pp_hx1, ", Z ", pp_hz0, "-", pp_hz1, ", reaches Y ", pp_hy1, " (",
                 pp_hy1 - body_d, " mm behind the lid)"));
        echo(str("  info  pod park pins at X ", pp_pads[0][0], " (GND) and ", pp_pads[1][0], " (+5 V), Y ", pp_pads[0][1],
                 ", pitch ", pp_pads[1][0] - pp_pads[0][0], " mm; compressed ", pp_pad[1] - pod_park_recess, " of ",
                 pod_park_pogo[2], " mm"));
        echo(str("  info  fit test coupon: a pin set with the key stands ", pod_park_recess, " mm up its well (",
                 pp_pad[1] - (pod_park_pogo[2] - 0.1), "-", pp_pad[1] - 0.4, " works); bores ",
                 [for (v = coupon_pin_steps) pod_park_pogo[0] + pod_park_pogo_fit + v], " mm"));
    }
    echo(str("  info  buzzer disc centre [Y, Z] ", [pz_cy, pz_cz], " on the left wall, ",
             win_cx - win_size / 2 - win_frame - pz_x1, " mm from the radar housing"));
    if (st) echo(str("  info  1/4-20 stud stands ", stud_proud, " mm proud of the cap, top ", cap_top, " mm above the unit's bottom"));
    if (ms) {
        echo(str("  info  tallest phone that clears the buttress: ", 2 * (ring_center[1] - buttress[2] - 1), " mm"));
        echo(str("  info  magnet ring to MT3608 PCB: ", (stem_y1 - ring_depth) - (y_back - mt_pcb[2]),
                 " mm (check the 5 V rail with a phone attached)"));
        echo(str("  info  dock base reaches ", dock_y0 + dock_depth - (stem_y1 + 0.5 + phone[2] / 2),
                 " mm behind the phone's centre line"));
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
} else if (part == "radome") {
    radome_print();
} else if (part == "led_pipe") {
    led_pipe();
} else if (part == "dock_base") {
    dock_base_print();
} else if (part == "dock_stem") {
    dock_stem_print();
} else if (part == "pod_park_hood") {
    pod_park_hood_print();
} else if (part == "fit_test_coupon") {
    fit_test_coupon();
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
} else if (part == "in_place:radome") {
    radome();
} else if (part == "in_place:led_pipe") {
    led_pipe_in_place();
} else if (part == "in_place:dock_base") {
    dock_base();
} else if (part == "in_place:dock_stem") {
    dock_stem();
} else if (part == "in_place:pod_park_hood") {
    pod_park_hood();
} else if (len(part) > 6 && part[0] == "g" && part[5] == ":") {
    ghost(str_join(part, 6));
} else if (part == "print_plate") {
    shell_print();
    translate([body_w + 8, 0, 0]) lid_print();
    translate([-10, 10, 0]) esp32_clamp_tab();
    translate([-10, 20, 0]) esp32_clamp_tab();
    translate([-40, 0, 0]) radome_print();
    translate([-10, 30, 0]) led_pipe();
    if (pod_park) translate([-40, 32, 0]) pod_park_hood_print();
} else {
    shell();
    radome();
    led_pipe_in_place();
    translate([0, explode, 0]) lid();
    for (i = [0, 1]) esp32_clamp_tab_in_place(i);
    dock_base();
    if (phone_mount) translate([0, 2 * explode, 0]) dock_stem();
    if (pod_park) translate([0, explode, 0]) pod_park_hood();
    if (show_components) ghosts();
}

// Characters of s from index i to the end, as a string ("ghost:radar" -> "radar").
function str_join(s, i) = i >= len(s) ? "" : str(s[i], str_join(s, i + 1));

// Print orientations.
// Shell: front face on the bed (Y = 0 -> Z = 0), on a textured sheet, which
// gives the face the unit is seen by an even matte grain. No supports: the
// radome is a separate part, and the ledge it sits on is a short overhang.
module shell_print() { translate([0, body_h, 0]) rotate([90, 0, 0]) shell(); }
// Lid: outside face on the bed (Y = body_d -> Z = 0), lip and fence facing up.
module lid_print()   { translate([0, 0, body_d]) rotate([-90, 0, 0]) lid(); }
