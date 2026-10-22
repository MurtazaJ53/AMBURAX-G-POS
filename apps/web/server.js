import http from "node:http";
import next from "next";

const port = Number.parseInt(process.env.PORT || "3001", 10);
const hostname = "0.0.0.0";

const app = next({
  dev: false,
  dir: ".",
  hostname,
  port,
});

const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    server.listen(port, hostname, () => {
      console.log(`[AMBURAX] Production server running on http://${hostname}:${port}`);
    });

    process.on("SIGTERM", () => {
      console.log("[AMBURAX] Received SIGTERM, shutting down gracefully");
      server.close();
    });

    process.on("SIGINT", () => {
      console.log("[AMBURAX] Received SIGINT, shutting down gracefully");
      server.close();
    });
  })
  .catch((err) => {
    console.error("[AMBURAX] Failed to start server:", err);
    process.exit(1);
  });
