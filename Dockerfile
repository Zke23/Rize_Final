FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace @matroom/api

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV VIDEO_STORAGE_DIR=/app/uploads
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --omit=dev --workspace @matroom/api --include-workspace-root=false \
    && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@matroom/api"]
