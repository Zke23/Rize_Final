# Matroom

Matroom is a starter monorepo for a wrestling-focused social app. It contains an Expo/React Native client, an Express API, and local PostgreSQL and Redis services.

## Requirements

- Docker Desktop (or Docker Engine with the Compose plugin)
- Node.js 22.13 or newer and npm to run the Expo mobile app

## Start developing

1. Copy `.env.example` to `.env` in the project root.
2. Start the API and its PostgreSQL and Redis dependencies: `docker compose up --build`
3. In another terminal, install dependencies with `npm install` and start the mobile app: `npm run dev:mobile`

The API health endpoint is `http://localhost:3000/api/health`. It checks PostgreSQL and Redis and returns HTTP 503 if either service is unavailable. The API container waits for both data services to become healthy before starting.

To run the API directly on the host instead, use `docker compose up -d postgres redis`, then run `npm install` and `npm run dev:api`. Stop the containerized stack with `docker compose down`; add `-v` only if you also want to delete the persisted database and cache data.

Run TypeScript checks for both workspaces with `npm run typecheck`.

The Expo starter is intentionally minimal and runs on the host so Expo can connect to simulators and physical devices. For a physical device, configure the API URL to use your development machine's LAN address rather than `localhost` when API integration is added. Video uploads, authentication, clip moderation/AI, likes, and King of the Hill logic are not implemented yet.
