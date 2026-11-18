# Privacy risk register

What personal data the product handles, where it goes, and the risks. Scores are
likelihood × impact on a 1-3 scale, judged, not measured.

## Data handled

| Data | Where | Leaves the device? |
|---|---|---|
| Swing videos (identifiable: face, body, location, other people in shot) | desktop `~/.swingml/videos/`; iPhone app sandbox; browser page memory | Desktop and iPhone: no. Browser: only if the owner sends diagnostics |
| Key frames and scrubber stills with the skeleton drawn on | desktop `~/.swingml/frames/` | No |
| Pose landmarks (a body-movement signature; possibly identifying) | `pose.npz` beside the frames | No |
| Analyses, metrics, labels, clubs, notes | SQLite `swings.db` | No |
| Practice plans, feedback text, usage events | SQLite, since store v2 | No |
| Coach prompts (measurements + a contact sheet image) | to Ollama on localhost or the user's LAN | To the user's own Ollama only |
| Browser coach (measurements + contact sheet) | to Claude through the artifact host, on request | Yes, when the user presses the button |
| Browser diagnostics (poses, scores, contact sheets, clip under 20 MB) | to the artifact's own storage, owner only | Yes, only on the owner's explicit send |

## Risks

| # | Risk | L | I | Score | Controls in place | Gap |
|---|---|---|---|---|---|---|
| 1 | Someone else on the computer opens the app and sees the videos | 2 | 2 | 4 | none beyond the OS account | optional app lock; encryption at rest |
| 2 | Videos include bystanders or minors | 2 | 3 | 6 | consent guidance for labels only | capture guidance; face blurring for shared or labelled swings |
| 3 | Exported JSON shared carelessly (contains labels, notes, analyses) | 2 | 1 | 2 | export excludes videos | warn on export; redact notes option |
| 4 | Local LLM endpoint on the LAN (Ollama with `OLLAMA_HOST=0.0.0.0`) exposes a model server to the network | 2 | 2 | 4 | README tells users to enable it; no auth in Ollama | document firewall scope; prefer localhost |
| 5 | Browser coach sends frames to a third-party model | 1 | 2 | 2 | only on button press; disclosed on the page | per-send confirmation with a preview of what is sent |
| 6 | Browser diagnostics upload includes the clip | 1 | 3 | 3 | owner-only storage; explicit send; size cap | retention limit and deletion on request |
| 7 | Training labels from other people without consent | 2 | 3 | 6 | annotation guide requires written consent; none for minors | consent record enforced in the data, not only in the guide |
| 8 | Deletion incomplete (derived files left behind) | 1 | 2 | 2 | erase removes rows, frames, videos; deleting a swing removes its row, links, frames and video | backups the user makes themselves |
| 9 | Pose data used to identify a person (gait-like signature) | 1 | 3 | 3 | never leaves the device | if sync is added, treat as biometric-adjacent |
| 10 | Pain or injury mentioned in feedback | 2 | 2 | 4 | disclaimer on the practice page; drills make no medical claims | route mentions of pain to a stop-and-see-a-professional message |

## Before any sync or accounts

Consent per purpose (storage, coach sharing, model improvement) recorded with the
data; age check and parental consent for juniors; data processing agreements with any
host; a deletion path that reaches backups; a data protection impact assessment,
because video of people plus a movement signature is sensitive.
