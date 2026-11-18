# Data deletion runbook

## A golfer deletes their own data (desktop)

- **One swing**: its page → Delete. Removes the row, its plan links and feedback,
  its frames folder and its video.
- **Everything**: Your data → type `ERASE` → Delete everything. Removes every row,
  frame and video. The pose model and app settings stay.
- **By hand**: quit the app and delete `~/.swingml/` (or `$SWINGML_HOME`).

Check afterwards: Your data shows 0 swings; `~/.swingml/frames/` and
`~/.swingml/videos/` are empty.

## A contributor withdraws a training label

1. On the swing: Reset to the model's positions (removes the label) or delete the swing.
2. Rebuild the label archive: `python scripts/make_labelled_dataset.py --out ...`.
3. Any frozen manifest that included the swing is now stale: its SHA-256 will not
   match and the release gate will refuse it. Freeze a new version; do not edit the old.
4. A model already trained on the withdrawn swing is not changed by this. Whether it
   must be retrained is a policy decision to record in the model card (see
   `docs/legal/freedom-to-operate-questions.md` and the privacy register).

## Browser diagnostics a user sent

Diagnostics and run reports live in the browser artifact's own storage, visible only
to its owner. Delete them there (asset and database deletion), and confirm by listing
the artifact's assets.

## GolfDB-derived data

`swingml/out/golfdb/` holds landmarks derived from YouTube footage. Delete the folder
to remove them; only manifests (ids and hashes) are committed.
