import { describe, expect, it } from "vitest";

const { buildApp } = await import("../app.js");

describe("[integração real] GET /health", () => {
  it("responde 200 com o app real, sem tocar o banco", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });
});
