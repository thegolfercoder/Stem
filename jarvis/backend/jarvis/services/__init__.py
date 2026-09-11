"""Application logic: what JARVIS does, independent of how it is called.

Routers in `jarvis.api` translate HTTP to these functions and back. Keeping the
logic here is what will let phase 5 add a voice interface, or a command line, by
writing a new caller rather than a second implementation.
"""
