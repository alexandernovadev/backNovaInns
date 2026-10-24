# ── Build ──────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN pnpm build && pnpm prune --prod

# ── Runtime ────────────────────────────────────────────
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
