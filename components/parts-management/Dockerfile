# Parts Management Service: Express + Prisma on port 3003
# Build from components/parts-management so prisma/ and src/ are in context.

FROM node:18-alpine

# openssl: Prisma's query engine needs it on Alpine.  curl: compose healthcheck.
RUN apk add --no-cache openssl curl

WORKDIR /app

# .npmrc carries legacy-peer-deps, matching dispatch.
COPY package*.json .npmrc ./
RUN npm ci

COPY . .

# Generate after the schema is present; npm ci's postinstall runs too early.
RUN npx prisma generate && npm run build

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -f http://localhost:3003/health || exit 1

# Migrations apply on start, so a deploy is just a rebuild.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
