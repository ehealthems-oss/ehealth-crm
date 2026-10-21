/**
 * Sincroniza respostas da Anamnese (Google Forms) com o CRM (Supabase).
 *
 * Instalação (na planilha "Anamnese e.Health (respostas)"):
 *  1. Extensões → Apps Script → cole este arquivo inteiro.
 *  2. Configurações do projeto (⚙️) → Propriedades do script → adicione:
 *       SUPABASE_URL      = https://cfuvbpdkgqnvpxswhexk.supabase.co
 *       SUPABASE_KEY      = <secret key do Supabase: Project Settings → API Keys>
 *       ANTHROPIC_API_KEY = <chave da API do Claude: console.anthropic.com → API Keys>
 *  3. Selecione a função instalarGatilho e clique em Executar (autorize o acesso).
 *
 * Regras:
 *  - Procura o cliente pelo e-mail; sem e-mail, pelo nome completo (sem acentos/maiúsculas).
 *  - Cliente novo → cria ficha com status "Prospecção".
 *  - Cliente existente → só preenche campos que estão vazios no CRM.
 *  - A anamnese completa (todas as perguntas e respostas) é sempre gravada na ficha.
 *  - Pontos de atenção são gerados por IA; sem chave da IA, usa um resumo simples.
 */

// Prefixos dos títulos das perguntas no formulário
const Q = {
  name: "Nome completo",
  email: "Endereço de e-mail",
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
// Telefone: qualquer pergunta que mencione uma destas palavras
const PHONE_WORDS = ["whatsapp", "telefone", "celular"];
const TIMESTAMP = "Carimbo de data/hora";

const AI_MODEL = "claude-opus-5-5";

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

// Refaz os pontos de atenção com IA para a última resposta, mesmo que já existam
function refazerPontosUltimaResposta() {
  testarUltimaResposta({ forcePoints: true });
}

// Teste manual: processa a última resposta da planilha
function testarUltimaResposta(opts) {
  const sheets = SpreadsheetApp.getActive().getSheets();
  const sheet = sheets.find(s => s.getFormUrl()) || sheets[0];
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  const nameCol = headers.findIndex(h => norm(h).startsWith(norm(Q.name)));
  let n = rows.length - 1;
  while (n > 0 && !String(rows[n][nameCol] || "").trim()) n--;
  if (n === 0) return Logger.log("Nenhuma resposta com nome encontrada.");
  const last = rows[n];
  Logger.log("Aba: " + sheet.getName() + " | linha " + (n + 1));
  const named = {};
  headers.forEach((h, i) => { (named[h] = named[h] || []).push(last[i]); });
  syncResposta(named, opts && opts.forcePoints);
}

// ── Importação dos clientes ativos (respostas antigas) ──
// Nomes como os clientes são chamados no dia a dia; basta que cada palavra apareça no nome completo do formulário.
// Para resolver ambiguidade, escreva o nome completo exatamente como está no formulário.
// A lista NÃO fica no repositório (é público): preencha só na cópia colada no Apps Script.
const CLIENTES_ATIVOS = [];
const STAGE_ATIVO = "Cliente ativo";
// Nome da lista → nome como está no formulário/CRM, quando são diferentes
const APELIDOS = {};
// Nomes da lista que não correspondem a nenhuma anamnese (entram só com o nome)
const FORCAR_SEM_ANAMNESE = [];

// Passo 1: só lê e mostra o que seria feito (não grava nada)
function previaClientesAtivos() {
  planoAtivos().forEach(p => Logger.log(p.status + " | " + p.lista + (p.detalhe ? " → " + p.detalhe : "")));
}

// Passo 2: grava. Pode rodar de novo se parar no meio (quem já foi importado é pulado).
function importarClientesAtivos() {
  const inicio = Date.now();
  preencherAnamnesesFaltando();
  const clients = supa("get", "clients?select=id,name,stage,anamnese");
  let feitos = 0;
  for (const p of planoAtivos()) {
    if (Date.now() - inicio > 4.5 * 60 * 1000) { Logger.log("⏸️ Tempo quase esgotado. Clique em Executar de novo para continuar."); return; }
    if (p.status === "ENCONTRADO") {
      const ja = clients.find(c => c.stage === STAGE_ATIVO && c.anamnese && c.anamnese.submittedAt && norm(c.anamnese.submittedAt) === norm(p.named[TIMESTAMP]));
      if (ja) continue;
      syncResposta(p.named, false, STAGE_ATIVO);
      feitos++;
    } else if (p.status === "SEM ANAMNESE") {
      const existente = clients.find(c => norm(c.name) === norm(p.lista));
      if (existente) {
        if (existente.stage !== STAGE_ATIVO) supa("patch", "clients?id=eq." + encodeURIComponent(existente.id), { stage: STAGE_ATIVO });
      } else {
        supa("post", "clients", { name: p.lista.trim(), stage: STAGE_ATIVO });
        clients.push({ name: p.lista, stage: STAGE_ATIVO });
      }
      feitos++;
    } else {
      Logger.log("⚠️ Pulado (" + p.status + "): " + p.lista + " → " + p.detalhe);
    }
  }
  Logger.log("✅ Concluído. Processados nesta rodada: " + feitos);
}

// Grava a anamnese completa de quem já está no CRM mas chegou com a versão antiga do script (anamnese vazia)
function preencherAnamnesesFaltando() {
  const clients = supa("get", "clients?select=id,name,email,anamnese");
  const vazios = clients.filter(c => !((c.anamnese && c.anamnese.answers) || []).length);
  if (!vazios.length) return;
  const sheets = SpreadsheetApp.getActive().getSheets();
  const sheet = sheets.find(s => s.getFormUrl()) || sheets[0];
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  const nameCol = headers.findIndex(h => norm(h).startsWith(norm(Q.name)));
  const emailCol = headers.findIndex(h => norm(h).startsWith(norm(Q.email)));
  vazios.forEach(c => {
    // Resposta mais recente do mesmo e-mail; senão, do mesmo nome
    const r = rows.slice(1).reverse().find(r =>
      (c.email && emailCol >= 0 && String(r[emailCol]).trim().toLowerCase() === c.email.trim().toLowerCase()) ||
      norm(r[nameCol]) === norm(c.name));
    if (!r) return Logger.log("Sem anamnese no formulário: " + c.name);
    const named = {};
    headers.forEach((h, i) => { (named[h] = named[h] || []).push(r[i]); });
    syncResposta(named);
  });
}

function planoAtivos() {
  const sheets = SpreadsheetApp.getActive().getSheets();
  const sheet = sheets.find(s => s.getFormUrl()) || sheets[0];
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  const nameCol = headers.findIndex(h => norm(h).startsWith(norm(Q.name)));
  // Uma linha por pessoa: a resposta mais recente
  const porNome = {};
  rows.slice(1).forEach(r => { const n = String(r[nameCol] || "").trim(); if (n) porNome[norm(n)] = r; });
  const nomes = Object.keys(porNome);

  return CLIENTES_ATIVOS.map(original => {
    const lista = APELIDOS[original] || original;
    if (FORCAR_SEM_ANAMNESE.some(n => norm(n) === norm(lista))) return { lista, status: "SEM ANAMNESE", detalhe: "será criado só com o nome" };
    const alvo = norm(lista).split(" ");
    const exato = nomes.filter(n => n === norm(lista));
    const achados = exato.length ? exato : nomes.filter(n => alvo.every(w => n.split(" ").includes(w)));
    if (achados.length === 1) {
      const r = porNome[achados[0]];
      const named = {};
      headers.forEach((h, i) => { (named[h] = named[h] || []).push(r[i]); });
      return { lista, status: "ENCONTRADO", detalhe: r[nameCol] + " (" + r[headers.indexOf(TIMESTAMP)] + ")", named };
    }
    if (achados.length > 1) return { lista, status: "AMBÍGUO", detalhe: achados.map(n => porNome[n][nameCol]).join(" / ") };
    return { lista, status: "SEM ANAMNESE", detalhe: "será criado só com o nome" };
  });
}

function syncResposta(named, forcePoints, stage) {
  const keys = Object.keys(named);
  const valuesOf = match => {
    const vals = [];
    keys.forEach(k => { if (match(norm(k))) vals.push(...[].concat(named[k])); });
    return vals.map(v => String(v || "").trim()).filter(Boolean).join("\n");
  };
  const get = prefix => valuesOf(k => k.startsWith(norm(prefix)));

  const name = get(Q.name);
  if (!name) return Logger.log("Resposta sem nome — ignorada.");
  const email = get(Q.email).toLowerCase();

  // Anamnese completa, na ordem do formulário
  const answers = keys
    .filter(k => k.trim() && norm(k) !== norm(TIMESTAMP))
    .map(k => ({ q: k.trim(), a: [].concat(named[k]).map(v => String(v || "").trim()).filter(Boolean).join("\n") }))
    .filter(x => x.a);
  const anamnese = { submittedAt: get(TIMESTAMP), answers };

  const fromAnamnese = {
    name,
    email,
    phone: valuesOf(k => PHONE_WORDS.some(w => k.includes(w))),
    birthday: toIsoDate(get(Q.birthday)),
    height: get(Q.height),
    weight: get(Q.weight),
    goals: joinLabeled([
      ["Geral", get(Q.goalGeneral)],
      ["Específico", get(Q.goalSpecific)],
    ]),
  };

  const clients = supa("get", "clients?select=*");
  const match =
    (email && clients.find(c => (c.email || "").trim().toLowerCase() === email)) ||
    clients.find(c => norm(c.name) === norm(name));

  // Só chama a IA se o campo de pontos de atenção estiver vazio
  const needsPoints = forcePoints || !match || !String(match.attentionPoints || "").trim();
  if (needsPoints) {
    fromAnamnese.attentionPoints = gerarPontosAtencao(answers) || joinLabeled([
      ["Patologia", get(Q.pathology)],
      ["Articulações", get(Q.joints)],
      ["Medicação", get(Q.medication)],
      ["Histórico familiar", get(Q.family)],
      ["Fumante", get(Q.smoker)],
      ["Álcool", get(Q.alcohol)],
      ["Observações", get(Q.notes)],
    ]);
  }

  if (match) {
    const patch = { anamnese };
    if (stage && match.stage !== stage) patch.stage = stage;
    Object.keys(fromAnamnese).forEach(k => {
      if (fromAnamnese[k] && !String(match[k] || "").trim()) patch[k] = fromAnamnese[k];
    });
    if (forcePoints && fromAnamnese.attentionPoints) patch.attentionPoints = fromAnamnese.attentionPoints;
    const saved = supa("patch", "clients?id=eq." + encodeURIComponent(match.id), patch);
    Logger.log("Atualizado: " + match.id + " | campos: " + Object.keys(patch).join(", ") +
      " | linhas gravadas: " + (saved ? saved.length : 0));
  } else {
    const novo = { ...fromAnamnese, anamnese, stage: stage || "Prospecção" };
    Object.keys(novo).forEach(k => { if (novo[k] === "") delete novo[k]; });
    supa("post", "clients", novo);
    Logger.log("Criado novo cliente (" + novo.stage + "): " + name);
  }
}

// ── IA: pontos de atenção ──

function gerarPontosAtencao(answers) {
  const key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!key) return "";
  const anamneseText = answers.map(x => "P: " + x.q + "\nR: " + x.a).join("\n\n");
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    payload: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      fallbacks: "default",
      system:
        "Você apoia profissionais de educação física de um estúdio de treino com eletroestimulação (EMS). " +
        "A partir da anamnese do cliente, liste os pontos de atenção relevantes para o treino: " +
        "patologias, limitações articulares, medicações, histórico familiar, hábitos (álcool, fumo, sono) " +
        "e qualquer resposta que sugira cuidado ou contraindicação ao EMS. " +
        "Responda em português, em tópicos curtos começando com \"• \", sem introdução nem conclusão. " +
        "Não invente informações que não estejam na anamnese. Se não houver nada relevante, responda apenas " +
        "\"Nenhum ponto de atenção identificado na anamnese.\"",
      messages: [{ role: "user", content: anamneseText }],
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    Logger.log("IA indisponível (" + res.getResponseCode() + "): " + res.getContentText().slice(0, 300));
    return "";
  }
  const data = JSON.parse(res.getContentText());
  if (data.stop_reason === "refusal") {
    Logger.log("IA recusou a resposta; usando resumo simples.");
    return "";
  }
  return (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
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

// Respostas como "Não", "nao.", "Nada" não entram nos resumos
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
