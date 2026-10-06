# Data retention and deletion

What is kept, for how long, and how it is deleted. The desktop app is local-only, so
the golfer controls retention; there is no server copy to expire.

## Retention

| Data | Kept | Why |
|---|---|---|
| Original video | until the swing or everything is deleted | re-analysis when the model improves; the evidence behind every number |
| Frames, landmarks, analysis | same | show the swing; re-measure when positions are corrected |
| Plans, feedback | same | the practice history |
| Usage events | same | shown to the golfer on the Your-data page |

## Deletion paths (desktop)

| Action | Removes | Leaves | Verified by |
|---|---|---|---|
| Delete a swing (swing page) | its database row, plan links and feedback; its frames folder (pictures, landmarks, positions); its video file | nothing | `test_store_and_web.py::test_deleting_a_swing_removes_its_files`, `test_practice_loop.py::test_deleting_a_swing_removes_it_from_plans` |
| Reset positions | the golfer's positions and training-label flag; restores the model's analysis | nothing else | `test_golfer_positions.py` |
| Erase everything (Your data, type ERASE) | every row in every table, every frame, every video | the pose model and app settings | `test_practice_loop.py::test_everything_can_be_exported_and_erased` |

Deleting a swing used to leave its frames and video on disk, unreferenced; found by
this document's audit and fixed with the test above.

## Export

Your data → Download everything: a JSON of every table, with each analysis in full,
excluding video files (which are in `~/.swingml/videos/` and can be copied directly).

## Browser and iPhone

- Browser app: nothing persists after the tab closes except what the owner explicitly
  sends (run reports, diagnostics), kept in the artifact's own storage.
- iPhone app: history is a JSON file in the app's sandbox; deleting the app deletes it.
  There is no in-app erase-all yet.
