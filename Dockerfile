FROM node:24-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit && npm cache clean --force

FROM node:24-trixie-slim AS application
ARG DEBIAN_MIRROR=https://deb.debian.org
# Bootstrap verified HTTPS package downloads using Node's bundled Mozilla CA roots.
RUN node -e "require('fs').writeFileSync('/tmp/node-ca.pem', require('tls').rootCertificates.join('\\n'))" \
    && sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.pem update \
    && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.pem install -y --no-install-recommends git ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* /tmp/node-ca.pem
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server/index.ts"]

FROM ghcr.io/typst/typst:0.15.1 AS typst
FROM node:24-trixie-slim AS compiler
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends util-linux fonts-noto-cjk fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=typst /bin/typst /usr/local/bin/typst
COPY package.json package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY server ./server
ENV COMPILER_HOST=0.0.0.0 TYPST_PACKAGE_CACHE=/packages
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/compiler.ts"]
