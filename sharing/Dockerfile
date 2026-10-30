FROM node:22-alpine
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
