"""Save the ground unit's USB stream to a file, byte for byte, until Ctrl-C.

    pip install pyserial
    python scripts/record_ground_unit.py /dev/ttyACM0 session.bin       # macOS: /dev/cu.usbmodem*

Sends 'r' once to turn raw streaming on (radar I/Q and pod IMU blocks per shot),
unless --no-raw. The file is the session's raw record: keep it. Everything
downstream (scripts/fuse_shot.py) can be re-run from it.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("port")
    p.add_argument("out", type=Path)
    p.add_argument("--no-raw", action="store_true")
    args = p.parse_args()
    try:
        import serial  # type: ignore[import-not-found]
    except ImportError:
        sys.exit("pip install pyserial")
    with serial.Serial(args.port, 921_600, timeout=0.2) as port, args.out.open("ab") as out:
        if not args.no_raw:
            port.write(b"r")
        print(f"recording {args.port} -> {args.out}; Ctrl-C to stop")
        total = 0
        try:
            while True:
                chunk = port.read(65_536)
                if chunk:
                    out.write(chunk)
                    out.flush()
                    total += len(chunk)
        except KeyboardInterrupt:
            print(f"\n{total} bytes written")


if __name__ == "__main__":
    main()
