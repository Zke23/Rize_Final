# Matroom

Matroom is a starter monorepo for a wrestling-focused social app. It contains an Expo/React Native client, an Express API, and local PostgreSQL and Redis services.

## Requirements

- Node.js 22.13 or newer and npm
- Docker with Docker Compose

## Start developing

1. Copy `.env.example` to `.env` in the project root.
2. Start the local data services: `docker compose up -d`
3. Install dependencies: `npm install`
4. In one terminal, start the API: `npm run dev:api`
5. In another terminal, start the mobile app: `npm run dev:mobile`

The API health endpoint is `http://localhost:3000/api/health`. It checks PostgreSQL and Redis and returns HTTP 503 if either service is unavailable.

Run TypeScript checks for both workspaces with `npm run typecheck`.

The Expo starter is intentionally minimal. For a physical device, configure the API URL to use your development machine's LAN address rather than `localhost` when API integration is added. Video uploads, authentication, clip moderation/AI, likes, and King of the Hill logic are not implemented yet.
