# One image for both services; each fly.*.toml picks the entry point.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx runs the TypeScript directly, so dev dependencies are needed. The Hookdeck
# CLI is only used for local development (hookdeck listen), so its binaries are dropped.
RUN npm ci --include=dev && rm -rf node_modules/hookdeck-cli node_modules/.bin/hookdeck
COPY tsconfig.json ./
COPY src ./src
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/agent/index.ts"]
