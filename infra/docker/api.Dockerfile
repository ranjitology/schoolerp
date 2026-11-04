# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Install with the lockfile for reproducible builds.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY infra/scripts ./infra/scripts
RUN pnpm install --frozen-lockfile --prod=false

# Prisma client types are needed by @schoolerp/db and the API build.
RUN pnpm --filter @schoolerp/db exec prisma generate
RUN pnpm --filter @schoolerp/core build \
 && pnpm --filter @schoolerp/db build \
 && pnpm --filter @schoolerp/api build

FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache wget
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=builder /repo /repo
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
