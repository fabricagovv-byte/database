
FROM node:22-slim
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# CA extra opcional (proxy corporativo): docker build --secret id=ca_extra,src=<arquivo.crt>
RUN --mount=type=secret,id=ca_extra,required=false \
    if [ -f /run/secrets/ca_extra ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_extra; fi; npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build && chown -R node:node /app
USER node
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
