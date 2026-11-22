import { Pool } from "pg";
import { createClient } from "redis";
import { config } from "./config";

export const database = new Pool({
  connectionString: config.databaseUrl,
});

export const cache = createClient({
  url: config.redisUrl,
});

cache.on("error", (error) => {
  console.error("Redis client error:", error);
});
