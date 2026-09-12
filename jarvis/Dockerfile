# JARVIS, packaged to run on a machine you do not sit in front of.
#
# The image holds the application and nothing else. Your database, your
# documents and your key live in a volume mounted at /data, so the image can be
# rebuilt, replaced or thrown away without touching anything personal - and so
# that an image pushed to a registry by accident carries no secrets, because
# there are none in it to carry.

FROM python:3.12-slim AS base

# Stops Python writing .pyc files into the container layer, and makes logs
# appear immediately rather than sitting in a buffer when something goes wrong.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, in their own layer: they change far less often than the
# code, so a code change does not reinstall the world.
COPY pyproject.toml ./
COPY backend ./backend
RUN pip install --no-cache-dir -e .

COPY config ./config
COPY frontend ./frontend

# Everything that persists goes here, and nothing else does.
ENV JARVIS_DATA_DIR=/data \
    JARVIS_LOG_DIR=/data/logs \
    JARVIS_HOST=0.0.0.0 \
    JARVIS_PORT=8765

VOLUME ["/data"]
EXPOSE 8765

# Not root. If something ever gets through the application, it should land as a
# user that owns nothing but the data directory.
RUN useradd --create-home --uid 10001 jarvis \
    && mkdir -p /data \
    && chown -R jarvis:jarvis /data /app
USER jarvis

# A container that answers is not the same as an application that works; this
# asks the app itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/api/auth/status', timeout=4).status == 200 else 1)"

CMD ["jarvis", "serve"]
