const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/products.routes");
const categoryRoutes = require("./routes/categories.routes");
const couponRoutes = require("./routes/coupons.routes");
const checkoutRoutes = require("./routes/checkout.routes");
const orderRoutes = require("./routes/orders.routes");
const reviewRoutes = require("./routes/reviews.routes");
const supportRoutes = require("./routes/support.routes");
const chatRoutes = require("./routes/chat.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

// CSP desativado porque o frontend é um único index.html com <script> inline.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean),
  })
);
// 25mb: cobre anexos de imagem/comprovante, áudios curtos e arquivos (mods, configs) em base64
app.use(express.json({ limit: "25mb" }));
app.use(morgan("tiny"));

// Limite geral de requisições por IP — ajuste conforme o tráfego esperado em produção.
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

const { pingDb } = require("./db");
app.get("/api/health", async (req, res) => {
  try {
    await pingDb();
  } catch (err) {
    console.error("[health] Falha ao consultar o banco:", err.message);
  }
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada." });
  next();
});

// Serve o site (frontend/index.html) direto pelo mesmo servidor/porta da API.
// Assim só existe UM processo pra rodar e UMA URL pra publicar.
const FRONTEND_DIR = path.join(__dirname, "../../frontend");
app.use(express.static(FRONTEND_DIR));
app.get("*", (req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

// Handler de erro genérico — nunca vaza stack trace nem detalhes internos para o cliente.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Erro interno no servidor." });
});

module.exports = app;
