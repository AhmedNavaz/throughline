FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/AhmedNavaz/throughline" \
      org.opencontainers.image.description="Throughline private-link service for Ask a Friend" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY collaboration-format.mjs ./collaboration-format.mjs
COPY sharing/server.mjs sharing/store.mjs ./sharing/
COPY sharing/public ./sharing/public
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4319 SHARING_DATA_DIR=/data REQUIRE_HTTPS=true
EXPOSE 4319
VOLUME ["/data"]
CMD ["node", "sharing/server.mjs"]
