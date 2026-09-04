import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 3333);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`API rodando na porta ${port}`);
  })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
