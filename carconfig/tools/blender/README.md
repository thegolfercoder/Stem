# Car models built in Blender

Models we make ourselves, as code: every dimension traces back to the maker's
published data or a measurement of their studio photographs, and a model can
be rebuilt after any change.

```sh
pip install bpy          # Blender as a Python module (Python 3.11)
BLENDER_PYTHON=$(which python) npm run build-model porsche/911-gt3-rs
```

`build-model` runs the script, optimises the result like a downloaded model,
checks its proportions against the published figures (`npm run check-model`)
and only then installs it in `public/models` and the model manifest.

To look at a model the way the reference photographs were taken:

```sh
python tools/blender/preview.py model.glb out/prefix side,hero,rear34
```

Views: `side`, `front`, `rear`, `hero`, `rear34`, `top`, and close-ups `apillar`, `lamp`, `wheel`.

| Script | Car | Sources |
| --- | --- | --- |
| `gt3rs.py` | Porsche 911 GT3 RS (992.1), sold as the 2026 model year | Porsche technical data sheet; Porsche press studio side, front, rear and ¾ views (`gt3rs-traced.json`) |
