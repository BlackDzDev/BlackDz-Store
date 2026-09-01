/**
 * Configura o arquivo .env de forma confiável (sem depender de PowerShell/sed).
 * - Se .env não existir, cria a partir de .env.example.
 * - Sempre garante um JWT_SECRET forte (gera um novo se estiver vazio ou
 *   ainda for o valor de exemplo) — isso conserta sozinho o .env mesmo se
 *   uma configuração anterior tiver falhado.
 * - Se as variáveis de ambiente SETUP_ADMIN_EMAIL / SETUP_ADMIN_PASSWORD
 *   forem passadas (pelo .bat, na primeira vez), define ADMIN_EMAIL e
 *   ADMIN_PASSWORD no .env.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const envPath = path.join(__dirname, "..", ".env");
const examplePath = path.join(__dirname, "..", ".env.example");

let lines;
if (fs.existsSync(envPath)) {
  lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
} else if (fs.existsSync(examplePath)) {
  lines = fs.readFileSync(examplePath, "utf8").split(/\r?\n/);
} else {
  console.error("[ERRO] Não encontrei .env nem .env.example em " + path.join(__dirname, ".."));
  process.exit(1);
}

function getVar(key) {
  const line = lines.find((l) => l.startsWith(key + "="));
  return line ? line.slice(key.length + 1).trim() : "";
}

function setVar(key, value) {
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(key + "=")) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);
}

const currentSecret = getVar("JWT_SECRET");
if (!currentSecret || currentSecret.toLowerCase().includes("troque") || currentSecret.length < 16) {
  setVar("JWT_SECRET", crypto.randomBytes(64).toString("hex"));
  console.log("[OK] Gerado um novo JWT_SECRET seguro.");
}

const envEmail = process.env.SETUP_ADMIN_EMAIL;
const envPassword = process.env.SETUP_ADMIN_PASSWORD;
if (envEmail && envEmail.trim()) setVar("ADMIN_EMAIL", envEmail.trim());
if (envPassword && envPassword.trim()) setVar("ADMIN_PASSWORD", envPassword.trim());

fs.writeFileSync(envPath, lines.filter((l) => l !== undefined).join("\n"));
console.log("[OK] .env configurado em " + envPath);
