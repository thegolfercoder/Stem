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
| **Every detail has a job** | The **aiming groove** over the boresight, for lining the unit up. **Grip ribs** on both ends, where it is held. A **light pipe** that shows the status LED as a flush 2.8 mm dot. A **pill recess** that keeps the switch below the surface. | The **arrow** on the lid points to the clubhead, the pod's +X axis and the way round it must go on. The zip-tie grooves are left visible, because they are the safety feature. |
| **A family resemblance** | Matte black, soft edges, a 0.5 mm shadow gap at the seam, 0.4 mm debossed marks. | The same: matte black, rounded body, shadow gap at the lid, one 0.4 mm debossed mark. |
| **Made for the printer** | Chamfers, not fillets, on every edge that lies on the bed. They print crisply and stop the first layers squashing out. The faces people see print **face down on a textured sheet**, so they have an even grain and no layer lines. **No part needs supports.** The radome prints flat: smooth, and exactly 1.0 mm. The dock's stem prints flat, so its faces are clean and its opening is a true circle. | The base prints standing up, so every layer is a complete C and the jaws flex along the layers. The saddle between the jaws adds no supports. |
| **Hidden structure** | The seam is a deliberate **shadow gap**, so a printed lid that sits 0.2 mm proud does not show. The lid screws are sunk in chamfered counterbores at the back. The dock's screws are behind the stem, under the phone. | The seam is a shadow gap; the lid snaps on with no fasteners. |
| **Restraint in CMF** | Matte black PETG body. One contrasting finish: the radome's **ironed, slightly glossy** smoke face. Natural PETG only where light passes. | Matte black. The liner, under the clamp, is the only other material. |
| **Accessories belong** | The **dock** replaces a separate stand and a phone plate screwed to the lid. It is a ring on a stem, centred on the unit, rising 9 mm clear of its top edge, the same 96 mm wide as the unit at its base. The unit lifts out and is a clean slab on its own. | No accessory: the clamp is part of the body. |
| **Proportions agree** | The dock is the unit's width. The stem is on the unit's centre line. The ring's opening, the magnet ring and its outline are concentric. Body corners R12, window corners R3, dock plan corners R6. | Body 32 x 26 mm; jaws 10 mm wide at each end; the arrow on the centre line. |

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
| Filament, both units | 98 g, including supports | 69 g, no supports |
| Print time, both units | 5.7 h | 4.1 h |
| Kit cost, own printer ($0.40/h) | $4.45 | **$3.18** |
| Kit cost, print farm ($1.50/h) | $11.00 (over budget) | **$7.92** (within $5-10) |

These assume PETG at $20/kg and a conservative 4 mm³/s sustained flow. A
faster printer roughly halves the time and the machine cost. The estimate is
within about 20% of a slice; slice with your own profile before quoting.

The redesign got cheaper as well as better looking. Merging the stand and the
phone plate into one dock, and printing its stem flat, saved about 27 g and
1.5 hours. Making the radome a separate part removed the shell's supports.

## What was left out, and why

- **Soft-touch paint, metal inserts, two-colour printing.** Each adds cost or a
  process step per unit. The textured sheet gives the matte finish for nothing.
  The only second colour is a filament change on a separate small part, the
  radome.
- **Hiding the lid screws entirely.** A snap-fit lid on the ground unit would
  have to survive being knocked over on a range, and screws do that reliably.
  They are on the back, counterbored, and mostly behind the dock's stem.
- **Fake regulatory marks.** No CE, FCC or similar marks appear on the
  parts. They may only be applied once the product has been tested.

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
- Stem: clean faces, round opening, ring flush in its pocket.
- Pod: arrow toward the clubhead; jaws snap on and the ties close them.
