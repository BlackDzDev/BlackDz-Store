const express = require("express");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/products?game=Roblox&cat=Ferramentas&q=texto — catálogo público, usado pela página de cada categoria.
router.get("/", (req, res) => {
  const { game, cat, q } = req.query;
  let list = db.get("products").value();
  if (game) list = list.filter((p) => p.game === game);
  if (cat) list = list.filter((p) => p.cat === cat);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(needle));
  }
  res.json(list);
});

router.get("/:id", (req, res) => {
  const product = db.get("products").find({ id: req.params.id }).value();
  if (!product) return res.status(404).json({ error: "Produto não encontrado." });
  res.json(product);
});

// A partir daqui, todas as rotas exigem administrador autenticado.
router.use(requireAuth, requireAdmin);

router.post("/", (req, res) => {
  const { name, game, cat, version, price, status, desc } = req.body || {};
  if (!name || !game || !cat || price == null) {
    return res.status(400).json({ error: "name, game, cat e price são obrigatórios." });
  }
  const product = {
    id: uuid(),
    name,
    game,
    cat,
    version: version || "1.0.0",
    price: Number(price),
    status: status || "live",
    desc: desc || "",
    rating: 0,
  };
  db.get("products").push(product).write();
  res.status(201).json(product);
});

router.put("/:id", (req, res) => {
  const product = db.get("products").find({ id: req.params.id });
  if (!product.value()) return res.status(404).json({ error: "Produto não encontrado." });
  const allowed = ["name", "game", "cat", "version", "price", "status", "desc"];
  const updates = {};
  for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
  product.assign(updates).write();
  res.json(product.value());
});

router.delete("/:id", (req, res) => {
  const existed = db.get("products").find({ id: req.params.id }).value();
  if (!existed) return res.status(404).json({ error: "Produto não encontrado." });
  db.get("products").remove({ id: req.params.id }).write();
  res.status(204).end();
});

module.exports = router;
