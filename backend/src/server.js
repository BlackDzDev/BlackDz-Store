require("dotenv").config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("troque")) {
  console.warn(
    "[aviso] JWT_SECRET não configurado (ou ainda no valor de exemplo). Defina um segredo forte em .env antes de ir para produção."
  );
}

const { initDb, usingPostgres } = require("./db");

async function main() {
  await initDb();
  console.log(usingPostgres ? "[db] Persistindo no Postgres (DATABASE_URL definida)." : "[db] Persistindo em arquivo local (database.json).");

  const app = require("./app");
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`BlackDz Store API rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[erro fatal ao iniciar o servidor]", err);
  process.exit(1);
});
