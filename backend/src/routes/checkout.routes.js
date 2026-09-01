const express = require("express");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Mesmo limite/formato aceito pelos comprovantes de ticket de suporte: imagem ou PDF do pagamento.
const MAX_PROOF_CHARS = 8_000_000; // ~6mb reais, cobre foto ou PDF do comprovante

function readProof(body) {
  const proof = body?.proof;
  if (!proof) return undefined;
  const isImage = typeof proof === "string" && proof.startsWith("data:image/");
  const isPdf = typeof proof === "string" && proof.startsWith("data:application/pdf");
  if (!isImage && !isPdf) {
    const err = new Error("Anexo inválido: envie uma imagem ou PDF do comprovante.");
    err.status = 400;
    throw err;
  }
  if (proof.length > MAX_PROOF_CHARS) {
    const err = new Error("Arquivo muito grande. Envie um comprovante menor.");
    err.status = 400;
    throw err;
  }
  return proof;
}

/**
 * Marca um pedido como pago e libera o chat de entrega correspondente.
 * Idempotente: se o pedido já estiver pago, apenas devolve o que já existe.
 */
function finalizePaidOrder(orderId) {
  const orderRef = db.get("orders").find({ id: orderId });
  const order = orderRef.value();
  if (!order) return null;
  if (order.status === "paid") {
    return { order };
  }

  orderRef.assign({ status: "paid", paidAt: new Date().toISOString() }).write();
  if (order.couponCode) {
    const coupon = db.get("coupons").find({ code: order.couponCode });
    if (coupon.value()) coupon.assign({ uses: (coupon.value().uses || 0) + 1 }).write();
  }

  // Libera o chat automaticamente: registra um aviso de sistema no início da conversa.
  db.get("messages")
    .push({
      id: uuid(),
      orderId: order.id,
      type: "text",
      text: "Pagamento confirmado! A partir de agora você pode conversar por aqui com a nossa equipe — é por este chat que enviaremos seu produto.",
      senderId: "system",
      senderRole: "system",
      senderName: "BlackDz Store",
      createdAt: new Date().toISOString(),
    })
    .write();

  return { order: orderRef.value() };
}

/**
 * POST /api/checkout
 * body: { items: [{ productId, qty }], couponCode? }
 *
 * Regra de segurança central: o total NUNCA é calculado a partir de valores enviados pelo
 * cliente. Preços vêm sempre do banco de dados, e o cupom é revalidado aqui de novo.
 *
 * Não há integração automática de pagamento. O pedido nasce como "pending" e só passa
 * para "paid" (liberando o chat de entrega) quando um admin confirmar manualmente via
 * POST /api/checkout/:orderId/confirm, depois de verificar o pagamento por fora
 * (PIX, transferência, etc.).
 */
router.post("/", requireAuth, async (req, res) => {
  const { items, couponCode } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "O carrinho está vazio." });
  }

  const products = db.get("products").value();
  const lineItems = [];
  for (const { productId, qty } of items) {
    const product = products.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ error: `Produto ${productId} não existe.` });
    const quantity = Math.max(1, Number(qty) || 1);
    lineItems.push({ productId: product.id, name: product.name, unitPrice: product.price, qty: quantity });
  }
  const subtotal = lineItems.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

  let discount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const coupon = db.get("coupons").find({ code: String(couponCode).toUpperCase() }).value();
    if (coupon && coupon.active) {
      discount = subtotal * (coupon.percentOff / 100);
      appliedCoupon = coupon.code;
    }
  }

  const total = Number((subtotal - discount).toFixed(2));
  if (total <= 0) {
    return res.status(400).json({ error: "O valor total do pedido deve ser maior que zero." });
  }

  const order = {
    id: uuid(),
    userId: req.user.id,
    items: lineItems,
    subtotal,
    discount,
    total,
    couponCode: appliedCoupon,
    status: "pending", // pending -> paid (confirmação manual do admin) | failed
    createdAt: new Date().toISOString(),
  };
  db.get("orders").push(order).write();

  res.status(201).json({
    order,
    payment: {
      provider: "manual",
      message:
        "Pedido criado. O pagamento será conferido e confirmado manualmente pela nossa equipe; assim que for aprovado, o chat de entrega deste pedido é liberado automaticamente.",
    },
  });
});

/**
 * POST /api/checkout/:orderId/proof
 * body: { proof: "data:image/..." | "data:application/pdf;..." }
 *
 * Cliente anexa o comprovante de pagamento (print do PIX/transferência ou PDF) para
 * agilizar a conferência manual. Isso NÃO libera o pedido sozinho — só guarda o anexo
 * para o admin conferir e confirmar via /confirm.
 */
router.post("/:orderId/proof", requireAuth, (req, res, next) => {
  try {
    const orderRef = db.get("orders").find({ id: req.params.orderId, userId: req.user.id });
    const order = orderRef.value();
    if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
    if (order.status !== "pending") {
      return res.status(400).json({ error: "Este pedido não está mais aguardando pagamento." });
    }
    const proof = readProof(req.body);
    if (!proof) return res.status(400).json({ error: "Envie o comprovante (imagem ou PDF)." });

    orderRef.assign({ paymentProof: proof, proofSentAt: new Date().toISOString() }).write();
    res.json({ order: orderRef.value() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/checkout/:orderId/status
 * O frontend usa isto para checar se o pedido já foi confirmado (manualmente) pelo admin.
 */
router.get("/:orderId/status", requireAuth, (req, res) => {
  const order = db.get("orders").find({ id: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
  res.json({ order });
});

/**
 * POST /api/checkout/:orderId/confirm  (uso administrativo)
 *
 * Único jeito de um pedido virar "paid": o admin confirma na mão depois de verificar
 * o pagamento por fora do sistema. Libera o chat de entrega na hora.
 */
router.post("/:orderId/confirm", requireAuth, requireAdmin, (req, res) => {
  const result = finalizePaidOrder(req.params.orderId);
  if (!result) return res.status(404).json({ error: "Pedido não encontrado." });
  res.json(result);
});

/**
 * POST /api/checkout/:orderId/reject  (uso administrativo)
 *
 * Marca um pedido pendente como "failed" quando o admin verifica que o pagamento
 * não foi feito / não é válido.
 */
router.post("/:orderId/reject", requireAuth, requireAdmin, (req, res) => {
  const orderRef = db.get("orders").find({ id: req.params.orderId });
  const order = orderRef.value();
  if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
  if (order.status === "pending") {
    orderRef.assign({ status: "failed" }).write();
  }
  res.json({ order: orderRef.value() });
});

module.exports = router;
