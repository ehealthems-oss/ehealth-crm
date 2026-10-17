/**
 * Sincroniza respostas da Anamnese (Google Forms) com o CRM (Supabase).
 *
 * Instalação (na planilha "Anamnese e.Health (respostas)"):
 *  1. Extensões → Apps Script → cole este arquivo inteiro.
 *  2. Configurações do projeto (⚙️) → Propriedades do script → adicione:
 *       SUPABASE_URL = https://cfuvbpdkgqnvpxswhexk.supabase.co
 *       SUPABASE_KEY = <secret key do Supabase: Project Settings → API Keys>
 *  3. Selecione a função instalarGatilho e clique em Executar (autorize o acesso).
 *
 * Regras:
 *  - Procura o cliente pelo e-mail; sem e-mail, pelo nome completo (sem acentos/maiúsculas).
 *  - Cliente novo → cria ficha com status "Prospecção".
 *  - Cliente existente → só preenche campos que estão vazios no CRM.
 *  - Sempre marca "Anamnese realizada".
 */

// Prefixos dos títulos das perguntas no formulário
const Q = {
  name: "Nome completo",
  email: "Endereço de e-mail",
  phone: ["WhatsApp", "Telefone", "Celular"],
  birthday: "Data de nascimento",
  height: "Qual é a sua altura",
  weight: "Qual é o seu peso",
  goalGeneral: "Qual seu objetivo geral",
  goalSpecific: "Tem algum objetivo específico",
  pathology: "Possui alguma patologia",
  joints: "Possui alguma limitação nas articulações",
  medication: "Faz uso contínuo de alguma medicação",
  family: "Há algum histórico de doenças na sua família",
  smoker: "É fumante",
  alcohol: "Consome bebida alcoólica",
  notes: "Deseja adicionar alguma observação",
};

// Gatilho: roda a cada nova resposta do formulário
function onAnamnese(e) {
  syncResposta(e.namedValues);
}

function instalarGatilho() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onAnamnese")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onAnamnese").forSpreadsheet(ss).onFormSubmit().create();
  Logger.log("Gatilho instalado.");
}

// Teste manual: processa a última resposta da planilha
function testarUltimaResposta() {
  const sheet = SpreadsheetApp.getActive().getSheets()[0];
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  const last = rows[rows.length - 1];
  const named = {};
  headers.forEach((h, i) => { (named[h] = named[h] || []).push(last[i]); });
  syncResposta(named);
}

function syncResposta(named) {
  const get = prefixes => {
    const list = [].concat(prefixes).map(norm);
    const vals = [];
    Object.keys(named).forEach(k => {
      if (list.some(p => norm(k).startsWith(p))) vals.push(...[].concat(named[k]));
    });
    return vals.map(v => String(v || "").trim()).filter(Boolean).join("\n");
  };

  const name = get(Q.name);
  if (!name) return;
  const email = get(Q.email).toLowerCase();

  const fromAnamnese = {
    name,
    email,
    phone: get(Q.phone),
    birthday: toIsoDate(get(Q.birthday)),
    height: get(Q.height),
    weight: get(Q.weight),
    goals: joinLabeled([
      ["Geral", get(Q.goalGeneral)],
      ["Específico", get(Q.goalSpecific)],
    ]),
    attentionPoints: joinLabeled([
      ["Patologia", get(Q.pathology)],
      ["Articulações", get(Q.joints)],
      ["Medicação", get(Q.medication)],
      ["Histórico familiar", get(Q.family)],
      ["Fumante", get(Q.smoker)],
      ["Álcool", get(Q.alcohol)],
      ["Observações", get(Q.notes)],
    ]),
  };

  const clients = supa("get", "clients?select=*");
  const match =
    (email && clients.find(c => (c.email || "").trim().toLowerCase() === email)) ||
    clients.find(c => norm(c.name) === norm(name));

  if (match) {
    const patch = { anamneseDone: true };
    Object.keys(fromAnamnese).forEach(k => {
      if (fromAnamnese[k] && !String(match[k] || "").trim()) patch[k] = fromAnamnese[k];
    });
    supa("patch", "clients?id=eq." + encodeURIComponent(match.id), patch);
    Logger.log("Atualizado: " + match.id);
  } else {
    const novo = { ...fromAnamnese, stage: "Prospecção", anamneseDone: true };
    Object.keys(novo).forEach(k => { if (novo[k] === "") delete novo[k]; });
    supa("post", "clients", novo);
    Logger.log("Criado novo cliente (Prospecção).");
  }
}

// ── Helpers ──

function supa(method, path, body) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("SUPABASE_URL") + "/rest/v1/" + path;
  const key = props.getProperty("SUPABASE_KEY");
  const res = UrlFetchApp.fetch(url, {
    method,
    contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "return=representation" },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error("Supabase " + code + ": " + res.getContentText());
  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Respostas como "Não", "nao.", "Nada" não viram ponto de atenção
function isNegative(v) {
  return /^(nao|n|nada|nenhum|nenhuma|-)\.?$/.test(norm(v));
}

function joinLabeled(pairs) {
  return pairs
    .filter(([, v]) => v && !isNegative(v))
    .map(([label, v]) => label + ": " + v)
    .join("\n");
}

// "23/02/1985" → "1985-02-23"
function toIsoDate(v) {
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : "";
}
