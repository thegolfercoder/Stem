# Annotation guide: labelling phone swings

How to turn your own swings into training labels. The definitions are in
`event-labeling-spec.md`; this is the procedure.

## Why

Every accuracy figure for this product is on broadcast and range footage of tour
players. More of it stopped helping on phone video (see `docs/audit/failure-inventory.md`).
Labelled phone swings are the only input that can close that gap, and the only way
to measure the product on the footage it is actually used on.

## Consent first

Only label swings you filmed of yourself, or of someone who has agreed in writing
that their swing may be used to train and evaluate the model. Record which in the
swing's label field (for example `self` or `consent:2026-10-01`). Do not label
footage of minors. A labelled swing can be removed at any time: delete the swing,
or reset its positions, and it drops out of the next export.

## Procedure (desktop app)

1. Record at 60 fps or more if the phone allows, face on or down the line, whole
   body in frame, phone on a stand. The app's preflight will warn about framing.
2. Analyse the clip. Open the swing's page.
3. In **Put a position on the right frame**, for each of the eight positions in
   order: choose it, scrub with the arrow keys to the frame the spec defines, press
   **Set to this frame**. Positions must stay in order; the app refuses otherwise.
4. Check all eight against the spec, including those you did not move.
5. Tick **All eight positions are right**, then **Save positions**.

A swing is a training label only when step 5 is done. Moving one position without
ticking the box corrects that swing's measurements and nothing else.

## Quality control

- Label the address, top and impact first; they carry the tempo. If you are unsure
  of any of the three to within 2 frames at 60 fps, do not tick the box.
- Re-label 1 swing in 10 a week later without looking at the first labels. If
  address, top or impact differ by more than their tolerance, both labels are
  suspect: discard the swing or have a second person label it.
- Keep sessions separate: when a model is evaluated on your swings, whole sessions
  are held out, never single swings from a session that also trains it.

## Building the archive

```bash
cd swingml
python scripts/make_labelled_dataset.py --out out/phone/labelled.npz
```

It prints how many swings were written, which were left out and why, and how often
you moved each position (a count of how often the model was wrong, per event).
Freeze any split you evaluate on with `python -m swingml.dataset.manifest freeze`
before training on anything else.
