module.exports = {
  apps: [
    {
      name: "amburax-pos-web",
      cwd: "./apps/web",
      script: "npm",
      args: "run start -- -p 3001",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
    {
      name: "amburax-pos-outbox",
      cwd: "./apps/web",
      script: "npx",
      args: "tsx src/server/events/outboxWorker.ts",
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
