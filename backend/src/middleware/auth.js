const jwt = require("jsonwebtoken");
const { db } = require("../db");

/**
 * Exige um token JWT válido no header Authorization: Bearer <token>.
 * Anexa o usuário autenticado (sem o hash de senha) em req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Não autenticado. Envie um token no header Authorization." });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.get("users").find({ id: payload.sub }).value();
    if (!user) return res.status(401).json({ error: "Usuário do token não existe mais." });
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

/** Exige que o usuário autenticado tenha papel "admin". Use sempre depois de requireAuth. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito ao painel administrativo." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
