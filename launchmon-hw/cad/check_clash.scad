// Interference harness for check_clash.py: the overlap of one arm part with others,
// in one pose. Not a part to print. Every part comes from script_ground_radar.scad's
// own modules, so the check follows the design.
//
//   openscad check_clash.scad -o overlap.stl -D 'a="head"' -D 'b=["swivel","slide"]'
//            -D open=true -D tilt=25 -D yaw=20
//
// An empty result (OpenSCAD: "Current top level object is empty") is a pass.
use <script_ground_radar.scad>

a     = "head";          // the part under test
b     = ["swivel"];      // what it must not cut into
open  = true;            // slide pulled up (true) or stored (false)
tilt  = 25;              // head, degrees back from upright; 180 hangs it down as folded
yaw   = 20;              // swivel, degrees
lower = 0;               // 0..1: with open = true, the arm lowered this fraction of the slide's travel
                         // (1 is the stored height): the slide's sweep, head hanging
head_kind = "magsafe";   // [magsafe, clamp]: which head "head" means

travel = slide_z0(true) - slide_z0(false);

module moving() translate([0, 0, open ? -lower * travel : 0]) children();

module one(n) {
    if (n == "base")   dock_base();                              // dock base: plate, spine, pod pocket
    if (n == "unit")   { envelope(); shell(); lid(); }           // the ground unit's closed body and what stands on it
    if (n == "slide")  moving() arm_slide(open);
    if (n == "swivel") moving() arm_swivel(open, yaw);
    if (n == "head")   moving() { if (head_kind == "clamp") arm_clamp(open, tilt, yaw); else arm_head(open, tilt, yaw); }
    if (n == "jaw")    moving() arm_clamp_jaw(open, tilt, yaw);  // the clamp head's sliding jaw, at the stand-in phone's width
    if (n == "phone")  moving() phone_ghost(tilt, yaw);          // stand-in phone on the open head
}

intersection() {
    one(a);
    union() { for (n = b) one(n); }
}
