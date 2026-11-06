"""Getting data from the hardware into the shapes the pipelines expect.

`iq` turns the ground unit's two-channel radar capture into the single real
channel the radar pipeline was written for. `ground_unit` reads the ground
unit's USB stream: shot summaries, raw radar captures and raw IMU blocks.
"""
