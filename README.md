# Matroom

Matroom is a wrestling-focused social app with an Expo/React Native client, an Express API, and Dockerized PostgreSQL and Redis services.

## Project status

Matroom is an active local-development prototype. The main account, video, and social flows are implemented; messaging and production hosting are not.

### Implemented

- Email/password registration and sign-in; account profiles store weight class, school, and season record.
- A vertical video feed with MP4/MOV uploads, captions, authenticated playback, and profile-owned video removal.
- Per-account likes and dislikes, comments, and share counts. Commenters are labeled by school when available. The device share menu shares a caption and video ID.
- A King of the Hill leaderboard. Each account has one nomination and can move it to another video. Three animated sample leaders appear until real nominations exist.
- Docker Compose services for the API, PostgreSQL, and Redis. Video files persist in the `videos_data` volume.

### Current limitations

- Messages is a placeholder.
- King of the Hill sample cards are demo data, not playable clips.
- Shared captions and video IDs are not deep links.
- Sign-in has no email verification or password recovery.
- Video files use a local Docker volume. A Cloud Run deployment needs object storage such as Google Cloud Storage and production secrets/configuration.

## Technology

- Mobile: Expo, React Native, TypeScript, Expo Go
- API: Node.js 22+, Express, TypeScript
- Data: PostgreSQL and Redis
- Local infrastructure: Docker Compose

## Setup

### Requirements

- Docker Desktop (or Docker Engine with the Compose plugin)
- Node.js 22.13 or newer and npm
- Expo Go on a physical device, or an iOS/Android simulator

### Start the API and data services

1. Copy the root `.env.example` to `.env`. Its credentials are development defaults; change them before exposing the services.
2. From the repository root, start the stack:

   ```sh
   docker compose up --build -d
   ```

3. Check that the services are healthy:

   ```sh
   docker compose ps
   ```

   The API health endpoint is <http://localhost:3000/api/health>. It reports PostgreSQL and Redis status.

### Start the mobile app

1. Copy `apps/mobile/.env.example` to `apps/mobile/.env`.
2. Set `EXPO_PUBLIC_API_URL`:
   - Physical device on the same Wi-Fi: use your computer's LAN IP, for example `http://192.168.1.25:3000`.
   - Simulator: use the API address reachable from that simulator.
3. Install dependencies and start Expo:

   ```sh
   npm install
   npm run dev:mobile
   ```

4. Open the project in Expo Go by scanning the QR code. Sign in or create an account, then use the Feed and Profile tabs.

The Expo app runs on the host rather than in Docker so it can connect to simulators and physical devices.

## Features and data

- Video uploads accept MP4 or MOV clips up to 60 seconds and 100 MB. Captions are optional.
- PostgreSQL stores account profiles, video metadata, reactions, nominations, comments, and share counts. Redis is connected and included in API health checks.
- Uploaded video files are stored in the Compose `videos_data` volume. `docker compose down` preserves the volumes.
- **Do not run `docker compose down -v`** unless you intend to delete the database, cache, and uploaded videos.

To run the API directly on the host, start only PostgreSQL and Redis with `docker compose up -d postgres redis`, then run `npm run dev:api` in a separate terminal.

## Development checks

From the repository root:

```sh
npm run typecheck
npm run build --workspace @matroom/api
```

For mobile bundle validation:

```sh
npm exec --workspace @matroom/mobile -- expo export --platform ios
```

## AI tool usage

GitHub Copilot in VS Code was used as an AI development assistant throughout the project. It assisted with Docker/Compose setup, account and profile flows, video upload/feed work, social interactions, King of the Hill, Expo troubleshooting, and documentation.

Changes were checked with the TypeScript checks, API builds, Expo iOS bundle exports, Docker health checks, and focused API integration checks for uploads, ownership, reactions, comments, shares, and nominations. These checks do not replace manual testing on a device or a security review before production deployment.
