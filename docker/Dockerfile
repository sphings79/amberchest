# Mail Archiver container: the same engine and the same web interface as the
# desktop app, plus a scheduler.
#
# Build for both architectures:
#   docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile -t mail-archiver .

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS build

WORKDIR /build

# Manifests first, so the dependency layer survives source changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/

# The desktop workspace is not part of the image; skipping its install keeps
# Electron (~200 MB) out of the build.
# --ignore-scripts stops better-sqlite3 from compiling: it ships prebuilt musl
# binaries for x64 and arm64 that node-gyp-build picks up at runtime, so the
# image needs no compiler.
RUN npm ci --ignore-scripts \
           --workspace @mail-archiver/core \
           --workspace @mail-archiver/server \
           --workspace @mail-archiver/web \
           --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/web packages/web

RUN npm run build --workspace @mail-archiver/core \
 && npm run build --workspace @mail-archiver/server \
 && npm run build --workspace @mail-archiver/web

# Reinstall without development dependencies. The frontend build is done at
# this point, so react, vite, lucide and TypeScript are no longer needed - they
# account for more than half of node_modules.
RUN rm -rf node_modules packages/*/node_modules \
 && npm ci --omit=dev --ignore-scripts \
           --workspace @mail-archiver/core \
           --workspace @mail-archiver/server \
           --include-workspace-root

# --------------------------------------------------------------- runtime stage
FROM node:22-alpine

# Chromium renders the PDF export. It is the biggest part of this image, and
# the reason PDF looks the same here as it does in the desktop app.
# su-exec drops privileges after the entrypoint fixed the volume ownership.
RUN apk add --no-cache chromium ca-certificates tzdata su-exec

ENV MAIL_ARCHIVER_CHROMIUM=/usr/bin/chromium-browser \
    MAIL_ARCHIVER_CONFIG_DIR=/config \
    MAIL_ARCHIVER_ARCHIVE_DIR=/archive \
    MAIL_ARCHIVER_HOST=0.0.0.0 \
    MAIL_ARCHIVER_PORT=8484 \
    NODE_ENV=production

WORKDIR /app

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/packages/core/dist ./packages/core/dist
COPY --from=build /build/packages/core/package.json ./packages/core/package.json
COPY --from=build /build/packages/server/dist ./packages/server/dist
COPY --from=build /build/packages/server/package.json ./packages/server/package.json
COPY --from=build /build/packages/web/dist ./packages/web/dist

VOLUME ["/config", "/archive"]
EXPOSE 8484

# Starts as root only to hand the volumes to PUID/PGID, then drops privileges.
RUN mkdir -p /config /archive
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV PUID=1000 \
    PGID=1000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MAIL_ARCHIVER_PORT||8484)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/standalone.js"]
