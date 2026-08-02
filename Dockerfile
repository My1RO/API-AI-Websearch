FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /home/node/app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS production-dependencies

WORKDIR /home/node/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime

ARG SOURCE_REVISION

RUN test -n "${SOURCE_REVISION}"

LABEL org.opencontainers.image.source="https://github.com/My1RO/API-AI-Websearch" \
  org.opencontainers.image.revision="${SOURCE_REVISION}"

ENV NODE_ENV=production \
  PORT=3065

WORKDIR /home/node/app

COPY --from=production-dependencies --chown=node:node /home/node/app/node_modules ./node_modules
COPY --from=build --chown=node:node /home/node/app/build ./build
COPY --chown=node:node package.json package-lock.json ./

USER node

EXPOSE 3065

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3065/health').then(async response => { const body = await response.json(); process.exit(response.ok && body?.ai?.ready === true ? 0 : 1); }).catch(() => process.exit(1));"]

CMD ["node", "build/index.js"]
