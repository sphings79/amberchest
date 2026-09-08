#!/bin/sh
# Adjusts ownership of the mounted volumes, then drops privileges.
#
# unRAID, Synology and plain docker hosts all mount directories that belong to
# some host user. PUID/PGID is the convention for making that work, so the
# container starts as root, hands the volumes to the requested user and then
# runs the application without privileges.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  if ! getent group "$PGID" > /dev/null 2>&1; then
    addgroup -g "$PGID" archiver 2>/dev/null || true
  fi
  if ! getent passwd "$PUID" > /dev/null 2>&1; then
    adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" archiver 2>/dev/null || true
  fi

  chown -R "$PUID:$PGID" /config /archive 2>/dev/null || \
    echo "Warning: could not change ownership of /config or /archive"

  exec su-exec "$PUID:$PGID" "$@"
fi

# Already unprivileged (for example with docker run --user).
exec "$@"
