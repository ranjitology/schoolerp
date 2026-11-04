# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @schoolerp/ui build && pnpm --filter @schoolerp/admin-console build

FROM nginx:1.27-alpine AS runtime
COPY infra/docker/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/admin-console/dist /usr/share/nginx/html
EXPOSE 80
