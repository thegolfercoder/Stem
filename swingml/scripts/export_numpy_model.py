"""Write the installed swing model's weights for the NumPy network.

The packaged desktop application runs swingml.model.numpy_net instead of PyTorch,
from an .npz of the same weights next to the .pt. Run this after installing a new
model; tests/test_numpy_net.py checks the two agree and share a fingerprint, so a
stale .npz is caught rather than shipped.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model, model_fingerprint
from swingml.assets import package_data
from swingml.model.numpy_net import NumpyEventNet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=package_data() / "swing_event_net.pt")
    parser.add_argument("--out", type=Path, default=package_data() / "swing_event_net.npz")
    args = parser.parse_args()
    source = load_model(args.model)
    exported = NumpyEventNet.from_torch(source)
    exported.save(args.out)
    reloaded = NumpyEventNet.load(args.out)
    assert model_fingerprint(reloaded) == model_fingerprint(source), "fingerprints differ"
    size = args.out.stat().st_size / 1e6
    print(f"wrote {args.out} ({size:.1f} MB), fingerprint {model_fingerprint(reloaded)}")


if __name__ == "__main__":
    main()
