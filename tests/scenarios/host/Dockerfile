# The scenarios' stand-in for the team server's image: the entrypoint, the user, the data
# directory and the health check of the real Dockerfile, around a shell script.
FROM busybox:1.36@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662
ARG WCM_VERSION
ARG WCM_SCHEMA=2
ARG WCM_HEALTH=ok
ARG WCM_START=serve
ENV WCM_VERSION=$WCM_VERSION WCM_SCHEMA=$WCM_SCHEMA WCM_HEALTH=$WCM_HEALTH WCM_START=$WCM_START
COPY --chmod=0755 wizardingcode-mem.sh /usr/local/bin/wizardingcode-mem
RUN mkdir -p /data && chown 10001:10001 /data
USER 10001
VOLUME /data
HEALTHCHECK --interval=1s --timeout=2s --start-period=1s --retries=3 CMD ["wizardingcode-mem", "serve", "health"]
ENTRYPOINT ["wizardingcode-mem"]
CMD ["serve"]
