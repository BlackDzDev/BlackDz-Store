const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { v4: uuid } = require("uuid");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Limita tentativas de login/registro para dificultar força bruta e enumeração de contas.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

router.post("/register", authLimiter, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
  }
  const existing = db.get("users").find({ email: email.toLowerCase() }).value();
  if (existing) {
    return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
  }
  const user = {
    id: uuid(),
    name,
    email: email.toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 12),
    role: "customer",
    createdAt: new Date().toISOString(),
  };
  db.get("users").push(user).write();
  return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/login", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios." });

  const user = db.get("users").find({ email: String(email).toLowerCase() }).value();
  // Mensagem genérica de propósito — não revela se foi o e-mail ou a senha que erraram.
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "E-mail ou senha inválidos." });
  }
  return res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
