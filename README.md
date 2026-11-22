# Matroom

Matroom is a starter monorepo for a wrestling-focused social app. It contains an Expo/React Native client, an Express API, and local PostgreSQL and Redis services.

## Requirements

- Docker Desktop (or Docker Engine with the Compose plugin)
- Node.js 22.13 or newer and npm to run the Expo mobile app

## Start developing

1. Copy `.env.example` to `.env` in the project root.
2. Start the API and its PostgreSQL and Redis dependencies: `docker compose up --build -d`
3. Copy `apps/mobile/.env.example` to `apps/mobile/.env`. For Expo Go on a physical device, set `EXPO_PUBLIC_API_URL` to your computer's LAN IP address, such as `http://192.168.1.25:3000`.
4. Install dependencies with `npm install`, then start the mobile app: `npm run dev:mobile`

Create an account in the app, then enter a weight class, school, and season record (W-L or W-L-T). Profiles are saved to PostgreSQL and tied to the signed-in account. The API health endpoint is `http://localhost:3000/api/health`. It checks PostgreSQL and Redis and returns HTTP 503 if either service is unavailable. The API container waits for both data services to become healthy before starting.

To run the API directly on the host instead, use `docker compose up -d postgres redis`, then run `npm install` and `npm run dev:api`. Stop the containerized stack with `docker compose down`; add `-v` only if you also want to delete the persisted database and cache data.

Run TypeScript checks for both workspaces with `npm run typecheck`.

The Expo app runs on the host so Expo can connect to simulators and physical devices. Account sign-in currently uses email and password without email verification or password recovery. Video uploads, clip moderation/AI, likes, and King of the Hill logic are not implemented yet.
