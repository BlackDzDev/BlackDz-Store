const express = require("express");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

const MAX_IMAGE_CHARS = 7_000_000; // ~5mb de imagem real, folga pra base64 (que engorda ~33%)

function readImage(body) {
  const image = body?.image;
  if (!image) return undefined;
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    const err = new Error("Anexo inválido: envie uma imagem (png/jpg/webp).");
    err.status = 400;
    throw err;
  }
  if (image.length > MAX_IMAGE_CHARS) {
    const err = new Error("Imagem muito grande. Envie um arquivo menor.");
    err.status = 400;
    throw err;
  }
  return image;
}

router.post("/tickets", requireAuth, (req, res, next) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: "subject e message são obrigatórios." });
    const image = readImage(req.body);
    const ticket = {
      id: uuid(),
      userId: req.user.id,
      userEmail: req.user.email,
      subject,
      message,
      image: image || null,
      status: "aberto",
      createdAt: new Date().toISOString(),
    };
    db.get("tickets").push(ticket).write();
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

router.get("/tickets/me", requireAuth, (req, res) => {
  res.json(db.get("tickets").filter({ userId: req.user.id }).orderBy(["createdAt"], ["desc"]).value());
});

router.get("/tickets", requireAuth, requireAdmin, (req, res) => {
  res.json(db.get("tickets").orderBy(["createdAt"], ["desc"]).value());
});

// Endpoint genérico, usado internamente caso seja necessário reabrir um ticket manualmente.
router.put("/tickets/:id/status", requireAuth, requireAdmin, (req, res) => {
  const ticket = db.get("tickets").find({ id: req.params.id });
  if (!ticket.value()) return res.status(404).json({ error: "Ticket não encontrado." });
  ticket.assign({ status: req.body?.status || "aberto" }).write();
  res.json(ticket.value());
});

// Admin responde o ticket. Isso NÃO fecha o ticket — ele passa a "em_andamento"
// e só é finalizado quando o admin chama /finalize explicitamente.
router.put("/tickets/:id/reply", requireAuth, requireAdmin, (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: "message é obrigatório." });
    const image = readImage(req.body);
    const ticket = db.get("tickets").find({ id: req.params.id });
    if (!ticket.value()) return res.status(404).json({ error: "Ticket não encontrado." });
    ticket
      .assign({
        adminReply: message.trim(),
        adminReplyImage: image || null,
        repliedAt: new Date().toISOString(),
        status: "em_andamento",
      })
      .write();
    res.json(ticket.value());
  } catch (err) {
    next(err);
  }
});

router.put("/tickets/:id/finalize", requireAuth, requireAdmin, (req, res) => {
  const ticket = db.get("tickets").find({ id: req.params.id });
  if (!ticket.value()) return res.status(404).json({ error: "Ticket não encontrado." });
  ticket.assign({ status: "finalizado", finalizedAt: new Date().toISOString() }).write();
  res.json(ticket.value());
});

module.exports = router;
