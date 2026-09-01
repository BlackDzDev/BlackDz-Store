const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// POST /api/coupons/validate { code } — checagem pública usada no carrinho antes do checkout.
// O desconto real só é aplicado de fato dentro de /api/checkout, nunca confiando em valores vindos do cliente.
router.post("/validate", (req, res) => {
  const code = String(req.body?.code || "").toUpperCase().trim();
  const coupon = db.get("coupons").find({ code }).value();
  if (!coupon || !coupon.active) {
    return res.status(404).json({ valid: false, error: "Cupom inválido ou expirado." });
  }
  res.json({ valid: true, code: coupon.code, percentOff: coupon.percentOff });
});

router.use(requireAuth, requireAdmin);

router.get("/", (req, res) => res.json(db.get("coupons").value()));

router.post("/", (req, res) => {
  const { code, percentOff } = req.body || {};
  if (!code || !percentOff) return res.status(400).json({ error: "code e percentOff são obrigatórios." });
  const upper = String(code).toUpperCase();
  if (db.get("coupons").find({ code: upper }).value()) {
    return res.status(409).json({ error: "Já existe um cupom com esse código." });
  }
  const coupon = { code: upper, percentOff: Number(percentOff), active: true, uses: 0 };
  db.get("coupons").push(coupon).write();
  res.status(201).json(coupon);
});

router.put("/:code/toggle", (req, res) => {
  const coupon = db.get("coupons").find({ code: req.params.code });
  if (!coupon.value()) return res.status(404).json({ error: "Cupom não encontrado." });
  coupon.assign({ active: !coupon.value().active }).write();
  res.json(coupon.value());
});

module.exports = router;
