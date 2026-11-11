/**
 * Relatório semanal do CRM e.Health, enviado por e-mail para a liderança.
 * Toda sexta às 18h (horário de Brasília), com os 7 dias de sábado a sexta.
 *
 * Instalação (uma vez, logada na conta Google da e.Health):
 *  1. Acesse script.google.com → Novo projeto → cole este arquivo inteiro.
 *  2. Configurações do projeto (⚙️):
 *       - Fuso horário: (GMT-03:00) Horário de Brasília - São Paulo
 *       - Propriedades do script → adicione:
 *           SUPABASE_URL  = https://cfuvbpdkgqnvpxswhexk.supabase.co
 *           SUPABASE_KEY  = a mesma chave usada no script da anamnese
 *           DESTINATARIOS = email1@exemplo.com, email2@exemplo.com
 *  3. Selecione a função instalarGatilho e clique em Executar (autorize o acesso).
 *  4. Para ver como fica, execute testarRelatorio: manda o relatório agora só para você.
 *
 * Para mudar quem recebe, edite DESTINATARIOS. Não precisa reinstalar nada.
 *
 * WhatsApp (opcional, pela API oficial da Meta): o mesmo envio de sexta também manda um resumo
 * com o PDF do relatório anexo. Funciona assim que estas propriedades forem preenchidas:
 *     WHATSAPP_TOKEN         = token permanente do usuário do sistema (Meta Business)
 *     WHATSAPP_PHONE_ID      = "Identificação do número de telefone" (WhatsApp → Configuração da API)
 *     WHATSAPP_DESTINATARIOS = números com DDD, separados por vírgula (ex.: 11999998888, 11988887777)
 *     WHATSAPP_TESTE         = seu número, para o testarWhatsApp
 *  O modelo de mensagem "relatorio_semanal" precisa estar aprovado na Meta (texto no fim deste arquivo).
 *  Se o WhatsApp falhar, o e-mail sai normalmente e o erro chega no e-mail de quem instalou o script.
 *
 * Movimentações do funil e negociações fechadas: o CRM não guarda a data dessas mudanças,
 * então a cada envio o script guarda uma "foto" das etapas e compara com a da semana anterior.
 */

const TZ = "America/Sao_Paulo";
const DIA_ENVIO = ScriptApp.WeekDay.FRIDAY;
const HORA_ENVIO = 18;
const CRM_URL = ""; // opcional: link do CRM para o botão no fim do e-mail

// ─── Funções para executar ───────────────────────────────────────────────────

function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "enviarRelatorioSemanal")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("enviarRelatorioSemanal").timeBased().onWeekDay(DIA_ENVIO).atHour(HORA_ENVIO).create();
  // Foto inicial do funil, para o primeiro relatório já mostrar as movimentações
  salvarFoto(carregarClientes(), hojeSP());
  Logger.log("Gatilho instalado: toda sexta às " + HORA_ENVIO + "h. Destinatários: " + destinatarios().join(", "));
}

// Gatilho semanal: envia para a liderança e guarda a foto do funil para a próxima semana
function enviarRelatorioSemanal() {
  const para = destinatarios();
  if (!para.length) throw new Error("Preencha DESTINATARIOS nas propriedades do script.");
  const clientes = carregarClientes();
  const hoje = hojeSP();
  const r = montarRelatorio(clientes, hoje, lerFoto(), CRM_URL);
  GmailApp.sendEmail(para.join(","), r.assunto, r.texto, { htmlBody: r.html, name: "CRM e.Health" });
  if (prop("WHATSAPP_TOKEN")) {
    try {
      enviarWhatsApp(r, numeros(prop("WHATSAPP_DESTINATARIOS")));
    } catch (e) {
      Logger.log(e.message);
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "Falha no WhatsApp do relatório semanal",
        "O e-mail para a liderança foi enviado, mas o WhatsApp falhou:\n\n" + e.message);
    }
  }
  salvarFoto(clientes, hoje);
}

// Manda o relatório agora só para quem está executando, com o PDF anexo (não mexe na foto do funil)
function testarRelatorio() {
  const eu = Session.getActiveUser().getEmail();
  const r = montarRelatorio(carregarClientes(), hojeSP(), lerFoto(), CRM_URL);
  GmailApp.sendEmail(eu, "[TESTE] " + r.assunto, r.texto, { htmlBody: r.html, name: "CRM e.Health", attachments: [gerarPdf(r)] });
  Logger.log("Teste enviado para " + eu);
}

// Manda o WhatsApp agora só para o número em WHATSAPP_TESTE (não mexe na foto do funil)
function testarWhatsApp() {
  const para = numeros(prop("WHATSAPP_TESTE"));
  if (!para.length) throw new Error("Preencha WHATSAPP_TESTE com o seu número nas propriedades do script.");
  enviarWhatsApp(montarRelatorio(carregarClientes(), hojeSP(), lerFoto(), CRM_URL), para);
  Logger.log("WhatsApp de teste enviado para " + para.join(", "));
}

// ─── Integrações (Google) ────────────────────────────────────────────────────

function destinatarios() {
  return String(PropertiesService.getScriptProperties().getProperty("DESTINATARIOS") || "")
    .split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes("@"));
}

function carregarClientes() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("SUPABASE_KEY");
  const res = UrlFetchApp.fetch(props.getProperty("SUPABASE_URL") + "/rest/v1/clients?select=*", {
    headers: { apikey: key, Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("Supabase " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function hojeSP() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
}

function prop(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || "";
}

// ─── WhatsApp (API oficial da Meta) ──────────────────────────────────────────

const WA_API = "https://graph.facebook.com/v23.0/";
const WA_MODELO = "relatorio_semanal";
const WA_IDIOMA = "pt_BR";

// "11 99999-8888, (11) 98888-7777" → ["5511999998888", "5511988887777"]
function numeros(s) {
  return String(s || "").split(/[,;]+/).map(n => n.replace(/\D/g, "")).filter(n => n.length >= 10)
    .map(n => n.length <= 11 ? "55" + n : n);
}

function gerarPdf(r) {
  const html = `<html><head><meta charset="utf-8"></head><body style="margin:0">${r.html}</body></html>`;
  return Utilities.newBlob(html, "text/html", "relatorio.html").getAs("application/pdf").setName(r.arquivo);
}

function waFetch(path, opcoes) {
  const res = UrlFetchApp.fetch(WA_API + path, Object.assign({ method: "post", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + prop("WHATSAPP_TOKEN") } }, opcoes));
  const body = JSON.parse(res.getContentText() || "{}");
  if (res.getResponseCode() >= 300) throw new Error("WhatsApp " + res.getResponseCode() + ": " + ((body.error && (body.error.error_user_msg || body.error.message)) || res.getContentText()));
  return body;
}

function enviarWhatsApp(r, para) {
  const phoneId = prop("WHATSAPP_PHONE_ID");
  if (!prop("WHATSAPP_TOKEN") || !phoneId) throw new Error("Preencha WHATSAPP_TOKEN e WHATSAPP_PHONE_ID nas propriedades do script.");
  if (!para.length) throw new Error("Nenhum número de WhatsApp válido para enviar.");
  const pdf = gerarPdf(r);
  const media = waFetch(phoneId + "/media", { payload: { messaging_product: "whatsapp", type: "application/pdf", file: pdf } });
  const erros = [];
  para.forEach(n => {
    try {
      waFetch(phoneId + "/messages", { contentType: "application/json", payload: JSON.stringify({
        messaging_product: "whatsapp", to: n, type: "template",
        template: { name: WA_MODELO, language: { code: WA_IDIOMA }, components: [
          { type: "header", parameters: [{ type: "document", document: { id: media.id, filename: r.arquivo } }] },
          { type: "body", parameters: r.whatsapp.map(t => ({ type: "text", text: String(t) })) },
        ] },
      }) });
    } catch (e) { erros.push(n + " → " + e.message); }
  });
  if (erros.length) throw new Error("Não foi possível enviar para:\n" + erros.join("\n"));
}

function lerFoto() {
  const raw = PropertiesService.getScriptProperties().getProperty("FOTO_FUNIL");
  return raw ? JSON.parse(raw) : null;
}

function salvarFoto(clientes, hoje) {
  const foto = { date: hoje, clients: {} };
  clientes.forEach(c => { foto.clients[c.id] = [c.stage || "", (c.commercial || {}).resultado || ""]; });
  PropertiesService.getScriptProperties().setProperty("FOTO_FUNIL", JSON.stringify(foto));
}

// ─── Montagem do relatório (sem dependências do Google) ──────────────────────

const FUNNEL_STAGES = ["Prospecção", "Raio-X feito", "Experimental feita", "Cliente ativo"];
const SIDE_STAGES = ["Pausado", "Inativo"];
const COR = { navy: "#0C1B33", gold: "#c9a96e", cream: "#F5F0E8", verde: "#2d7a4f", laranja: "#b05e1a", vermelho: "#c0392b", cinza: "#888888" };

function montarRelatorio(clientes, hoje, fotoAnterior, crmUrl) {
  const fim = hoje, ini = addDias(hoje, -6);
  const iniAnt = addDias(ini, -7), fimAnt = addDias(ini, -1);
  const nome = c => primeiroENome(c.name);

  // ── Aulas ──
  const aulasDe = (a, b) => [].concat(...clientes.map(c => (c.lessons || [])
    .filter(l => l.date && l.date >= a && l.date <= b).map(l => Object.assign({ cliente: c }, l))));
  const semana = aulasDe(ini, fim), anterior = aulasDe(iniAnt, fimAnt);
  const contar = ls => ({
    total: ls.length,
    feitas: ls.filter(l => l.status === "Realizada").length,
    reag: ls.filter(l => l.status === "Reagendada").length,
    canc: ls.filter(l => l.status === "Cancelada").length,
  });
  const a = contar(semana), ant = contar(anterior);
  const feitas = semana.filter(l => l.status === "Realizada");
  const medias = [["presenca", "Presença/atenção"], ["motivacao", "Motivação"], ["troca", "Troca"], ["dorChegada", "Dor ao chegar"], ["dor", "Dor na sessão"]]
    .map(([k, label]) => [label, media(feitas, k)]).filter(([, v]) => v !== null);

  const porProf = {};
  semana.forEach(l => {
    const p = (l.cliente.professional || "").trim() || "Sem profissional";
    porProf[p] = porProf[p] || { feitas: 0, reag: 0, canc: 0 };
    if (l.status === "Realizada") porProf[p].feitas++;
    if (l.status === "Reagendada") porProf[p].reag++;
    if (l.status === "Cancelada") porProf[p].canc++;
  });

  const faltas = semana.filter(l => l.status !== "Realizada").sort((x, y) => x.date > y.date ? 1 : -1);

  // ── Funil e comercial ──
  const ativos = clientes.filter(c => c.stage === "Cliente ativo");
  const etapasExtras = [...new Set(clientes.map(c => c.stage).filter(s => s && !FUNNEL_STAGES.includes(s) && !SIDE_STAGES.includes(s)))];
  const etapas = FUNNEL_STAGES.concat(SIDE_STAGES, etapasExtras);
  const contEtapa = st => clientes.filter(c => c.stage === st).length;
  const contEtapaAnt = st => fotoAnterior ? Object.values(fotoAnterior.clients).filter(v => v[0] === st).length : null;

  const novos = clientes.filter(c => c.created_at && dataSP(c.created_at) >= ini && dataSP(c.created_at) <= fim);
  const movs = [], fechou = [], naoFechou = [];
  if (fotoAnterior) clientes.forEach(c => {
    const antes = fotoAnterior.clients[c.id];
    const res = (c.commercial || {}).resultado || "";
    if (antes && antes[0] !== c.stage) movs.push({ c, de: antes[0], para: c.stage });
    if (res !== (antes ? antes[1] : "")) {
      if (res === "Fechou") fechou.push(c);
      if (res === "Não fechou") naoFechou.push(c);
    }
  });
  const experimentais = clientes.filter(c => { const d = ((c.commercial || {}).experimental || {}).date; return d && d >= ini && d <= fim; });
  const emAberto = clientes.filter(c => {
    const com = c.commercial || {};
    return com.resultado === "Em negociação" || (!com.resultado && c.stage === "Experimental feita");
  });

  // ── Alertas de retenção ──
  const alertas = [];
  ativos.forEach(c => {
    const motivos = [];
    const risco = calcRisk(c);
    if (risco.level === "Alto") motivos.push(["alto", `Risco de saída alto (${risco.score}/100)`]);
    const seq = faltasSeguidas(c);
    if (seq >= 2) motivos.push(["alto", `${seq} aulas seguidas canceladas ou reagendadas`]);
    const ult = lessonsNewestFirst(c).find(l => l.status === "Realizada");
    if (ult && diasEntre(ult.date, hoje) > 14) motivos.push(["medio", `Sem aula realizada há ${diasEntre(ult.date, hoje)} dias`]);
    if (!ult && (c.lessons || []).length) motivos.push(["medio", "Nenhuma aula realizada registrada"]);
    const recentes = lessonsNewestFirst(c).filter(l => l.status === "Realizada").slice(0, 3);
    if (recentes.length >= 2 && recentes.filter(l => l.dor > 0 || l.dorChegada > 0).length >= 2)
      motivos.push(["medio", `Dor ou desconforto em ${recentes.filter(l => l.dor > 0 || l.dorChegada > 0).length} das últimas ${recentes.length} aulas`]);
    (c.lessons || []).filter(l => l.date >= ini && l.date <= fim && (l.riscoRetencao || "").trim().length > 3)
      .forEach(l => motivos.push(["alto", `Risco apontado na aula de ${fmtCurta(l.date)}: ${l.riscoRetencao.trim()}`]));
    if (motivos.length) alertas.push({ c, motivos, nivel: motivos.some(m => m[0] === "alto") ? 0 : 1, score: risco.score });
  });
  alertas.sort((x, y) => x.nivel - y.nivel || y.score - x.score);

  // ── HTML ──
  const periodo = `${fmtCurta(ini)} a ${fmtCurta(fim)}`;
  const assunto = `Relatório semanal e.Health · ${periodo}`;
  const taxa = a.total ? Math.round(a.feitas / a.total * 100) : null;

  const h = [];
  h.push(`<div style="background:${COR.cream};padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#333">`);
  h.push(`<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">`);
  h.push(`<div style="background:${COR.navy};padding:22px 24px"><div style="color:${COR.gold};font-size:12px;letter-spacing:2px;text-transform:uppercase">e.Health · CRM</div>`
    + `<div style="color:#fff;font-size:22px;font-weight:700;margin-top:4px">Relatório semanal</div>`
    + `<div style="color:#cfd6e0;font-size:14px;margin-top:2px">${periodo} de ${fim.slice(0, 4)}</div></div>`);
  h.push(`<div style="padding:20px 24px">`);

  // Números principais
  h.push(cards([
    [a.feitas, "aulas realizadas", delta(a.feitas, ant.feitas)],
    [taxa === null ? "—" : taxa + "%", "das aulas agendadas aconteceram", ""],
    [ativos.length, "clientes ativos", fotoAnterior ? delta(ativos.length, contEtapaAnt("Cliente ativo")) : ""],
    [fechou.length, "negociações fechadas", ""],
  ]));

  // Aulas
  h.push(titulo("Aulas da semana"));
  h.push(tabela(["", "Esta semana", "Semana anterior"], [
    ["Realizadas", a.feitas, ant.feitas],
    ["Reagendadas", a.reag, ant.reag],
    ["Canceladas", a.canc, ant.canc],
    ["<b>Total agendado</b>", `<b>${a.total}</b>`, `<b>${ant.total}</b>`],
  ]));
  if (medias.length) h.push(sub("Médias das aulas realizadas (0 a 10)") + tabela(["", "Média"], medias.map(([l, v]) => [l, fmtNum(v)])));
  if (Object.keys(porProf).length) h.push(sub("Por profissional responsável") + tabela(["Profissional", "Realizadas", "Reagendadas", "Canceladas"],
    Object.keys(porProf).sort().map(p => [esc(p), porProf[p].feitas, porProf[p].reag, porProf[p].canc])));
  if (faltas.length) h.push(sub("Cancelamentos e reagendamentos") + tabela(["Data", "Cliente", "Status", "Motivo"],
    faltas.map(l => [fmtCurta(l.date), esc(nome(l.cliente)), l.status === "Cancelada" ? `<span style="color:${COR.vermelho}">Cancelada</span>` : `<span style="color:${COR.laranja}">Reagendada</span>`, esc(l.motivo || "—")])));
  if (!a.total) h.push(vazio("Nenhuma aula registrada no período."));

  // Funil
  h.push(titulo("Funil e comercial"));
  h.push(tabela(["Etapa", "Hoje", fotoAnterior ? `Em ${fmtCurta(fotoAnterior.date)}` : ""],
    etapas.filter(st => contEtapa(st) || (fotoAnterior && contEtapaAnt(st))).map(st => [esc(st), contEtapa(st), fotoAnterior ? contEtapaAnt(st) : ""])));
  if (fotoAnterior) {
    h.push(sub(`Mudanças de etapa desde ${fmtCurta(fotoAnterior.date)}`));
    h.push(movs.length ? lista(movs.map(m => `<b>${esc(nome(m.c))}</b>: ${esc(m.de || "—")} → ${esc(m.para)}`)) : vazio("Nenhuma mudança de etapa."));
  } else {
    h.push(vazio("As mudanças de etapa e as negociações fechadas aparecem a partir do próximo relatório."));
  }
  h.push(sub("Novos cadastros"));
  h.push(novos.length ? lista(novos.map(c => `<b>${esc(nome(c))}</b> · ${esc(c.stage)}${c.location ? " · " + esc(c.location) : ""}`)) : vazio("Nenhum cadastro novo."));
  h.push(sub("Aulas experimentais"));
  h.push(experimentais.length ? tabela(["Data", "Cliente", "Gostou", "Interesse"], experimentais.map(c => {
    const e = c.commercial.experimental;
    return [fmtCurta(e.date), esc(nome(c)), e.gostou != null ? e.gostou + "/10" : "—", e.interesse != null ? e.interesse + "/10" : "—"];
  })) : vazio("Nenhuma aula experimental no período."));
  if (fotoAnterior) {
    h.push(sub("Negociações encerradas"));
    const enc = fechou.map(c => `<span style="color:${COR.verde}">✔ Fechou</span> · <b>${esc(nome(c))}</b>${c.emsFreq ? " · " + esc(c.emsFreq) : ""}`)
      .concat(naoFechou.map(c => `<span style="color:${COR.vermelho}">✘ Não fechou</span> · <b>${esc(nome(c))}</b>${c.commercial.motivo ? " · " + esc(c.commercial.motivo) : ""}`));
    h.push(enc.length ? lista(enc) : vazio("Nenhuma negociação encerrada."));
  }
  h.push(sub(`Em aberto (${emAberto.length})`));
  h.push(emAberto.length ? lista(emAberto.map(c => {
    const an = (c.commercial || {}).analysis;
    return `<b>${esc(nome(c))}</b> · ${esc((c.commercial || {}).resultado || "Experimental feita, sem status de negociação")}${an && an.temperatura ? " · " + esc(an.temperatura) : ""}`;
  })) : vazio("Nenhuma negociação em aberto."));

  // Alertas
  h.push(titulo("Alertas de retenção"));
  h.push(alertas.length ? alertas.map(x => `<div style="border-left:4px solid ${x.nivel === 0 ? COR.vermelho : COR.laranja};background:${x.nivel === 0 ? "#ffeaea" : "#fff8e8"};padding:8px 12px;margin:0 0 8px;border-radius:4px">`
    + `<div style="font-weight:700;color:${COR.navy};font-size:14px">${esc(nome(x.c))}${x.c.professional ? ` <span style="font-weight:400;color:${COR.cinza};font-size:12px">· ${esc(x.c.professional)}</span>` : ""}</div>`
    + x.motivos.map(m => `<div style="font-size:13px;color:${m[0] === "alto" ? COR.vermelho : COR.laranja};margin-top:2px">${esc(m[1])}</div>`).join("")
    + `</div>`).join("") : vazio("Nenhum cliente ativo com alerta."));

  if (crmUrl) h.push(`<div style="text-align:center;margin:24px 0 4px"><a href="${esc(crmUrl)}" style="background:${COR.navy};color:${COR.gold};text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:700;font-size:14px">Abrir o CRM</a></div>`);
  h.push(`</div><div style="padding:12px 24px;background:${COR.cream};font-size:11px;color:${COR.cinza}">Gerado automaticamente pelo CRM e.Health toda sexta às 18h. Período: sábado a sexta. Alertas consideram apenas clientes ativos.</div>`);
  h.push(`</div></div>`);

  const texto = [
    assunto, "",
    `Aulas: ${a.feitas} realizadas, ${a.reag} reagendadas, ${a.canc} canceladas (semana anterior: ${ant.feitas}/${ant.reag}/${ant.canc}).`,
    `Clientes ativos: ${ativos.length}. Novos cadastros: ${novos.length}. Experimentais: ${experimentais.length}. Fechamentos: ${fechou.length}.`,
    `Alertas de retenção: ${alertas.length}.`,
    "", "Abra este e-mail em um leitor com HTML para ver o relatório completo.",
  ].join("\n");

  // Variáveis do modelo de WhatsApp, na ordem {{1}} a {{10}} (a Meta não aceita variável vazia)
  const whatsapp = [periodo, a.feitas, a.reag + a.canc, taxa === null ? "—" : taxa + "%", ativos.length, novos.length,
    experimentais.length, fotoAnterior ? fechou.length : "—", emAberto.length,
    alertas.length ? `${alertas.length} (${alertas.slice(0, 5).map(x => nome(x.c)).join(", ")}${alertas.length > 5 ? "…" : ""})` : "nenhum"].map(String);
  const arquivo = `Relatorio semanal e.Health ${ini} a ${fim}.pdf`;

  return { assunto, html: h.join("\n"), texto, whatsapp, arquivo, dados: { a, ant, ativos: ativos.length, novos: novos.length, movs: movs.length, fechou: fechou.length, alertas: alertas.length } };
}

// ─── Regras iguais às do CRM (src/App.jsx) ───────────────────────────────────

function lessonsNewestFirst(c) {
  return (c.lessons || []).filter(l => l.date)
    .sort((a, b) => a.date !== b.date ? (b.date > a.date ? 1 : -1) : (b.id > a.id ? 1 : -1));
}

function faltasSeguidas(c) {
  const ls = lessonsNewestFirst(c);
  let n = 0;
  while (n < ls.length && (ls[n].status === "Cancelada" || ls[n].status === "Reagendada")) n++;
  return n;
}

function calcRisk(c) {
  const recent = lessonsNewestFirst(c).slice(0, 8);
  if (!recent.length) return { score: 0, level: "sem dados" };
  let pts = recent.filter(l => l.status === "Cancelada").length * 3
    + recent.filter(l => l.status === "Reagendada").length * 1.5;
  recent.forEach(l => {
    if (l.presenca !== null && l.presenca !== undefined && l.presenca < 6) pts += 2;
    if (l.motivacao !== null && l.motivacao !== undefined && l.motivacao < 6) pts += 2;
  });
  if (recent.some(l => l.riscoRetencao && l.riscoRetencao.trim().length > 3)) pts += 4;
  const pct = Math.min(100, Math.round(pts / 70 * 100));
  return { score: pct, level: pct >= 60 ? "Alto" : pct >= 35 ? "Médio" : pct >= 15 ? "Baixo" : "Saudável" };
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function addDias(d, n) {
  const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function diasEntre(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000); }
function dataSP(iso) { return new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10); } // Brasília: UTC-3, sem horário de verão
function fmtCurta(d) { return d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—"; }
function fmtNum(n) { return n.toFixed(1).replace(".0", "").replace(".", ","); }
function media(ls, k) {
  const v = ls.map(l => l[k]).filter(x => x !== null && x !== undefined && x !== "").map(Number).filter(x => !isNaN(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
function primeiroENome(n) {
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const p = String(n || "").trim().split(/\s+/).filter(Boolean).map(cap);
  return p.length > 1 ? p[0] + " " + p[p.length - 1] : (p[0] || "—");
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function delta(n, ant) {
  if (ant === null || ant === undefined || n === ant) return ant === null || ant === undefined ? "" : "igual à semana anterior";
  return (n > ant ? "▲ " : "▼ ") + Math.abs(n - ant) + " vs. semana anterior";
}

function titulo(t) { return `<div style="font-size:17px;font-weight:700;color:${COR.navy};margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid ${COR.gold}">${t}</div>`; }
function sub(t) { return `<div style="font-size:12px;font-weight:700;color:${COR.cinza};text-transform:uppercase;letter-spacing:.5px;margin:16px 0 6px">${t}</div>`; }
function vazio(t) { return `<div style="font-size:13px;color:#aaa;font-style:italic;margin:4px 0 8px">${t}</div>`; }
function lista(itens) { return `<ul style="margin:0 0 8px;padding-left:18px;font-size:13px;line-height:1.6">${itens.map(i => `<li>${i}</li>`).join("")}</ul>`; }
function tabela(cab, linhas) {
  const th = cab.map((c, i) => `<th style="text-align:${i ? "center" : "left"};font-size:11px;color:${COR.cinza};font-weight:700;padding:6px 8px;border-bottom:1px solid #e8dfc8">${c}</th>`).join("");
  const tr = linhas.map(l => `<tr>${l.map((c, i) => `<td style="text-align:${i ? "center" : "left"};font-size:13px;padding:6px 8px;border-bottom:1px solid #f1ece1">${c}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${th}</tr>${tr}</table>`;
}
function cards(itens) {
  const td = itens.map(([v, l, d]) => `<td style="width:25%;padding:4px;vertical-align:top"><div style="background:${COR.cream};border-radius:10px;padding:12px 8px;text-align:center">`
    + (d ? `<div style="font-size:10px;color:${COR.cinza};margin-top:4px">${d}</div>` : "") + `</div></td>`).join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr>${td}</tr></table>`;
}

/* ─── Modelo de mensagem para cadastrar na Meta ──────────────────────────────
 * WhatsApp Manager → Modelos de mensagem → Criar modelo
 *   Categoria: Utilidade · Nome: relatorio_semanal · Idioma: Português (BR)
 *   Cabeçalho: Documento (use como exemplo o PDF que chega no testarRelatorio)
 *   Corpo:
Segue o relatório semanal do CRM e.Health, de {{1}}.

Aulas: {{2}} realizadas e {{3}} canceladas ou reagendadas ({{4}} das agendadas aconteceram).
Clientes ativos: {{5}}. Novos cadastros: {{6}}.
Aulas experimentais: {{7}}. Negociações fechadas: {{8}}. Em aberto: {{9}}.
Alertas de retenção: {{10}}.

O relatório completo está no PDF anexo.
 *   Rodapé (opcional): CRM e.Health
 */
