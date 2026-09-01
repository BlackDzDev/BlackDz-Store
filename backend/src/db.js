/**
 * Camada de dados.
 *
 * Por padrão (sem a variável DATABASE_URL definida), continua usando lowdb
 * com um arquivo JSON local (database.json) — igual a antes, ótimo pra rodar
 * no seu PC sem configurar nada.
 *
 * Se DATABASE_URL estiver definida (ex: ao publicar num serviço como o
 * Render, cujo disco NÃO é permanente — qualquer arquivo local se perde
 * quando o servidor reinicia ou "dorme"), os dados passam a ser gravados de
 * verdade num banco Postgres (ex: Supabase, gratuito) em vez do arquivo
 * local. Assim nada se perde.
 *
 * Em ambos os casos, o resto do código (as rotas em src/routes/*) continua
 * usando exatamente a mesma interface do lowdb — db.get("produtos")... —
 * sem precisar mudar nenhuma rota.
 */
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let db;

if (DATABASE_URL) {
  // ---------- Modo Postgres (produção, ex: Render + Supabase) ----------
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    // Erro numa conexão ociosa do pool — só loga, não derruba o servidor.
    console.error("[db] Erro na conexão com o Postgres:", err.message);
  });

  // Fila de gravações: o Postgres é assíncrono, mas o resto do código chama
  // `.write()` de forma síncrona (como sempre fez). Por isso a gravação real
  // acontece "em segundo plano", nesta fila — e a fila garante que nunca
  // duas gravações rodem ao mesmo tempo pisando uma na outra.
  let saveQueue = Promise.resolve();
  function scheduleSave(state) {
    const snapshot = JSON.stringify(state);
    saveQueue = saveQueue
      .then(() =>
        pool.query(
          `INSERT INTO blackdz_store (id, data, updated_at)
           VALUES (1, $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET data = $1::jsonb, updated_at = now()`,
          [snapshot]
        )
      )
      .catch((err) => console.error("[db] Falha ao salvar no Postgres:", err.message));
  }

  const postgresAdapter = {
    // Chamado uma única vez, de forma síncrona, ao criar o lowdb. O estado
    // de verdade só é carregado depois, de forma assíncrona, em initDb() —
    // por isso aqui devolvemos vazio.
    read() {
      return {};
    },
    // Chamado (de forma síncrona) toda vez que uma rota faz `.write()`.
    write(state) {
      scheduleSave(state);
    },
  };

  db = low(postgresAdapter);
} else {
  // ---------- Modo arquivo local (padrão, bom pra rodar no seu PC) ----------
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "database.json");
  db = low(new FileSync(file));
}

function applyDefaults() {
  db.defaults({
    users: [],
    products: [],
    categories: [],
    coupons: [],
    orders: [],
    reviews: [],
    tickets: [],
    messages: [], // mensagens do chat privado pedido<->admin, liberado após pagamento confirmado
  }).write();
}

function seedIfEmpty() {
  if (db.get("categories").size().value() === 0) {
    const categories = [
      { slug: "free-fire", label: "Free Fire", type: "game" },
      { slug: "roblox", label: "Roblox", type: "game" },
      { slug: "minecraft", label: "Minecraft", type: "game" },
      { slug: "fivem", label: "FiveM", type: "game" },
    ];
    db.set("categories", categories).write();
  }

  if (db.get("products").size().value() === 0) {
    // Catálogo começa vazio — cadastre os produtos pelo painel admin
    // (POST/PUT /api/products, protegido por role "admin").
    db.set("products", []).write();
  }

  if (db.get("coupons").size().value() === 0) {
    db.set("coupons", [
      { code: "BLACKDZ10", percentOff: 10, active: true, uses: 0 },
      { code: "WELCOME15", percentOff: 15, active: true, uses: 0 },
    ]).write();
  }

  // Cria a conta admin inicial a partir das variáveis de ambiente, se ainda não existir.
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && !db.get("users").find({ email: adminEmail }).value()) {
    db.get("users")
      .push({
        id: uuid(),
        name: "Admin",
        email: adminEmail,
        passwordHash: bcrypt.hashSync(adminPassword, 12),
        role: "admin",
        createdAt: new Date().toISOString(),
      })
      .write();
    console.log(`[seed] Conta admin criada para ${adminEmail} — troque a senha após o primeiro login.`);
  }
}

/**
 * Prepara o banco antes do servidor começar a aceitar requisições:
 * - Modo Postgres: cria a tabela (se não existir) e carrega os dados já
 *   salvos anteriormente (se houver) antes de aplicar defaults/seed.
 * - Modo arquivo local: não precisa de nada assíncrono, mas mantemos a
 *   mesma função pra o server.js chamar do mesmo jeito nos dois modos.
 */
async function initDb() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blackdz_store (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await pool.query("SELECT data FROM blackdz_store WHERE id = 1");
    if (rows.length && rows[0].data) {
      db.setState(rows[0].data);
      console.log("[db] Dados carregados do Postgres.");
    } else {
      console.log("[db] Primeira vez rodando com este banco — começando vazio (será salvo no primeiro write).");
    }
  }
  applyDefaults();
  seedIfEmpty();
}

/**
 * Usada pela rota /api/health. Além de confirmar que a API está de pé,
 * fazer uma consulta rápida no Postgres a cada ping (ex: de um serviço tipo
 * UptimeRobot) evita que o banco gratuito (Supabase) seja pausado por
 * inatividade.
 */
async function pingDb() {
  if (pool) await pool.query("SELECT 1");
}

module.exports = { db, initDb, pingDb, usingPostgres: Boolean(pool) };
