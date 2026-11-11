// WhatsApp da liderança: recebe perguntas pela API oficial da Meta e responde com os dados do CRM.
// Só responde aos números em WHATSAPP_GESTORES; qualquer outro número é ignorado.
//
// Variáveis de ambiente na Vercel:
//   WHATSAPP_TOKEN        token permanente do usuário do sistema (o mesmo do relatório semanal)
//   WHATSAPP_PHONE_ID     identificação do número de telefone na Meta
//   WHATSAPP_APP_SECRET   chave secreta do app (Meta → Configurações do app → Básico)
//   WHATSAPP_VERIFY_TOKEN uma senha qualquer, repetida na configuração do webhook na Meta
//   WHATSAPP_GESTORES     números autorizados, com DDI e DDD, separados por vírgula (ex.: 5511925208217)
//   ANTHROPIC_API_KEY     a mesma chave da análise SPIN
import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { supabase } from "../src/supabase.js";
import { responderPergunta } from "./_assistente.js";

const WA_API = "https://graph.facebook.com/v23.0/";
const LIMITE_WHATSAPP = 4000; // a Meta aceita até 4096 caracteres por mensagem

const digitos = s => String(s || "").replace(/\D/g, "");
export const gestores = () => String(process.env.WHATSAPP_GESTORES || "").split(/[,;\s]+/).map(digitos).filter(Boolean);

// A Meta às vezes manda números do Brasil sem o 9 do celular (55 11 9xxxx-xxxx → 55 11 xxxx-xxxx)
const semNove = n => (n.length === 13 && n.startsWith("55") && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n);
export const autorizado = from => gestores().some(g => semNove(g) === semNove(digitos(from)));

export function assinaturaValida(raw, header, secret) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const recebido = Buffer.from(header);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

async function corpoBruto(req) {
  const partes = [];
  for await (const p of req) partes.push(typeof p === "string" ? Buffer.from(p) : p);
  return Buffer.concat(partes);
}

async function waPost(payload) {
  const r = await fetch(WA_API + process.env.WHATSAPP_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
}

async function enviarTexto(to, texto) {
  for (let i = 0; i < texto.length; i += LIMITE_WHATSAPP)
    await waPost({ to, type: "text", text: { body: texto.slice(i, i + LIMITE_WHATSAPP) } });
}

export async function atender(msg, { carregar, responder, enviar, marcarLida }) {
  if (!autorizado(msg.from)) return { ignorada: true };
  await marcarLida(msg.id).catch(() => {}); // ✓✓ azul + "digitando…" enquanto a resposta é montada
  if (msg.type !== "text" || !msg.text?.body?.trim()) {
    await enviar(msg.from, "Por enquanto só entendo mensagens de texto. Escreva a sua pergunta sobre o CRM.");
    return { respondida: true };
  }
  let resposta;
  try {
    resposta = await responder(msg.text.body.trim(), await carregar());
  } catch (e) {
    console.error("Erro ao responder:", e);
    resposta = "Não consegui consultar o CRM agora. Tente de novo em alguns minutos.";
  }
  await enviar(msg.from, resposta);
  return { respondida: true };
}

const dependencias = {
  carregar: async () => {
    const { data, error } = await supabase.from("clients").select("*");
    if (error) throw new Error("Supabase: " + error.message);
    return data;
  },
  responder: (pergunta, clientes) => responderPergunta(pergunta, clientes),
  enviar: enviarTexto,
  marcarLida: id => waPost({ status: "read", message_id: id, typing_indicator: { type: "text" } }),
};

export default async function handler(req, res) {
  // Verificação do webhook (feita uma vez pela Meta ao salvar a configuração)
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN)
      return res.status(200).send(q["hub.challenge"]);
    return res.status(403).send("Token de verificação inválido");
  }
  if (req.method !== "POST") return res.status(405).send("Método não permitido");

  const raw = await corpoBruto(req);
  if (!assinaturaValida(raw, req.headers["x-hub-signature-256"], process.env.WHATSAPP_APP_SECRET))
    return res.status(401).send("Assinatura inválida");

  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).send("JSON inválido"); }
  const mensagens = (body.entry || []).flatMap(e => (e.changes || []).flatMap(c => c.value?.messages || []));

  // Responde 200 na hora (senão a Meta reenvia a mensagem) e continua o trabalho em segundo plano
  if (mensagens.length) waitUntil(Promise.all(mensagens.map(m => atender(m, dependencias).catch(e => console.error(e)))));
  return res.status(200).send("ok");
}
