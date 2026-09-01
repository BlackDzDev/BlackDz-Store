const express = require("express");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Limites generosos o bastante pra fotos, áudios curtos e arquivos (mods, configs, etc.),
// mas sem deixar o banco (JSON) inchar.
const MAX_IMAGE_CHARS = 7_000_000; // ~5mb de imagem real
const MAX_AUDIO_CHARS = 12_000_000; // ~9mb de áudio real (dá pra sobrar de 1min de fala gravada)
const MAX_FILE_CHARS = 20_000_000; // ~15mb de arquivo real (zip, exe, etc.)
const MAX_FILE_NAME_LENGTH = 180;

/**
 * Confere se o usuário pode ver/mandar mensagem neste pedido.
 * Cliente: só o dono do pedido, e só depois que o pagamento foi confirmado ("paid").
 * Admin: sempre pode ver (pra gerenciar), mas só pode ENVIAR depois de "paid" também
 * (o chat é a "entrega": não faz sentido existir antes da confirmação).
 */
function getOrderForAccess(orderId, user) {
  const order = db.get("orders").find({ id: orderId }).value();
  if (!order) return { error: "Pedido não encontrado.", status: 404 };
  const isAdmin = user.role === "admin";
  const isOwner = order.userId === user.id;
  if (!isOwner && !isAdmin) {
    return { error: "Você não tem acesso a este pedido.", status: 403 };
  }
  if (order.status !== "paid" && !isAdmin) {
    return {
      error: "O chat é liberado automaticamente assim que confirmarmos o seu pagamento.",
      status: 403,
    };
  }
  return { order, isAdmin };
}

// GET /api/chat/:orderId — histórico de mensagens do pedido.
router.get("/:orderId", requireAuth, (req, res) => {
  const access = getOrderForAccess(req.params.orderId, req.user);
  if (access.error) return res.status(access.status).json({ error: access.error });
  const messages = db
    .get("messages")
    .filter({ orderId: access.order.id })
    .orderBy(["createdAt"], ["asc"])
    .value();
  res.json({ order: access.order, messages });
});

// POST /api/chat/:orderId — envia mensagem (texto, imagem, áudio ou arquivo).
router.post("/:orderId", requireAuth, (req, res, next) => {
  try {
    const access = getOrderForAccess(req.params.orderId, req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (access.order.status !== "paid") {
      return res
        .status(403)
        .json({ error: "O chat só é liberado depois que o pagamento é confirmado." });
    }

    const { type, text, media, fileName } = req.body || {};
    const payload = {};

    if (type === "text") {
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Mensagem vazia." });
      }
      payload.text = String(text).trim().slice(0, 4000);
    } else if (type === "image") {
      if (typeof media !== "string" || !media.startsWith("data:image/")) {
        return res.status(400).json({ error: "Anexe uma imagem válida (png/jpg/webp)." });
      }
      if (media.length > MAX_IMAGE_CHARS) {
        return res.status(400).json({ error: "Imagem muito grande. Envie um arquivo menor." });
      }
      payload.media = media;
    } else if (type === "audio") {
      if (typeof media !== "string" || !media.startsWith("data:audio/")) {
        return res.status(400).json({ error: "Áudio inválido." });
      }
      if (media.length > MAX_AUDIO_CHARS) {
        return res.status(400).json({ error: "Áudio muito longo. Grave uma mensagem mais curta." });
      }
      payload.media = media;
    } else if (type === "file") {
      // Aceita qualquer tipo de arquivo (zip, exe, rar, pdf, etc.) — é assim que o produto
      // digital é entregue ao cliente quando não faz sentido só colar um link.
      if (typeof media !== "string" || !/^data:[^,]*;base64,/.test(media)) {
        return res.status(400).json({ error: "Anexo inválido." });
      }
      if (media.length > MAX_FILE_CHARS) {
        return res.status(400).json({ error: "Arquivo muito grande. Envie um arquivo menor (máx. ~15MB)." });
      }
      if (!fileName || !String(fileName).trim()) {
        return res.status(400).json({ error: "Arquivo sem nome." });
      }
      payload.media = media;
      payload.fileName = String(fileName).trim().slice(0, MAX_FILE_NAME_LENGTH);
    } else {
      return res.status(400).json({ error: "Tipo de mensagem inválido." });
    }

    const message = {
      id: uuid(),
      orderId: access.order.id,
      type,
      ...payload,
      senderId: req.user.id,
      senderRole: req.user.role === "admin" ? "admin" : "cliente",
      senderName: req.user.name,
      createdAt: new Date().toISOString(),
    };
    db.get("messages").push(message).write();
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat — uso administrativo: lista as conversas ativas (pedidos pagos),
// com a última mensagem de cada uma, pra montar uma "caixa de entrada" no painel admin.
router.get("/", requireAuth, requireAdmin, (req, res) => {
  const users = db.get("users").value();
  const paidOrders = db.get("orders").filter({ status: "paid" }).orderBy(["paidAt"], ["desc"]).value();
  const allMessages = db.get("messages").value();

  const conversations = paidOrders.map((order) => {
    const msgs = allMessages
      .filter((m) => m.orderId === order.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return {
      orderId: order.id,
      customerEmail: users.find((u) => u.id === order.userId)?.email || "desconhecido",
      items: order.items,
      messageCount: msgs.length,
      lastMessage: msgs[msgs.length - 1] || null,
    };
  });

  res.json(conversations);
});

module.exports = router;
