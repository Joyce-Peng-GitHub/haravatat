FROM node:24-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:24-trixie-slim AS application
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
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
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
ENV COMPILER_HOST=0.0.0.0 TYPST_PACKAGE_CACHE=/packages
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/compiler.ts"]
