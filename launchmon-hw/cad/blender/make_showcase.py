#!/usr/bin/env python3
"""Render the buyer showcase videos from the CAD, free and locally.

    python3 cad/blender/make_showcase.py OUT_DIR            # full 1080p render, then encode
    python3 cad/blender/make_showcase.py OUT_DIR --encode-only
    python3 cad/blender/make_showcase.py OUT_DIR --render-only --shots=ground_hero,ground_assembly

Rendering resumes: frames already on disk are kept, so an interrupted run can
simply be started again.

Needs blender (4.x), ffmpeg and Pillow. Run make_blends.py first so the .blend
files match the CAD. EEVEE needs an OpenGL context: on a machine without a
display, run this under xvfb-run.

Writes, in OUT_DIR:
    clips/<shot>.mp4                 each shot alone, captioned
    stem_launch_monitor_showcase.mp4 title card, every shot in SHOTS order, end card

Every frame is a render of the CAD geometry. The cards and captions say so,
and they claim nothing the prototype has not done: no speeds, no accuracy.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BLENDER = "blender"
FPS = 24
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# (shot, .blend, caption title, caption detail), in reel order
SHOTS = [
    ("ground_hero", "ground_radar_unit.blend", "Ground radar unit",
     "96 x 64 x 21 mm  |  smoked radome  |  1/4-20 phone mount on the dock  |  pod parked on the back"),
    ("ground_assembly", "ground_radar_unit.blend", "Inside the ground unit",
     "24 GHz I/Q Doppler radar  |  ESP32-C3  |  1500 mAh LiPo, USB-C charging  |  piezo buzzer"),
    ("ground_in_use", "ground_radar_unit.blend", "Placement",
     "Radar faces the target, 15 degrees up  |  phone films from a tripod 3 m back  |  beam illustrative"),
    ("pod_hero", "shaft_pod.blend", "Club-mounted motion pod",
     "32 x 26 x 14 mm  |  6-axis IMU  |  Bluetooth LE link to the ground unit"),
    ("pod_assembly", "shaft_pod.blend", "Inside the pod",
     "IMU on a flat datum floor  |  100 mAh LiPo  |  ESP32-C3, USB-C charging"),
    ("pod_mount", "shaft_pod.blend", "Snap-on clamp",
     "Fits a 13 mm shaft section  |  arrow points to the clubhead  |  secured with zip ties"),
    ("pod_park", "ground_radar_unit.blend", "Pod park",
     "The pod parks on the back and charges from the unit  |  one object to carry, one cable to charge"),
    ("radome_colours", "ground_radar_unit.blend", "Radome colours",
     "The radome is the one colour choice  |  smoke, ice or amber; the body stays matte black"),
]

TITLE = ("Stem Launch Monitor", "Two-unit system: ground radar + club-mounted motion pod",
         "Prototype design  |  CAD renders, not product footage")
END = ("Stem Launch Monitor", "Prototype in development",
       "All visuals are renders of the current CAD design. No performance figures are shown or implied.")


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def render(out: Path, only: set[str] | None = None) -> None:
    for shot, blend, *_ in SHOTS:
        if only and shot not in only:
            continue
        frames = out / "frames" / shot
        frames.mkdir(parents=True, exist_ok=True)
        print(f"rendering {shot}", flush=True)
        run([BLENDER, "-b", str(HERE / blend), "-P", str(HERE / "render_showcase.py"), "--", shot, str(frames)])


def card(path: Path, title: str, subtitle: str, note: str) -> None:
    W, H = 1920, 1080
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):   # quiet vertical gradient
        v = int(14 + 18 * (1 - y / H))
        for x in range(W):
            px[x, y] = (v, v + 2, v + 6)
    d = ImageDraw.Draw(img)
    big, mid, small = ImageFont.truetype(FONT_BOLD, 96), ImageFont.truetype(FONT, 44), ImageFont.truetype(FONT, 30)
    for text, font, y, fill in [(title, big, 400, (240, 242, 246)), (subtitle, mid, 540, (190, 200, 215)),
                                (note, small, 650, (232, 140, 50))]:
        w = d.textlength(text, font=font)
        d.text(((W - w) / 2, y), text, font=font, fill=fill)
    d.rectangle([(W / 2 - 60, 505), (W / 2 + 60, 509)], fill=(232, 140, 50))
    img.save(path)


def esc(t: str) -> str:
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def encode(out: Path) -> None:
    clips = out / "clips"
    clips.mkdir(exist_ok=True)
    parts = []

    for name, text in (("title", TITLE), ("end", END)):
        png = out / f"{name}.png"
        card(png, *text)
        mp4 = clips / f"{name}.mp4"
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", "4", "-i", str(png),
             "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=3.4:d=0.6",
             "-c:v", "libx264", "-preset", "slow", "-crf", "16", str(mp4)])

    for shot, _, title, detail in SHOTS:
        frames = out / "frames" / shot
        n = len(list(frames.glob("f_*.png")))
        if n == 0:
            print(f"skipping {shot}: not rendered yet")
            continue
        dur = n / FPS
        caption = (
            f"drawbox=x=0:y=ih-150:w=iw:h=150:color=black@0.45:t=fill,"
            f"drawtext=fontfile={FONT_BOLD}:text='{esc(title)}':x=80:y=h-128:fontsize=46:fontcolor=white,"
            f"drawtext=fontfile={FONT}:text='{esc(detail)}':x=80:y=h-68:fontsize=28:fontcolor=0xD8DEE8,"
            f"drawtext=fontfile={FONT}:text='CAD render':x=w-tw-60:y=40:fontsize=24:fontcolor=white@0.7,"
            f"fade=t=in:st=0:d=0.5,fade=t=out:st={dur - 0.5:.2f}:d=0.5"
        )
        mp4 = clips / f"{shot}.mp4"
        run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(frames / "f_%04d.png"),
             "-vf", caption, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", str(mp4)])
        parts.append(mp4)

    if len(parts) < len(SHOTS):
        print("reel not built: some shots are not rendered yet")
        return
    order = [clips / "title.mp4", *parts, clips / "end.mp4"]
    lst = out / "concat.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in order))
    reel = out / "stem_launch_monitor_showcase.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", "-movflags", "+faststart", str(reel)])
    print(f"wrote {reel}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    only = None
    for a in sys.argv:
        if a.startswith("--shots="):
            only = set(a.split("=", 1)[1].split(","))
    if "--encode-only" not in sys.argv:
        render(out, only)
    if "--render-only" not in sys.argv:
        encode(out)


if __name__ == "__main__":
    main()
