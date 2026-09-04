import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/solidaria_test",
      MP_ACCESS_TOKEN: "TEST-fake-access-token-for-tests",
      MP_WEBHOOK_SECRET: "test-webhook-secret",
      FRONTEND_URL: "http://localhost:3000",
      BACKEND_PUBLIC_URL: "http://localhost:3333",
      PORT: "3333",
      NODE_ENV: "test",
    },
  },
});
