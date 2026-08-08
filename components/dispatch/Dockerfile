# Dispatch Service — Express + Prisma on port 3001
# Build from components/dispatch so prisma/ and src/ are in context.

FROM node:18-alpine

# openssl: Prisma's query engine needs it on Alpine.  curl: compose healthcheck.
RUN apk add --no-cache openssl curl

WORKDIR /app

# .npmrc carries legacy-peer-deps, without which npm ci fails on a
# devDependency-only peer conflict. See the comment in that file.
COPY package*.json .npmrc ./
RUN npm ci

COPY . .

# Generate after the schema is present — npm ci's postinstall runs too early.
RUN npx prisma generate && npm run build

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
