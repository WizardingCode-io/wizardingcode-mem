# The team server's image (ADR 0026): the release's Linux binary for the target architecture
# on a slim Debian with git (the mirror) and CA certificates. Built from the repository with
# the binaries in dist/; see .dockerignore for what the context carries.

# The build's file names are not the platform's (x64 vs amd64), so a stage picks the binary.
# It runs on the build platform: a copy needs no emulation.
FROM --platform=$BUILDPLATFORM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS pick
ARG TARGETARCH
COPY dist/ /dist/
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) file=wizardingcode-mem-linux-x64 ;; \
      arm64) file=wizardingcode-mem-linux-arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    cp "/dist/$file" /wizardingcode-mem

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --user-group --home-dir /data --no-create-home --shell /usr/sbin/nologin wizardingcode \
    && mkdir -p /data \
    && chown 10001:10001 /data
# The release's artefacts lose the executable bit: it is set here.
COPY --from=pick --chmod=0755 /wizardingcode-mem /usr/local/bin/wizardingcode-mem
ENV WIZARDINGCODE_MEM_TEAM_DATA=/data \
    WIZARDINGCODE_MEM_TEAM_HOST=0.0.0.0 \
    WIZARDINGCODE_MEM_MIGRATE=off \
    WIZARDINGCODE_HOME=/data/home
USER 10001
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 CMD ["wizardingcode-mem", "serve", "health"]
ENTRYPOINT ["wizardingcode-mem"]
CMD ["serve"]
