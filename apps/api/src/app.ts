import cors from "cors";
import express from "express";
import { cache, database } from "./services";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response) => {
  const [postgresResult, redisResult] = await Promise.allSettled([
    database.query("SELECT 1"),
    cache.ping(),
  ]);
  const services = {
    postgres: postgresResult.status === "fulfilled" ? "ok" : "unavailable",
    redis: redisResult.status === "fulfilled" ? "ok" : "unavailable",
  };
  const healthy = postgresResult.status === "fulfilled" && redisResult.status === "fulfilled";

  if (!healthy) {
    if (postgresResult.status === "rejected") {
      console.error("PostgreSQL health check failed:", postgresResult.reason);
    }
    if (redisResult.status === "rejected") {
      console.error("Redis health check failed:", redisResult.reason);
    }
  }

  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "unavailable",
    services,
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});
