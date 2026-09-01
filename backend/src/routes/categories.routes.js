const express = require("express");
const { db } = require("../db");

const router = express.Router();

// GET /api/categories — lista pública, usada para montar as páginas por categoria no frontend.
router.get("/", (req, res) => {
  const categories = db.get("categories").value();
  const products = db.get("products").value();
  const withCounts = categories.map((c) => ({
    ...c,
    productCount: products.filter((p) => (c.type === "game" ? p.game === c.label : p.cat === c.label)).length,
  }));
  res.json(withCounts);
});

module.exports = router;
