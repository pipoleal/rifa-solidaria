import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Carrega .env.test explicitamente (não é o .env padrão usado pelo dev normal)
// — precisa rodar antes de qualquer módulo da app ler process.env.
config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/integrationSetup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Um único fork: os testes compartilham o mesmo banco de teste e usam
    // TRUNCATE entre eles — rodar arquivos em paralelo causaria testes
    // pisando uns nos outros.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
