# Design language

What the two units look like, and why. The target is an object people want at
$80-100, made on ordinary FDM printers for $5-10 of printed parts.

## What desirable hardware has in common

Look at the small electronics people pay a premium for: a phone's battery pack,
a fitness band, a compact launch monitor, a well-made camera, a Braun alarm
clock. The common ground is not a style. It is a handful of decisions, made
consistently:

1. **One focal point.** The eye goes to one place first: a lens, a screen, a
   dial. Everything else steps back.
2. **Every detail has a job.** The marks, textures and lights you notice are
   the controls, the grips and the indicators. Nothing is applied for
   decoration, so nothing looks applied.
3. **A family resemblance.** Products in a range share their edges, finish,
   type and small details, so two objects read as one system.
4. **Made the way the process wants.** Good design looks easy to make because
   it was drawn for its process: draft angles for moulding, chamfers for
   machining. For a printed part, that means drawing for the printer.
5. **What isn't for the user is hidden.** Seams are lines placed on purpose,
   fasteners are out of sight or made into a pattern, and the inside stays inside.
6. **Restraint in colour, material and finish.** One colour, one material,
   and at most one contrasting finish, used where it means something.
7. **Accessories belong to the object.** A stand or a mount that looks bolted
   on makes the whole thing look improvised.
8. **Proportions that agree.** Parts share dimensions and centre lines, so the
   eye finds alignments instead of near-misses.

## How the Stem units apply them

| Principle | Ground unit | Pod |
|---|---|---|
| **One focal point** | The radar window: a **smoked translucent radome** in a bevelled, rounded pocket, flush at its bottom edge and stepping back 15° to the top. The radar board shows faintly behind it, which says what the unit is. | The clamp's single continuous arch under a plain body. |
| **Every detail has a job** | A **front post and rear notch**, joined by a groove, over the boresight: a gun sight for lining the unit up quickly and the same way every time. **Grip ribs** on both ends, where it is held. A **light pipe** that shows the status LED as a flush 2.8 mm dot. A **pill recess** that keeps the switch below the surface. | The **arrow** on the lid points to the clubhead, the pod's +X axis and the way round it must go on. The strap's two hook posts and the zip-tie grooves are left visible, because they are the safety feature. |
| **A family resemblance** | Matte black, soft edges, a 0.5 mm shadow gap at the seam, 0.4 mm debossed marks. | The same: matte black, rounded body, shadow gap at the lid, one 0.4 mm debossed mark. |
| **Made for the printer** | Chamfers, not fillets, on every edge that lies on the bed. They print crisply and stop the first layers squashing out. The faces people see print **face down on a textured sheet**, so they have an even grain and no layer lines. **No part needs supports.** The radome prints flat: smooth, and exactly 1.0 mm. The arm's head prints on its plain face, so the face that shows when folded is the textured one and the ring pocket is a true circle. | The base prints standing up, so every layer is a complete C and the jaws flex along the layers. The saddle between the jaws adds no supports. |
| **Hidden structure** | The seam is a deliberate **shadow gap**, so a printed lid that sits 0.2 mm proud does not show. The back is **one flat lid**: its screws are sunk in chamfered counterbores, and nothing else is fixed to it. The dock has no screws; the arm is held by a printed pin and two detents. | The seam is a shadow gap; the lid snaps on with no fasteners. |
| **Restraint in CMF** | Matte black PETG body. One contrasting finish: the radome's **ironed, slightly glossy** face, and the radome is the one place a colour is offered: **smoke, ice or amber**. Natural PETG only where light passes. | Matte black. The liner under the clamp and the black TPU strap are the only other materials. |
| **Accessories belong** | The **dock** is the stand, the phone mount and the pod's storage in one. A slim **spine** behind the lid's centre stops 1 mm under the unit's top edge; the phone arm folds into it, the slide inside and the round head flat over it, plain face out, so nothing stands above the unit until you pull it up. The **club pod** lies in a pocket in the base behind the spine. The dock is the unit's width; the unit lifts out and is a clean slab on its own. | The pod lives in the dock's pocket between sessions and charges from its own USB-C, the port it is flashed through. Its reusable **TPU strap** replaces single-use zip ties. |
| **Proportions agree** | The dock is the unit's width. The spine, the slide, the head and the pod pocket are all on the unit's centre line. The spine's top is 1 mm under the unit's top edge, and the folded head sits inside the lid's width and the dock's height. Body corners R12, window corners R3, dock plan corners R6; the head is a 60 mm circle, the ring's size plus 1.75 mm each side. | Body 32 x 26 mm; jaws 10 mm wide at each end; the arrow on the centre line. |

### A practical win from the radome

The radome also settles a conflict the old design had. Most opaque black
filaments are coloured with carbon black, which absorbs 24 GHz, so a
single-piece black shell meant either a lossy window or a body in natural or
white. With a separate radome, the body can be any colour. The radar looks out
only through the radome, and that prints in smoke or natural PETG.

## What it costs to print

`cad/cost_report.py` estimates material and machine time from the STLs, and
writes `cad/stl/cost_report.txt` each time the STLs are exported.

| | Before (prototype) | Now |
|---|---|---|
| Filament, both units | 98 g, including supports | 84 g, no supports |
| Print time, both units | 5.7 h | 4.9 h |
| Kit cost, own printer ($0.40/h) | $4.45 | **$3.84** |
| Kit cost, print farm ($1.50/h) | $11.00 (over budget) | **$9.53** (within $5-10) |

These assume PETG (and TPU for the strap) at $20/kg and a conservative 4 mm³/s sustained flow. A
faster printer roughly halves the time and the machine cost. The estimate is
within about 20% of a slice; slice with your own profile before quoting.

The first redesign merged the stand and the phone plate into one dock and made
the radome a separate part, which removed the shell's supports. The folding
arm, the pod pocket and the TPU strap (commit 41c82f1) add about 13 g and 0.7
hours over the stud stem and pod hood they replace. Most of it is the dock
base, which now carries the spine and the pocket's walls (9.8 g to 23.6 g);
the arm's three parts are 11.9 g. The print-farm cost is near the top of the
budget, at $9.53.

## What was left out, and why

- **Soft-touch paint, metal inserts, two-colour printing.** Each adds cost or a
  process step per unit. The textured sheet gives the matte finish for nothing.
  The only second colour is a filament change on a separate small part, the
  radome.
- **Hiding the lid screws entirely.** A snap-fit lid on the ground unit would
  have to survive being knocked over on a range, and screws do that reliably.
  They are on the back, counterbored, on an otherwise plain lid.
- **The pod inside the grip's end.** Some commercial club sensors hide in the
  grip cap, which is better than a clamp on the shaft. It needs a custom circuit
  board the size of a coin; with off-the-shelf boards the pod cannot get that
  small. It is a move for volume production.
- **A charge light on the pod.** It would be another part and another hole.
  The pod cannot read its own cell in any case: charge it after each session.
- **Fake regulatory marks.** No CE, FCC or similar marks appear on the
  parts. They may only be applied once the product has been tested.

## Where the camera goes

On the unit (owner's decision, 2026-11-06): the phone films from the dock's
folding arm, with no tripod. The arm's slide pulls 46 mm up out of the spine
and clicks; the round MagSafe head flips up on it and tilts back in detents
from 0 to 35°, 25° by default, which aims the lens up to take in the ball, the
golfer and the club at the top. From the CAD's fit report, with a 147.6 mm
stand-in phone at 25°:

- the phone's lower edge clears the unit by 8.5 mm (4.7 mm at 0°, 12.1 mm at
  35°);
- the lens sightline clears the unit by over 100 mm, so the unit is not in
  the shot;
- the phone's centre is over the base, so its weight cannot tip the dock
  backwards.

None of that has been checked on a printed arm yet.

The phone sits about 1.4 m behind the ball and low, and the head does not
swivel toward the golfer yet. With the normal 1x lens the golfer may be at the
edge of the frame, so use the **0.5x ultra-wide** lens, which most phones
since about 2019 have. A swivel would let the 1x lens work; it is not built.

The head holds a phone by MagSafe: an aftermarket MagSafe-compatible ring is
glued in its pocket under a 0.5 mm grip pad. A clamp head for phones without
MagSafe is not built yet; today such a phone needs a MagSafe-compatible case
or a stick-on ring. A tablet is too heavy for the arm.

## Beyond the plastic

The printed parts are now under a tenth of the $80-100 price. The electronics
are the larger cost, the radar module above all. Price the bill of materials
in the quantities you plan to build before you fix the retail price. At volume
a custom board would replace the breakout boards, and would also let the
enclosures shrink.

## Checking a first print

- Front face and lid: even texture from the sheet, chamfers crisp, no
  squashed-out first layer.
- Shadow gap visible and even all round with the lid on.
- Radome: 1.0-1.2 mm, flat, sits flush at its bottom edge.
- Light pipe flush with the top face; LED visible as a soft dot.
- Arm: the slide runs the spine's full length and clicks at both ends; the
  head holds at each tilt detent; folded, the head lies flat over the spine and
  nothing stands above the unit's top edge.
- MagSafe ring flush in the head under its grip pad, and a phone snaps on
  centred.
- Pod: arrow toward the clubhead; jaws snap on and the TPU strap hooks over
  both posts (or the ties close them); the pod drops into the dock's pocket.
- Sight: the post sits centred in the notch with an even sliver of light each
  side.
