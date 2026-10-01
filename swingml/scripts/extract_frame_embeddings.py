"""Per-frame image features for GolfDB clips, on the same 60 Hz grid as the poses.

The event model sees 33 body landmarks and nothing else, while GolfDB's events
are defined by the club: address is the club soled, toe-up and mid-follow-through
are the shaft parallel to the ground, impact is club on ball. The pixels show the
club. This computes a compact description of each frame with an ImageNet
MobileNetV3-small (torchvision, BSD-3-Clause; weights trained on ImageNet), pooled
to a 2x2 grid so that where in the frame something is survives, and resamples it
onto exactly the grid `make_golfdb_dataset.py` put the poses on, so row t of this
file and row t of the pose archive describe the same instant.

Left-handed clips are mirrored before embedding, so a lead arm is always on the
same side of the picture. Their poses are *not* mirrored before feature
extraction (`features.py` only swaps the lead and trail arm channels), so in
the fused archives a left-hander's image columns are mirrored relative to its
pose columns (#33). The image-feature results in docs/ml/image-features.md were
measured with that mismatch.

Output is a sidecar keyed by GolfDB clip id, never merged into the frozen
archives, whose SHA-256 the manifests pin. Like everything derived from GolfDB's
frames it belongs in the gitignored out/ (CC BY-NC 4.0).

The 2,304 pooled values per frame are projected to 64 by a principal-component
basis fitted on the training split only (every eighth frame of every training
clip), then standardised; the same basis is applied to every other split, so
nothing about validation or test frames shapes the projection.

    python scripts/extract_frame_embeddings.py --videos .../videos_160 \\
        --archive out/golfdb/split2/train.npz --out out/golfdb/rgb/train.npz \\
        --basis out/golfdb/rgb/basis.npz --fit-basis
    python scripts/extract_frame_embeddings.py --videos .../videos_160 \\
        --archive out/golfdb/split2/validation.npz --out out/golfdb/rgb/validation.npz \\
        --basis out/golfdb/rgb/basis.npz
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.dataset.manifest import guard_archive, require_split
from swingml.model.rgb import check_basis

CANONICAL_RATE_HZ = 60.0
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def backbone() -> torch.nn.Module:
    # Research-only dependency, not in the lockfile: pip install torchvision
    # matching the installed torch.
    from torchvision.models import (  # type: ignore[import-untyped, import-not-found, unused-ignore]
        MobileNet_V3_Small_Weights,
        mobilenet_v3_small,
    )

    net = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    features: torch.nn.Module = net.features.eval()
    for parameter in features.parameters():
        parameter.requires_grad_(False)
    return features


def read_frames(path: Path) -> tuple[NDArray[np.uint8], float] | None:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return None
    rate = float(capture.get(cv2.CAP_PROP_FPS))
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    capture.release()
    if not frames or not np.isfinite(rate) or rate <= 0:
        return None
    return np.asarray(frames, dtype=np.uint8), rate


@torch.no_grad()
def embed(net: torch.nn.Module, frames: NDArray[np.uint8], batch: int = 64) -> NDArray[np.float32]:
    """(n, 4 * 576): the last feature map averaged over a 2x2 grid."""
    x = (frames.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
    tensor = torch.from_numpy(x).permute(0, 3, 1, 2).contiguous()
    out = []
    for start in range(0, len(tensor), batch):
        maps = net(tensor[start : start + batch])
        pooled = torch.nn.functional.adaptive_avg_pool2d(maps, 2)
        out.append(pooled.flatten(1).numpy())
    return np.concatenate(out).astype(np.float32)


def to_grid(values: NDArray[np.float32], rate_hz: float) -> NDArray[np.float32]:
    """Linear interpolation onto the pose grid (`features.resample_pose`)."""
    t_source = np.arange(len(values), dtype=np.float64) / rate_hz
    n_out = max(2, round(float(t_source[-1] - t_source[0]) * CANONICAL_RATE_HZ) + 1)
    t_target = np.clip(
        t_source[0] + np.arange(n_out, dtype=np.float64) / CANONICAL_RATE_HZ,
        t_source[0],
        t_source[-1],
    )
    out = np.empty((n_out, values.shape[1]), dtype=np.float32)
    for channel in range(values.shape[1]):
        out[:, channel] = np.interp(t_target, t_source, values[:, channel])
    return out


def fit_basis(samples: NDArray[np.float32], dims: int) -> dict[str, NDArray[np.float32]]:
    mean = samples.mean(axis=0)
    _, singular, vt = np.linalg.svd(samples - mean, full_matrices=False)
    components = vt[:dims]
    projected = (samples - mean) @ components.T
    kept = float((singular[:dims] ** 2).sum() / (singular**2).sum())
    print(f"basis: {dims} components keep {100 * kept:.1f}% of {len(samples)} frames' variance")
    return {
        "mean": mean.astype(np.float32),
        "components": components.astype(np.float32),
        "scale": projected.std(axis=0).astype(np.float32) + 1e-6,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--videos", type=Path, required=True, help="GolfDB videos_160")
    parser.add_argument("--archive", type=Path, required=True, help="pose archive to align to")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--basis", type=Path, required=True, help="projection to 64 dimensions")
    parser.add_argument(
        "--fit-basis", action="store_true", help="fit the basis on this archive (training only)"
    )
    parser.add_argument("--dims", type=int, default=64)
    args = parser.parse_args()
    # Refused before the backbone loads: no holdout clips, and a basis fitted on
    # the frozen train archive only (`swingml.model.rgb.check_basis`).
    guard_archive(args.archive)
    fitted_on = require_split(args.archive, "train") if args.fit_basis else check_basis(args.basis)
    torch.set_num_threads(args.threads)

    archive = np.load(args.archive)
    ids = archive["seeds"].astype(int)
    lengths = archive["lengths"].astype(int)
    left = archive["left_handed"] > 0.5
    net = backbone()
    started = time.time()

    def clip_embedding(
        clip: int, mirror: bool, stride: int = 1
    ) -> tuple[NDArray[np.float32], float]:
        read = read_frames(args.videos / f"{clip}.mp4")
        if read is None:
            raise SystemExit(f"clip {clip}: video unreadable")
        frames, rate = read
        if mirror:
            frames = frames[:, :, ::-1].copy()
        return embed(net, frames[::stride]), rate

    if args.fit_basis:
        samples = np.concatenate(
            [clip_embedding(int(c), bool(m), stride=8)[0] for c, m in zip(ids, left, strict=True)]
        )
        basis = fit_basis(samples, args.dims)
        args.basis.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            args.basis,
            fitted_on=np.array(str(args.archive)),
            fitted_on_sha256=np.array(fitted_on.sha256),
            fitted_on_manifest=np.array(fitted_on.name),
            mean=basis["mean"],
            components=basis["components"],
            scale=basis["scale"],
        )
        print(f"  basis fitted in {time.time() - started:.0f}s", flush=True)
    stored = np.load(args.basis)
    mean, components, scale = stored["mean"], stored["components"], stored["scale"]

    rows: list[NDArray[np.float16]] = []
    for i, (clip, length, mirror) in enumerate(zip(ids, lengths, left, strict=True)):
        raw, rate = clip_embedding(int(clip), bool(mirror))
        grid = to_grid(((raw - mean) @ components.T) / scale, rate)
        if len(grid) != length:
            raise SystemExit(f"clip {clip}: {len(grid)} grid rows, the pose archive has {length}")
        rows.append(grid.astype(np.float16))
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(ids)} clips, {time.time() - started:.0f}s", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        seeds=ids,
        lengths=lengths,
        embeddings=np.concatenate(rows),
        source=str(args.archive),
        basis=str(args.basis),
    )
    print(f"wrote {args.out}: {len(ids)} clips, {sum(lengths)} rows, {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
