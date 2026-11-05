# Threat model

Scope: the desktop app (Flask on 127.0.0.1 inside a native window), the browser
app (a static page), the iPhone app, and the model and data pipeline. Method: assets,
entry points, threats by STRIDE category, controls, gaps.

## Assets

Swing videos and frames (personal, identifying); pose landmarks; analyses, labels,
feedback; the model weights and error bands (integrity matters: a swapped model gives
wrong numbers with correct-looking provenance); the release gate's frozen manifests.

## Entry points

| Entry point | Trust |
|---|---|
| Uploaded video files (any container, any codec) | untrusted |
| HTTP on 127.0.0.1 from the native window, or any local process | local, unauthenticated |
| Ollama responses (local or LAN) | untrusted text |
| Model and calibration files in the package or `~/.swingml/models` | trusted if checksums match |
| GolfDB and other training data | untrusted input to training |

## Threats and controls

| STRIDE | Threat | Control | Gap |
|---|---|---|---|
| Spoofing | A web page in the user's browser reaches `http://127.0.0.1:<port>`: by a cross-site post, or by DNS rebinding (its own domain pointed at 127.0.0.1) to read swings | server binds loopback only; every request must name 127.0.0.1/localhost as its Host, and state-changing requests carrying another site's Origin are refused (`test_requests_for_another_host_name_are_refused`, `test_state_changes_from_another_site_are_refused`); JSON routes need a JSON content type, which a cross-site form cannot send without a preflight | serving on the LAN (`swingml ui --host 0.0.0.0`) turns the Host check off by explicit choice and warns; still no authentication |
| Tampering | Model or calibration file replaced | calibration must match the weights' fingerprint or bands are refused; model card records SHA-256 | the app does not verify the model's SHA-256 at load |
| Tampering | Training data poisoned (label noise, mislabelled clips) | frozen manifests with SHA-256; leakage check; release gate on a frozen test set and a real fixture | no provenance check of labels themselves |
| Repudiation | Not relevant for a single local user | local event log | - |
| Information disclosure | Media route used to read arbitrary files | `/media/<id>/<path>` resolves under the frames root and rejects escapes (`test_media_route_refuses_to_escape_its_directory`) | - |
| Information disclosure | Coach prompt sends frames to a remote model | local Ollama by default; browser coach only on button press | LAN Ollama is unauthenticated |
| Denial of service | Huge or malformed video exhausts memory or hangs decode | 2 GB upload cap; frames streamed, not held; preflight rejects some bad clips early | no decode timeout; OpenCV/FFmpeg parse untrusted containers (keep them patched) |
| Elevation of privilege | Parser bug in FFmpeg/OpenCV/MediaPipe via a crafted video | none: dependencies are declared with minimum versions, not pinned, and there is no lockfile | no sandboxing of decode; no lockfile; track CVEs for OpenCV and FFmpeg |
| Injection | LLM output rendered as HTML | coach text rendered through a minimal escaper, guard drops unmeasurable claims | review `renderLite` for XSS when markdown support grows |

## Priorities

1. ~~Origin/Host check on the local server~~ - done.
2. Verify the model's SHA-256 against the model card at load, and refuse a mismatch.
3. Decode in a subprocess with a time and memory limit.
4. Before any sync: authentication, per-user authorisation, encryption in transit and at
   rest, audit log, rate limits, and a new threat model.
