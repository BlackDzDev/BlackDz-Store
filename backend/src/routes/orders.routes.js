const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/orders/me — histórico de compras do cliente autenticado.
router.get("/me", requireAuth, (req, res) => {
  const orders = db.get("orders").filter({ userId: req.user.id }).orderBy(["createdAt"], ["desc"]).value();
  res.json(orders);
});

// GET /api/orders — visão administrativa de todos os pedidos.
router.get("/", requireAuth, requireAdmin, (req, res) => {
  const users = db.get("users").value();
  const orders = db
    .get("orders")
    .orderBy(["createdAt"], ["desc"])
    .value()
    .map((o) => ({ ...o, customerEmail: users.find((u) => u.id === o.userId)?.email || "desconhecido" }));
  res.json(orders);
});

module.exports = router;
