const express = require("express");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", (req, res) => {
  const { productId } = req.query;
  let list = db.get("reviews").value();
  if (productId) list = list.filter((r) => r.productId === productId);
  res.json(list);
});

// Só quem comprou o produto (possui um pedido pago com ele) pode avaliar — evita reviews falsas.
router.post("/", requireAuth, (req, res) => {
  const { productId, stars, text } = req.body || {};
  if (!productId || !stars) return res.status(400).json({ error: "productId e stars são obrigatórios." });

  const owns = db
    .get("orders")
    .filter({ userId: req.user.id, status: "paid" })
    .some((o) => o.items.some((i) => i.productId === productId))
    .value();
  if (!owns) return res.status(403).json({ error: "Você só pode avaliar produtos que já comprou." });

  const review = {
    id: uuid(),
    productId,
    userId: req.user.id,
    name: req.user.name,
    stars: Math.min(5, Math.max(1, Number(stars))),
    text: text || "",
    createdAt: new Date().toISOString(),
  };
  db.get("reviews").push(review).write();
  res.status(201).json(review);
});

router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  db.get("reviews").remove({ id: req.params.id }).write();
  res.status(204).end();
});

module.exports = router;
