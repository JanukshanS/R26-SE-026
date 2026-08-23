# Build context is the REPO ROOT (turbopack root points two levels up).
# docker build -f apps/kaduna-web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo/apps/kaduna-web

RUN corepack enable

COPY apps/kaduna-web/package.json apps/kaduna-web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY apps/kaduna-web/ ./
# tsconfig maps contracts/* to ../../contracts — the shared contract files must be in the image.
COPY contracts /repo/contracts

# NEXT_PUBLIC_* values are inlined at build time; all are publishable, not secrets.
ARG NEXT_PUBLIC_SUPABASE_URL=https://huynmjagdlkvqcmgdipk.supabase.co
ARG NEXT_PUBLIC_SUPABASE_KEY=sb_publishable_afsnNQOy9fRKfu-5i1lWUw_AQ9vBRJO
ARG NEXT_PUBLIC_GEO_URL=https://geo.vps.kaduna.lk
ARG NEXT_PUBLIC_DISPATCH_URL=https://dispatch.vps.kaduna.lk
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_KEY=$NEXT_PUBLIC_SUPABASE_KEY \
    NEXT_PUBLIC_GEO_URL=$NEXT_PUBLIC_GEO_URL \
    NEXT_PUBLIC_DISPATCH_URL=$NEXT_PUBLIC_DISPATCH_URL

RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/kaduna-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/kaduna-web/out /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1
