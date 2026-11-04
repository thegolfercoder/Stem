"""Radar, club IMU and phone camera, on one timeline, as one shot.

Each sensor runs on its own clock and sees the swing differently. Fusion puts
them on a shared timeline, with zero at impact, using the one moment every
sensor sees sharply: the strike. Then, for each event and each number, it
takes the sensor that measures it best, and compares sensors wherever two of
them measure the same thing.

`camera` reads swingml's output (no code is shared with swingml, only its JSON).
`audio` finds the strike in the video's sound. `shot` does the fusion.
"""
