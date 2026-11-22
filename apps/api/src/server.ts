import { app } from "./app";
import { config } from "./config";
import { cache, database } from "./services";

async function start(): Promise<void> {
  await cache.connect();
  await database.query("SELECT 1");

  const server = app.listen(config.port, () => {
    console.log(`Matroom API listening on http://localhost:${config.port}`);
  });

  let isShuttingDown = false;
  const shutdown = (): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    server.close((error) => {
      if (error) {
        console.error("Failed to close the HTTP server:", error);
        process.exitCode = 1;
      }

      void Promise.all([database.end(), cache.quit()]).catch((shutdownError: unknown) => {
        console.error("Failed to close API connections:", shutdownError);
        process.exitCode = 1;
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start().catch((error: unknown) => {
  console.error("Failed to start Matroom API:", error);
  process.exitCode = 1;
});
