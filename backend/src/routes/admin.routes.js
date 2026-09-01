const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/stats — números do dashboard: faturamento, vendas, clientes, produtos top.
router.get("/stats", (req, res) => {
  const orders = db.get("orders").filter({ status: "paid" }).value();
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const salesCount = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.qty, 0), 0);

  const salesByProduct = {};
  for (const order of orders) {
    for (const item of order.items) {
      salesByProduct[item.productId] = salesByProduct[item.productId] || { name: item.name, qty: 0, revenue: 0 };
      salesByProduct[item.productId].qty += item.qty;
      salesByProduct[item.productId].revenue += item.qty * item.unitPrice;
    }
  }
  const topProducts = Object.values(salesByProduct)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  res.json({
    revenue: Number(revenue.toFixed(2)),
    salesCount,
    activeCustomers: db.get("users").filter({ role: "customer" }).size().value(),
    openTickets: db.get("tickets").filter({ status: "aberto" }).size().value(),
    topProducts,
  });
});

// GET /api/admin/users — lista de clientes para o painel administrativo.
router.get("/users", (req, res) => {
  const users = db
    .get("users")
    .filter({ role: "customer" })
    .value()
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      buys: db.get("orders").filter({ userId: u.id, status: "paid" }).size().value(),
    }));
  res.json(users);
});

module.exports = router;
