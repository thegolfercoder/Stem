# PyInstaller spec for Swing Studio, the desktop application.
#
#   pyinstaller packaging/swing_studio.spec --noconfirm
#
# Built from the repository's swingml/ directory. Carries everything it needs to
# work offline from the first launch: the pose estimator's model, the swing model
# as NumPy weights, its measured error bands, and the interface. PyTorch is left
# out on purpose - see swingml/model/numpy_net.py.
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 - defined by PyInstaller
DATA = ROOT / "swingml" / "data"

pose_model = Path(os.environ.get("SWINGML_POSE_MODEL", DATA / "pose_landmarker_heavy.task"))
if not pose_model.is_file():
    sys.exit(
        f"pose model not found at {pose_model}: download pose_landmarker_heavy.task into "
        "swingml/swingml/data/ or set SWINGML_POSE_MODEL"
    )
for required in ("swing_event_net.npz", "event_calibration.json"):
    if not (DATA / required).is_file():
        sys.exit(f"{required} is missing from {DATA}; run scripts/export_numpy_model.py")

datas = [
    (str(ROOT / "swingml" / "web" / "templates"), "swingml/web/templates"),
    (str(ROOT / "swingml" / "web" / "static"), "swingml/web/static"),
    (str(DATA / "swing_event_net.npz"), "swingml/data"),
    (str(DATA / "event_calibration.json"), "swingml/data"),
    (str(pose_model), "swingml/data"),
]
datas += collect_data_files("mediapipe")
binaries = collect_dynamic_libs("mediapipe")
hiddenimports = collect_submodules("swingml") + ["webview"]

analysis = Analysis(  # noqa: F821
    [str(ROOT / "packaging" / "launch.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["torch", "torchvision", "scipy", "tkinter", "synth", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="SwingStudio",
    console=sys.platform.startswith("linux"),
    icon=None,
)
collected = COLLECT(  # noqa: F821
    exe, analysis.binaries, analysis.datas, strip=False, upx=False, name="SwingStudio"
)
if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        collected,
        name="Swing Studio.app",
        bundle_identifier="com.swingml.studio",
        info_plist={
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "0.2.0",
            "LSMinimumSystemVersion": "12.0",
        },
    )
