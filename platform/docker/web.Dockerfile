# RuView Monitoring Platform — web app image (build context: platform/).
# Also carries the ruview-agent bundle (public/install) used by the gateway profile.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY gateway-agent/package.json gateway-agent/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY gateway-agent gateway-agent
COPY web web
COPY scripts scripts
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node docker/scheduler.mjs docker/create-admin.mjs /app/docker/
RUN mkdir -p /var/lib/ruview-agent && chown node:node /var/lib/ruview-agent
USER node
EXPOSE 3000
WORKDIR /app/web
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
