import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// ─── Constants ───────────────────────────────────────────────────────────────
// Plano EMS: preenchido por vendas quando o cliente fecha (vazio até lá)
const EMS_FREQ = ["EMS 1x/semana", "EMS 2x/semana", "EMS 3x/semana"];
const EMS_TERMS = ["Trimestral", "Semestral", "Anual"];
const LOCATIONS = ["In Home", "Racquet Club Terral"];
// Fluxo do aluno: Prospecção → Raio-X → Experimental (no studio da Terral) → Ativo ⇄ Pausado → Inativo
const FUNNEL_STAGES = ["Prospecção", "Raio-X feito", "Experimental feita", "Cliente ativo"];
const SIDE_STAGES = ["Pausado", "Inativo"];
const CLIENT_STAGES = [...FUNNEL_STAGES, ...SIDE_STAGES];
const STAGE_COLORS = {
  "Prospecção":         "#c9a96e",
  "Raio-X feito":       "#8e6fc4",
  "Experimental feita": "#2f80b8",
  "Cliente ativo":      "#2d7a4f",
  "Pausado":            "#7f8c8d",
  "Inativo":            "#a04040",
};

// Férias / viagem: c.pauses = [{ id, type, start, returnDate, notes }]
const PAUSE_TYPES = ["Férias", "Viagem", "Outro"];
const EMPTY_PAUSE = { type: "Férias", start: "", returnDate: "", notes: "" };
// Periodização: c.workouts = [{ id, name, start, exercises, active }]
const EMPTY_WORKOUT = { name: "", start: "", exercises: "", active: true };

const gold = "#c9a96e", navy = "#0C1B33", cream = "#F5F0E8";

// 4 tipos fixos de avaliação
const AVAL_TYPES = ["Postural", "Funcional", "Antropométrica", "Integral"];

// Status de aula
const LESSON_STATUS = ["Realizada", "Reagendada", "Cancelada"];
const LESSON_STATUS_COLORS = {
  "Realizada":  { bg: "#e8f8ee", border: "#b0ddc0", text: "#2d7a4f", icon: "✅" },
  "Reagendada": { bg: "#fff8e8", border: "#f0d080", text: "#b05e1a", icon: "🔄" },
  "Cancelada":  { bg: "#ffeaea", border: "#f5c6c6", text: "#c0392b", icon: "❌" },
};

const EMPTY_CLIENT = {
  name: "", phone: "", email: "", birthday: "", stage: "Cliente ativo",
  location: "In Home", emsFreq: "", professional: "", notes: "",
  anamnese: null, // respostas completas do Google Forms: { submittedAt, answers: [{ q, a }] }
  startDate: "", // data de início para LTV
  reportUrl: "", // PDF do relatório
  attentionPoints: "", // pontos de atenção extraídos/editados
  height: "", weight: "", goals: "", // vindos da anamnese
  assessments: [], lessons: [], touchpoints: [], tasks: [], pauses: [], workouts: [],
};

const EMPTY_LESSON = {
  date: "", status: "Realizada", notes: "",
  motivo: "",            // obrigatório quando cancelada; opcional quando reagendada
  // Formulário pós-aula
  presenca: null,        // 0-10
  motivacao: null,       // 0-10
  troca: null,           // 0-10
  riscoRetencao: "",     // texto livre
  dormiu: "",            // Sim / Não / Parcialmente
  descansado: "",        // Sim / Não / Parcialmente
  dorChegada: null,      // 0-10, dor/desconforto ao chegar
  dorChegadaDescricao: "",
  dor: null,             // 0-10 (null = sem dor)
  dorDescricao: "",      // o que sentiu e o que foi feito
  alimentacao: "",       // texto livre
  musculosTrabalhados: "", // legado: aulas antigas
  treinoNome: "",        // treino da aba Periodização
  treino: "",            // legado: texto livre do treino
  adaptacoes: "",
  observacaoGeral: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const locLabel = l =>
  l === "In Home" ? "🏠 In Home" :
  l === "Racquet Club Terral" ? "🎾 Terral" : l || "—";
const fmtDate = d => d
  ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const fmtDateShort = d => d
  ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";
const today = () => new Date().toISOString().split("T")[0];
const currentMonth = () => { const n = new Date(); return { m: n.getMonth(), y: n.getFullYear() }; };
const isThisMonth = dateStr => {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T12:00:00");
  const { m, y } = currentMonth();
  return d.getMonth() === m && d.getFullYear() === y;
};
const daysUntil = dateStr => {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T12:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / (1000 * 60 * 60 * 24));
};
const nextBirthdayDays = bdStr => {
  if (!bdStr) return null;
  const bd = new Date(bdStr + "T12:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const yr = now.getFullYear();
  let next = new Date(yr, bd.getMonth(), bd.getDate());
  if (next < now) next = new Date(yr + 1, bd.getMonth(), bd.getDate());
  return Math.round((next - now) / (1000 * 60 * 60 * 24));
};
const getAge = bdStr => {
  if (!bdStr) return null;
  const bd = new Date(bdStr + "T12:00:00");
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--;
  return age;
};

// LTV: calcula tempo de cliente a partir da primeira aula ou startDate
// Cadastro incompleto: sem anamnese recebida
const isIncomplete = c => !(c.anamnese?.answers || []).length;
const INCOMPLETE_STYLE = { fontSize: 11, color: "#b05e1a", fontWeight: 700, background: "#fff8e8", border: "1px solid #f0d080", borderRadius: 10, padding: "2px 8px" };

const calcLTV = c => {
  let startStr = c.startDate;
  if (!startStr && (c.lessons || []).length > 0) {
    const dates = (c.lessons || []).map(l => l.date).filter(Boolean).sort();
    startStr = dates[0];
  }
  if (!startStr) return null;
  const start = new Date(startStr + "T12:00:00");
  const now = new Date();
  const totalDays = Math.round((now - start) / (1000 * 60 * 60 * 24));
  if (totalDays < 0) return null;
  const months = Math.floor(totalDays / 30);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years > 0) return `${years}a ${remMonths}m`;
  if (months > 0) return `${months} mês${months > 1 ? "es" : ""}`;
  return `${totalDays} dia${totalDays !== 1 ? "s" : ""}`;
};

// Termômetro de risco baseado em: faltas/cancelamentos, reagendamentos, notas baixas
const calcRisk = c => {
  const lessons = c.lessons || [];
  const recent = lessons
    .filter(l => l.date)
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .slice(0, 8); // últimas 8 aulas

  if (recent.length === 0) return { score: 0, level: "sem dados", color: "#aaa" };

  let riskPoints = 0;

  // Faltas/cancelamentos (peso 3 cada)
  const cancels = recent.filter(l => l.status === "Cancelada").length;
  riskPoints += cancels * 3;

  // Reagendamentos (peso 1.5 cada)
  const rescheds = recent.filter(l => l.status === "Reagendada").length;
  riskPoints += rescheds * 1.5;

  // Notas de presença/motivação baixas (< 6 = peso 2 cada)
  recent.forEach(l => {
    if (l.presenca !== null && l.presenca !== undefined && l.presenca < 6) riskPoints += 2;
    if (l.motivacao !== null && l.motivacao !== undefined && l.motivacao < 6) riskPoints += 2;
  });

  // Flag manual de risco (peso 4)
  const hasRiskFlag = recent.some(l => l.riscoRetencao && l.riscoRetencao.trim().length > 3);
  if (hasRiskFlag) riskPoints += 4;

  // Normalizar para 0-100 (máximo teórico ~8*3 + 8*1.5 + 8*4 + 4 = 68)
  const maxPoints = 70;
  const pct = Math.min(100, Math.round((riskPoints / maxPoints) * 100));

  if (pct >= 60) return { score: pct, level: "Alto", color: "#c0392b" };
  if (pct >= 35) return { score: pct, level: "Médio", color: "#b05e1a" };
  if (pct >= 15) return { score: pct, level: "Baixo", color: "#e6b800" };
  return { score: pct, level: "Saudável", color: "#2d7a4f" };
};

// Relatórios: as 4 avaliações compõem um único relatório (1 PDF), refeito a cada 3 meses.
// Cada item de c.assessments é um relatório: { id, date, professional, checks: { Postural: true, ... }, reportUrl, notes }
const REPORT_MONTHS = 3;
const reportDone = r => AVAL_TYPES.every(t => r.checks?.[t]);
const sortedReports = c => [...(c.assessments || [])].sort((a, b) => b.date > a.date ? 1 : -1);

const reportStatus = c => {
  const last = sortedReports(c).find(reportDone);
  if (!last) return { lastDate: null, nextDate: null, daysLeft: null };
  const next = new Date(last.date + "T12:00:00");
  next.setMonth(next.getMonth() + REPORT_MONTHS);
  const nextStr = next.toISOString().split("T")[0];
  return { lastDate: last.date, nextDate: nextStr, daysLeft: daysUntil(nextStr) };
};

const nextAvalAlert = c => {
  const s = reportStatus(c);
  return s.daysLeft !== null && s.daysLeft <= 14 ? s : null;
};

// Alerta da gestão: as últimas N aulas registradas foram canceladas ou reagendadas
const MISSED_IN_ROW = 2;
const isMissed = l => l.status === "Cancelada" || l.status === "Reagendada";
const lessonsNewestFirst = c => [...(c.lessons || [])].filter(l => l.date)
  .sort((a, b) => a.date !== b.date ? (b.date > a.date ? 1 : -1) : (b.id > a.id ? 1 : -1));
const missedStreak = c => {
  const ls = lessonsNewestFirst(c);
  let n = 0;
  while (n < ls.length && isMissed(ls[n])) n++;
  return n >= MISSED_IN_ROW ? ls.slice(0, n) : null;
};

// Pausa em andamento (começou e ainda não chegou a data de retorno; sem retorno = indefinida)
const activePause = c => (c.pauses || []).find(p => p.start && p.start <= today() && (!p.returnDate || p.returnDate > today())) || null;
// Etapa que o cliente deveria ter de acordo com as pausas registradas
const stageFromPauses = c => {
  if (c.stage !== "Cliente ativo" && c.stage !== "Pausado") return c.stage;
  return activePause(c) ? "Pausado" : "Cliente ativo";
};

// Pontos de atenção das aulas: últimas aulas realizadas comparadas com as primeiras
const LESSON_WINDOW = 3; // quantas aulas formam o "início" e o "agora"
const LESSON_SCORES = [["presenca", "Presença/atenção"], ["motivacao", "Motivação"], ["troca", "Troca"]];
const hasNum = v => v !== null && v !== undefined && v !== "";
const avgOf = (ls, k) => { const v = ls.map(l => l[k]).filter(hasNum).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const fmtAvg = n => n.toFixed(1).replace(".0", "").replace(".", ",");
const daysSince = d => Math.floor((new Date(today() + "T12:00:00") - new Date(d + "T12:00:00")) / 86400000);

const lessonAttentionPoints = c => {
  const all = lessonsNewestFirst(c);
  const done = all.filter(l => l.status === "Realizada");
  if (!all.length) return [];
  const pts = []; // { level: "alto" | "medio" | "bom", text }
  const last = done[0];
  const recent = done.slice(0, LESSON_WINDOW);
  const first = done.slice(-LESSON_WINDOW).reverse();
  const canCompare = done.length >= LESSON_WINDOW * 2;

  // Última aula
  if (last) {
    const when = `na última aula (${fmtDateShort(last.date)})`;
    if (last.riscoRetencao?.trim()) pts.push({ level: "alto", text: `Risco de retenção apontado ${when}: ${last.riscoRetencao.trim()}` });
    if (last.dorChegada >= 4) pts.push({ level: "alto", text: `Chegou com dor ${last.dorChegada}/10 ${when}${last.dorChegadaDescricao ? `: ${last.dorChegadaDescricao}` : ""}` });
    if (last.dor >= 4) pts.push({ level: "alto", text: `Dor ${last.dor}/10 durante a sessão ${when}${last.dorDescricao ? `: ${last.dorDescricao}` : ""}` });
    const sleep = [last.dormiu === "Não" && "não dormiu bem", last.descansado === "Não" && "não estava recuperado"].filter(Boolean);
    if (sleep.length) pts.push({ level: "medio", text: `${sleep.join(" e ")} ${when}`.replace(/^./, m => m.toUpperCase()) });
    if (last.adaptacoes?.trim()) pts.push({ level: "medio", text: `Treino adaptado ${when}: ${last.adaptacoes.trim()}` });
    LESSON_SCORES.forEach(([k, label]) => { if (hasNum(last[k]) && last[k] < 5) pts.push({ level: "medio", text: `${label} baixa ${when}: ${last[k]}/10` }); });
  }

  // Dor recorrente nas últimas aulas
  const painful = recent.filter(l => l.dor > 0 || l.dorChegada > 0);
  if (recent.length >= 2 && painful.length >= 2) pts.push({ level: "alto", text: `Relatou dor/desconforto em ${painful.length} das últimas ${recent.length} aulas` });

  // Comparação com o início
  if (canCompare) {
    LESSON_SCORES.forEach(([k, label]) => {
      const a = avgOf(first, k), b = avgOf(recent, k);
      if (a === null || b === null) return;
      if (b <= a - 2) pts.push({ level: "alto", text: `${label} caiu: média ${fmtAvg(a)} nas primeiras aulas → ${fmtAvg(b)} nas últimas` });
      else if (b >= a + 2) pts.push({ level: "bom", text: `${label} subiu: média ${fmtAvg(a)} nas primeiras aulas → ${fmtAvg(b)} nas últimas` });
    });
    const pa = avgOf(first, "dor"), pb = avgOf(recent, "dor");
    if (pa !== null && pb !== null && pb >= pa + 2) pts.push({ level: "alto", text: `Dor na sessão aumentou: média ${fmtAvg(pa)} no início → ${fmtAvg(pb)} nas últimas` });
    if (pa !== null && pb !== null && pb <= pa - 2) pts.push({ level: "bom", text: `Dor na sessão diminuiu: média ${fmtAvg(pa)} no início → ${fmtAvg(pb)} nas últimas` });
  }

  // Faltas: últimas aulas agendadas comparadas com as primeiras
  const missedRecent = all.slice(0, 5).filter(isMissed).length, missedFirst = all.slice(-5).filter(isMissed).length;
  if (all.length >= 10 && missedRecent >= missedFirst + 2)
    pts.push({ level: "alto", text: `Mais faltas que no início: ${missedRecent} das últimas 5 aulas canceladas/reagendadas (no início eram ${missedFirst} de 5)` });

  // Tempo sem treinar
  if (c.stage === "Cliente ativo" && last && daysSince(last.date) > 14)
    pts.push({ level: "medio", text: `Sem aula realizada há ${daysSince(last.date)} dias` });

  if (!canCompare && done.length) pts.push({ level: "info", text: `Comparação com o início disponível a partir de ${LESSON_WINDOW * 2} aulas realizadas (hoje: ${done.length})` });
  const order = { alto: 0, medio: 1, bom: 2, info: 3 };
  return pts.sort((a, b) => order[a.level] - order[b.level]);
};

const LESSON_POINT_STYLE = {
  alto:  { icon: "🔴", color: "#c0392b" },
  medio: { icon: "🟠", color: "#b05e1a" },
  bom:   { icon: "🟢", color: "#2d7a4f" },
  info:  { icon: "ℹ️", color: "#888" },
};

function LessonAttention({ client }) {
  const pts = lessonAttentionPoints(client);
  if (!pts.length) return null;
  return (
    <div style={{ background: "#fff8e8", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #f0d080" }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#7a5c00", marginBottom: 6 }}>⚠️ Pontos de atenção das aulas</div>
      {pts.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 13, color: LESSON_POINT_STYLE[p.level].color, lineHeight: 1.5, marginBottom: 3 }}>
          <span style={{ flexShrink: 0 }}>{LESSON_POINT_STYLE[p.level].icon}</span><span>{p.text}</span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>Atualizado automaticamente a cada aula registrada: a última aula e as {LESSON_WINDOW} últimas comparadas com as {LESSON_WINDOW} primeiras.</div>
    </div>
  );
}

const lessonStats = c => {
  const ls = (c.lessons || []).filter(l => isThisMonth(l.date));
  return {
    total: ls.length,
    done: ls.filter(l => l.status === "Realizada").length,
    rescheduled: ls.filter(l => l.status === "Reagendada").length,
    canceled: ls.filter(l => l.status === "Cancelada").length,
  };
};

// ─── UI Components ────────────────────────────────────────────────────────────
function Badge({ stage }) {
  const color = STAGE_COLORS[stage] || "#888";
  return (
    <span style={{ background: color + "22", color, border: "1px solid " + color + "55", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {stage}
    </span>
  );
}

function RiskThermometer({ client, compact }) {
  const { score, level, color } = calcRisk(client);
  const lessons = (client.lessons || []).length;
  if (lessons < 2) {
    if (compact) return <span style={{ fontSize: 11, color: "#aaa" }}>🌡️ —</span>;
    return <div style={{ fontSize: 12, color: "#aaa", fontStyle: "italic" }}>Dados insuficientes para calcular risco.</div>;
  }
  if (compact) {
    return (
      <span style={{ fontSize: 11, color, fontWeight: 700 }}>
        🌡️ {level}
      </span>
    );
  }
  return (
    <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "14px 16px", marginBottom: 14, border: "1px solid #e0d8cc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: navy }}>🌡️ Risco de perda</span>
        <span style={{ fontWeight: 700, fontSize: 16, color }}>{level}</span>
      </div>
      <div style={{ background: "#e0d8cc", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: score + "%", background: color, height: 10, borderRadius: 6, transition: "width .5s" }} />
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
        Baseado nas últimas {Math.min((client.lessons || []).length, 8)} aulas · presença, cancelamentos, motivação
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: cream, borderRadius: 14, width: "100%", maxWidth: wide ? 860 : 560, boxShadow: "0 8px 40px rgba(0,0,0,0.25)", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px 14px", borderBottom: "1px solid #e0d8cc", position: "sticky", top: 0, background: cream, borderRadius: "14px 14px 0 0", zIndex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: navy }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px 28px" }}>{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder = "", disabled = false, half }) {
  return (
    <div style={{ marginBottom: 13, flex: half ? "1" : "unset" }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#2a2218", marginBottom: 4 }}>{label}</label>}
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{ width: "100%", padding: "8px 12px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 14, background: disabled ? "#f0ebe0" : "#fffdf8", color: "#2a2218", boxSizing: "border-box", outline: "none" }} />
    </div>
  );
}

function Sel({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 13 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#2a2218", marginBottom: 4 }}>{label}</label>}
      <select value={value || ""} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "8px 12px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 14, background: "#fffdf8", color: "#2a2218", boxSizing: "border-box", outline: "none" }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TA({ label, value, onChange, rows = 3, placeholder = "" }) {
  return (
    <div style={{ marginBottom: 13 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#2a2218", marginBottom: 4 }}>{label}</label>}
      <textarea value={value || ""} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        style={{ width: "100%", padding: "8px 12px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 14, background: "#fffdf8", color: "#2a2218", boxSizing: "border-box", outline: "none", resize: "vertical" }} />
    </div>
  );
}

// Slider de 0 a 10
function ScoreSlider({ label, value, onChange, hint }) {
  const v = value === null || value === undefined ? "" : value;
  const num = v === "" ? null : Number(v);
  const color = num === null ? "#ccc" : num >= 8 ? "#2d7a4f" : num >= 5 ? "#b05e1a" : "#c0392b";
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#2a2218" }}>{label}</label>
        <span style={{ fontWeight: 700, fontSize: 16, color, minWidth: 28, textAlign: "right" }}>
          {num !== null ? num : "—"}
        </span>
      </div>
      <input type="range" min={0} max={10} step={1} value={v === "" ? 5 : v}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: color }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#aaa", marginTop: 2 }}>
        <span>0</span><span>5</span><span>10</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{hint}</div>}
      {v === "" && (
        <button onClick={() => onChange(5)} style={{ marginTop: 4, fontSize: 11, background: "none", border: "1px solid #c9b89a", borderRadius: 6, padding: "2px 10px", cursor: "pointer", color: "#888" }}>
          Preencher
        </button>
      )}
    </div>
  );
}

// Escolha de sim/não/parcialmente
function YesNo({ label, value, onChange, options = ["Sim", "Não", "Parcialmente"] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#2a2218", marginBottom: 6 }}>{label}</label>
      <div style={{ display: "flex", gap: 6 }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(value === opt ? "" : opt)}
            style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "2px solid", borderColor: value === opt ? navy : "#c9b89a", background: value === opt ? navy + "15" : "#fffdf8", fontWeight: value === opt ? 700 : 400, fontSize: 12, cursor: "pointer", color: value === opt ? navy : "#888" }}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e0d8cc", marginBottom: 18, flexWrap: "wrap", overflowX: "auto" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          style={{ padding: "8px 14px", border: "none", background: "none", cursor: "pointer", fontWeight: active === t.id ? 700 : 400, fontSize: 13, color: active === t.id ? navy : "#888", borderBottom: active === t.id ? "2px solid " + navy : "2px solid transparent", marginBottom: -2, whiteSpace: "nowrap" }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderBottom: "1px solid #e0d8cc", paddingBottom: 8 }}>
      <span style={{ fontWeight: 700, fontSize: 14, color: navy }}>{children}</span>
      {action}
    </div>
  );
}

const pauseLabel = p => !p ? "—" :
  `${p.type === "Viagem" ? "✈️" : p.type === "Férias" ? "🏖️" : "⏸️"} ${p.type} · ${p.returnDate ? "volta " + fmtDateShort(p.returnDate) : "sem data de volta"}`;

function MissedBadge({ streak }) {
  const canceled = streak.filter(l => l.status === "Cancelada").length;
  const resched = streak.length - canceled;
  const parts = [canceled && `${canceled} cancel.`, resched && `${resched} reag.`].filter(Boolean).join(" + ");
  return (
    <span title={streak.map(l => `${fmtDate(l.date)} ${l.status}: ${l.motivo || "sem motivo"}`).join("\n")}
      style={{ fontSize: 11, color: "#fff", fontWeight: 700, background: "#c0392b", borderRadius: 10, padding: "2px 8px", whiteSpace: "nowrap" }}>
      🚨 {streak.length} seguidas ({parts})
    </span>
  );
}

function AlertBadge({ days, label }) {
  if (days === null || days > 30) return null;
  const urgent = days <= 7;
  return (
    <span style={{ background: urgent ? "#ffeaea" : "#fff8e8", color: urgent ? "#c0392b" : "#b05e1a", border: `1px solid ${urgent ? "#f5c6c6" : "#f0d080"}`, borderRadius: 16, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
      {label} {days < 0 ? `vencido há ${-days}d` : days === 0 ? "hoje" : `em ${days}d`}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CRM() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("Todos");
  const [view, setView] = useState("list");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [subModal, setSubModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [detailTab, setDetailTab] = useState("geral");
  const [form, setForm] = useState({ ...EMPTY_CLIENT });
  const [lessonForm, setLessonForm] = useState({ ...EMPTY_LESSON, date: today() });
  const [pauseForm, setPauseForm] = useState({ ...EMPTY_PAUSE });
  const [workoutForm, setWorkoutForm] = useState({ ...EMPTY_WORKOUT });
  const [aiLoading, setAiLoading] = useState(false);
  const [editingLesson, setEditingLesson] = useState(null); // id da aula sendo visualizada
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (data) {
        // Pausas que começaram ou terminaram desde a última visita mudam a etapa automaticamente
        const list = await Promise.all(data.map(normalizeClient).map(async c => {
          const stage = stageFromPauses(c);
          if (stage === c.stage) return c;
          const { data: upd } = await supabase.from("clients").update({ stage }).eq("id", c.id).select();
          return upd ? normalizeClient(upd[0]) : c;
        }));
        setClients(list);
      }
      setLoading(false);
    })();
  }, []);

  const normalizeClient = c => ({
    ...EMPTY_CLIENT, ...c,
    assessments: c.assessments || [],
    lessons: c.lessons || [],
    touchpoints: c.touchpoints || [],
    tasks: c.tasks || [],
    pauses: c.pauses || [],
    workouts: c.workouts || [],
  });

  // ── CRUD ──
  const upsert = async () => {
    const payload = { ...form };
    let data, error;
    if (form.id) {
      ({ data, error } = await supabase.from("clients").update(payload).eq("id", form.id).select());
      if (data) setClients(p => p.map(c => c.id === form.id ? normalizeClient(data[0]) : c));
    } else {
      ({ data, error } = await supabase.from("clients").insert([payload]).select());
      if (data) setClients(p => [normalizeClient(data[0]), ...p]);
    }
    if (!error) setModal(null);
  };

  const del = async id => {
    await supabase.from("clients").delete().eq("id", id);
    setClients(p => p.filter(c => c.id !== id));
    setModal(null);
  };

  const updateSel = async updater => {
    const updated = updater(sel);
    const { data } = await supabase.from("clients").update(updated).eq("id", sel.id).select();
    if (data) { const n = normalizeClient(data[0]); setClients(p => p.map(c => c.id === sel.id ? n : c)); setSel(n); }
  };

  const mv = async (id, stage) => {
    const { data } = await supabase.from("clients").update({ stage }).eq("id", id).select();
    if (data) { const n = normalizeClient(data[0]); setClients(p => p.map(c => c.id === id ? n : c)); if (sel?.id === id) setSel(n); }
  };

  // Botões de etapa: "Pausado" pede o registro de férias/viagem; voltar a "Cliente ativo" encerra a pausa em andamento
  const changeStage = st => {
    if (st === "Pausado") { openPauseForm(); return; }
    if (st === "Cliente ativo" && activePause(sel)) { endPause(activePause(sel).id); return; }
    mv(sel.id, st);
  };
  const openPauseForm = () => { setPauseForm({ ...EMPTY_PAUSE, start: today() }); setSubModal("pause"); };
  const savePause = async () => {
    await updateSel(c => {
      const next = { ...c, pauses: [{ ...pauseForm, id: Date.now().toString() }, ...(c.pauses || [])] };
      return { ...next, stage: stageFromPauses(next) };
    });
    setSubModal(null);
  };
  const endPause = id => updateSel(c => {
    const next = { ...c, pauses: (c.pauses || []).map(p => p.id === id ? { ...p, returnDate: today() } : p) };
    return { ...next, stage: stageFromPauses(next) };
  });

  const ff = k => v => setForm(f => ({ ...f, [k]: v }));
  const lf = k => v => setLessonForm(f => ({ ...f, [k]: v }));

  // ── Upload de relatório PDF ──
  // reportId: quando vem da aba Avaliações, o PDF também fica anexado a esse relatório
  const handleReportUpload = async (file, reportId) => {
    if (!file || !sel) return;
    setAiLoading(true);
    try {
      const path = `reports/${sel.id}_${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("client-files")
        .upload(path, file, { contentType: "application/pdf", upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("client-files")
        .getPublicUrl(path);

      await updateSel(c => ({
        ...c,
        reportUrl: urlData.publicUrl,
        assessments: reportId ? (c.assessments || []).map(r => r.id === reportId ? { ...r, reportUrl: urlData.publicUrl } : r) : c.assessments,
      }));
    } catch (e) {
      console.error("Upload error:", e);
      alert("Erro ao fazer upload: " + (e.message || "tente novamente"));
    } finally {
      setAiLoading(false);
    }
  };

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    return (!q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q)) &&
      (filterStage === "Todos" || c.stage === filterStage);
  }).sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base" }));

  // Alertas
  const alerts = clients
    .filter(c => c.stage === "Cliente ativo")
    .map(c => ({ c, bd: nextBirthdayDays(c.birthday), avalAlert: nextAvalAlert(c), risk: calcRisk(c), missed: missedStreak(c) }))
    .filter(x => (x.bd !== null && x.bd <= 14) || x.avalAlert !== null || x.risk.level === "Alto" || x.missed)
    .sort((a, b) => (!!b.missed - !!a.missed) || (a.c.name || "").localeCompare(b.c.name || "", "pt-BR", { sensitivity: "base" }));

  const paused = clients.filter(c => c.stage === "Pausado")
    .map(c => ({ c, p: activePause(c) }))
    .sort((a, b) => (a.p?.returnDate || "9999") > (b.p?.returnDate || "9999") ? 1 : -1);

  const stats = {
    total: clients.length,
    highRisk: clients.filter(c => c.stage === "Cliente ativo" && calcRisk(c).level === "Alto").length,
    bdMonth: clients.filter(c => { const d = nextBirthdayDays(c.birthday); return d !== null && d <= 30; }).length,
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", background: cream, color: navy, fontSize: 16 }}>
      Carregando e.Health CRM…
    </div>
  );

  // ── RENDER ──
  return (
    <div style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", background: cream, minHeight: "100vh", color: "#2a2218" }}>

      {/* Header */}
      <div style={{ background: navy, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ color: gold, fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>e.Health</div>
          <div style={{ color: "#aab8c2", fontSize: 11 }}>CRM Técnico</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["list", "☰ Lista"], ["dashboard", "◎ Painel"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", background: view === v ? gold : "transparent", color: view === v ? navy : "#aab8c2", fontWeight: 600, fontSize: 12 }}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm({ ...EMPTY_CLIENT }); setModal("form"); }}
          style={{ background: gold, color: navy, border: "none", borderRadius: 8, padding: "7px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          + Nova Cliente
        </button>
      </div>

      {/* ── DASHBOARD ── */}
      {view === "dashboard" && (
        <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
          {/* Fluxo: quantos alunos em cada etapa (clique abre a lista filtrada) */}
          <div style={{ fontWeight: 700, marginBottom: 8, color: navy }}>🧭 Onde cada aluno está</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 10 }}>
            {CLIENT_STAGES.map((st, i) => (
              <div key={st} onClick={() => { setFilterStage(st); setView("list"); }}
                style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${STAGE_COLORS[st]}`, boxShadow: "0 1px 4px #0001", cursor: "pointer" }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: STAGE_COLORS[st] }}>{clients.filter(c => c.stage === st).length}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{i < FUNNEL_STAGES.length ? `${i + 1}. ` : ""}{st}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { l: "🌡️ Alto risco", v: stats.highRisk, c: "#c0392b" },
              { l: "Total", v: stats.total, c: navy },
              { l: "🎂 /30d", v: stats.bdMonth, c: "#e67e22" },
            ].map(s => (
              <div key={s.l} style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${s.c}`, boxShadow: "0 1px 4px #0001" }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.c }}>{s.v}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {alerts.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: "0 1px 4px #0001", borderTop: "3px solid #e74c3c" }}>
              <div style={{ fontWeight: 700, marginBottom: 10, color: navy }}>🔔 Alertas</div>
              {alerts.map(({ c, bd, avalAlert, risk, missed }) => (
                <div key={c.id} onClick={() => { setSel(c); setDetailTab(missed ? "aulas" : "geral"); setModal("detail"); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "#f8f3ea", marginBottom: 5, cursor: "pointer", border: "1px solid #e8dfc8" }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: navy }}>{c.name}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {missed && <MissedBadge streak={missed} />}
                    {bd !== null && bd <= 14 && <AlertBadge days={bd} label="🎂" />}
                    {avalAlert && <AlertBadge days={avalAlert.daysLeft} label="📄 Relatório" />}
                    {risk.level === "Alto" && <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 700, background: "#ffeaea", border: "1px solid #f5c6c6", borderRadius: 10, padding: "2px 8px" }}>🌡️ Alto risco</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {paused.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: "0 1px 4px #0001", borderTop: `3px solid ${STAGE_COLORS["Pausado"]}` }}>
              <div style={{ fontWeight: 700, marginBottom: 10, color: navy }}>✈️ Férias e viagens</div>
              {paused.map(({ c, p }) => (
                <div key={c.id} onClick={() => { setSel(c); setDetailTab("geral"); setModal("detail"); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#f8f3ea", marginBottom: 4, cursor: "pointer" }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: navy }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: "#555" }}>{pauseLabel(p)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#fff", borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: "0 1px 4px #0001" }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: navy }}>💪 Aulas este mês</div>
            {clients.filter(c => c.stage === "Cliente ativo" && lessonStats(c).total > 0).map(c => {
              const s = lessonStats(c);
              const { color, level } = calcRisk(c);
              return (
                <div key={c.id} onClick={() => { setSel(c); setDetailTab("aulas"); setModal("detail"); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#f8f3ea", marginBottom: 4, cursor: "pointer" }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: navy }}>{c.name}</span>
                  <span style={{ fontSize: 11, color }}>{level}</span>
                  <span style={{ fontSize: 12, color: "#2d7a4f", fontWeight: 600 }}>✅{s.done}</span>
                  {s.rescheduled > 0 && <span style={{ fontSize: 12, color: "#b05e1a", fontWeight: 600 }}>🔄{s.rescheduled}</span>}
                  {s.canceled > 0 && <span style={{ fontSize: 12, color: "#c0392b", fontWeight: 600 }}>❌{s.canceled}</span>}
                </div>
              );
            })}
            {clients.filter(c => c.stage === "Cliente ativo" && lessonStats(c).total > 0).length === 0 && (
              <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "8px 0" }}>Nenhuma aula registrada este mês.</div>
            )}
          </div>

          {/* Termômetro geral */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px #0001" }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: navy }}>🌡️ Termômetro de risco</div>
            {clients.filter(c => c.stage === "Cliente ativo").sort((a, b) => calcRisk(b).score - calcRisk(a).score).map(c => {
              const { score, level, color } = calcRisk(c);
              const ltv = calcLTV(c);
              return (
                <div key={c.id} onClick={() => { setSel(c); setDetailTab("geral"); setModal("detail"); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 6, cursor: "pointer", borderRadius: 8, background: "#f8f3ea" }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: navy }}>{c.name}</span>
                  {ltv && <span style={{ fontSize: 11, color: "#888" }}>⏱️ {ltv}</span>}
                  <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 60, textAlign: "right" }}>{level}</span>
                  <div style={{ width: 80, background: "#e0d8cc", borderRadius: 4, height: 6 }}>
                    <div style={{ width: score + "%", background: color, height: 6, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LIST ── */}
      {view === "list" && (
        <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <input placeholder="Buscar nome ou telefone…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: "8px 14px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 14, background: "#fffdf8", outline: "none" }} />
            <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
              style={{ padding: "8px 14px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 14, background: "#fffdf8", outline: "none" }}>
              <option value="Todos">Todos</option>
              {CLIENT_STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: "#aaa" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
              <div style={{ marginBottom: 14 }}>Nenhuma cliente.</div>
              <button onClick={() => { setForm({ ...EMPTY_CLIENT }); setModal("form"); }}
                style={{ background: gold, color: navy, border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, cursor: "pointer" }}>
                Adicionar primeira cliente
              </button>
            </div>
          ) : filtered.map(c => {
            const s = lessonStats(c);
            const bd = nextBirthdayDays(c.birthday);
            const aa = nextAvalAlert(c);
            const { level, color } = calcRisk(c);
            const ltv = calcLTV(c);
            return (
              <div key={c.id} onClick={() => { setSel(c); setDetailTab("geral"); setModal("detail"); }}
                style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 4px #0001", border: "1px solid #e8dfc8", cursor: "pointer", marginBottom: 7 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: navy, display: "flex", alignItems: "center", justifyContent: "center", color: gold, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                  {(c.name || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: navy }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>
                    {locLabel(c.location)}{c.phone ? " · " + c.phone : ""}
                    {c.emsFreq ? " · " + c.emsFreq : ""}
                    {c.professional ? " · 👤 " + c.professional : ""}
                    {ltv ? " · ⏱️ " + ltv : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {s.done > 0 && <span style={{ fontSize: 11, color: "#2d7a4f", fontWeight: 600 }}>✅{s.done}</span>}
                  {s.canceled > 0 && <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 600 }}>❌{s.canceled}</span>}
                  {bd !== null && bd <= 14 && <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 600 }}>🎂{bd}d</span>}
                  {aa && <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 600 }}>📄{aa.daysLeft < 0 ? "vencido" : aa.daysLeft + "d"}</span>}
                  {(c.lessons || []).length >= 2 && <span style={{ fontSize: 11, color, fontWeight: 700 }}>🌡️{level}</span>}
                  {isIncomplete(c) && <span style={INCOMPLETE_STYLE}>⚠️ Incompleto</span>}
                  {c.stage === "Cliente ativo" && missedStreak(c) && <MissedBadge streak={missedStreak(c)} />}
                  {c.stage === "Pausado" && <span style={{ fontSize: 11, color: "#555" }}>{pauseLabel(activePause(c))}</span>}
                  <Badge stage={c.stage} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL FORM (novo/editar) ── */}
      {modal === "form" && (
        <Modal title={form.id ? "Editar Cliente" : "Nova Cliente"} onClose={() => setModal(null)}>
          <Inp label="Nome completo *" value={form.name} onChange={ff("name")} />
          <div style={{ display: "flex", gap: 10 }}>
            <Inp label="Telefone / WhatsApp" value={form.phone} onChange={ff("phone")} half />
            <Inp label="E-mail" value={form.email} onChange={ff("email")} type="email" half />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Inp label="Data de aniversário" value={form.birthday} onChange={ff("birthday")} type="date" half />
            <Inp label="Profissional responsável" value={form.professional} onChange={ff("professional")} placeholder="Ex: Wagner" half />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Inp label="Data de início (LTV)" value={form.startDate} onChange={ff("startDate")} type="date" half />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Inp label="Altura" value={form.height} onChange={ff("height")} placeholder="Ex: 1,65" half />
            <Inp label="Peso" value={form.weight} onChange={ff("weight")} placeholder="Ex: 60 kg" half />
          </div>
          <TA label="Objetivos" value={form.goals} onChange={ff("goals")} rows={2} />
          {/* "Pausado" só entra pelo registro de férias/viagem, na ficha do cliente */}
          <Sel label="Etapa" value={form.stage} onChange={ff("stage")} options={CLIENT_STAGES.filter(s => s !== "Pausado" || form.stage === "Pausado")} />
          <div style={{ marginBottom: 13 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Local</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LOCATIONS.map(loc => (
                <button key={loc} onClick={() => ff("location")(loc)}
                  style={{ flex: 1, minWidth: 80, padding: "7px 4px", borderRadius: 8, border: "2px solid", borderColor: form.location === loc ? gold : "#c9b89a", background: form.location === loc ? gold + "22" : "#fffdf8", fontWeight: form.location === loc ? 700 : 400, fontSize: 11, cursor: "pointer", color: form.location === loc ? "#7a5c1e" : "#2a2218" }}>
                  {locLabel(loc)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 13 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Plano EMS (preenchido por vendas)</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {EMS_FREQ.flatMap(f => EMS_TERMS.map(t => `${f} · ${t}`)).map(p => (
                <button key={p} onClick={() => ff("emsFreq")(form.emsFreq === p ? "" : p)}
                  style={{ padding: "7px 4px", borderRadius: 8, border: "2px solid", borderColor: form.emsFreq === p ? gold : "#c9b89a", background: form.emsFreq === p ? gold + "22" : "#fffdf8", fontWeight: form.emsFreq === p ? 700 : 400, fontSize: 11, cursor: "pointer", color: form.emsFreq === p ? "#7a5c1e" : "#2a2218" }}>
                  {p.replace("EMS ", "")}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{form.emsFreq && !form.emsFreq.includes(" · ") ? `⚠️ Plano atual: ${form.emsFreq} (sem duração). Escolha a opção correta acima.` : form.emsFreq ?"Clique de novo no plano escolhido para deixar sem plano." : "Sem plano fechado."}</div>
          </div>
          <TA label="Observações gerais" value={form.notes} onChange={ff("notes")} rows={2} />
          <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
            {form.id && <button onClick={() => del(form.id)} style={{ background: "#fee", color: "#c0392b", border: "1px solid #fcc", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontWeight: 600 }}>Excluir</button>}
            <button onClick={() => setModal(null)} style={{ background: "#f0ebe0", color: "#555", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <button onClick={upsert} disabled={!form.name} style={{ background: navy, color: gold, border: "none", borderRadius: 8, padding: "9px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: form.name ? 1 : .5 }}>Salvar</button>
          </div>
        </Modal>
      )}

      {/* ── MODAL DETAIL ── */}
      {modal === "detail" && sel && (
        <Modal title={sel.name} onClose={() => setModal(null)} wide>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Badge stage={sel.stage} />
            <span style={{ background: gold + "22", color: "#7a5c1e", border: "1px solid " + gold + "55", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>{locLabel(sel.location)}</span>
            {sel.emsFreq && <span style={{ background: "#f0ebe0", borderRadius: 20, padding: "2px 10px", fontSize: 12, border: "1px solid #ddd" }}>{sel.emsFreq}</span>}
            {sel.professional && <span style={{ background: "#eef4ff", borderRadius: 20, padding: "2px 10px", fontSize: 12, border: "1px solid #c0d0f0", color: navy }}>👤 {sel.professional}</span>}
            {calcLTV(sel) && <span style={{ background: "#f0ebe0", borderRadius: 20, padding: "2px 10px", fontSize: 12, border: "1px solid #ddd", color: "#555" }}>⏱️ {calcLTV(sel)}</span>}
          </div>

          {/* Alertas */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {isIncomplete(sel) && <span style={INCOMPLETE_STYLE}>⚠️ Cadastro incompleto: sem anamnese</span>}
            {nextBirthdayDays(sel.birthday) !== null && nextBirthdayDays(sel.birthday) <= 14 && <AlertBadge days={nextBirthdayDays(sel.birthday)} label="🎂" />}
            {nextAvalAlert(sel) && <AlertBadge days={nextAvalAlert(sel).daysLeft} label="📄 Relatório" />}
            {missedStreak(sel) && <MissedBadge streak={missedStreak(sel)} />}
          </div>

          {/* Termômetro */}
          <RiskThermometer client={sel} />

          {/* Etapa no fluxo */}
          <div style={{ margin: "0 0 14px", background: "#f8f3ea", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6 }}>ETAPA</div>
            {(() => {
              const btn = st => (
                <button key={st} onClick={() => changeStage(st)}
                  style={{ flex: 1, minWidth: 90, padding: "6px 10px", borderRadius: 20, border: "1px solid", borderColor: sel.stage === st ? STAGE_COLORS[st] : "#ddd", background: sel.stage === st ? STAGE_COLORS[st] + "22" : "#fff", color: sel.stage === st ? STAGE_COLORS[st] : "#888", fontSize: 12, cursor: "pointer", fontWeight: sel.stage === st ? 700 : 400 }}>
                  {st}
                </button>
              );
              return (
                <>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                    {FUNNEL_STAGES.flatMap((st, i) => i ? [<span key={st + "→"} style={{ color: "#c9b89a" }}>→</span>, btn(st)] : [btn(st)])}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{SIDE_STAGES.map(btn)}</div>
                </>
              );
            })()}
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>Raio-X e aula experimental acontecem no studio da Terral. "Pausado" registra férias ou viagem.</div>
          </div>

          <Tabs active={detailTab} onChange={setDetailTab} tabs={[
            { id: "geral", label: "Geral" },
            { id: "anamnese", label: "Anamnese / Relatório" },
            { id: "avaliacoes", label: "Avaliações" },
            { id: "periodizacao", label: `Periodização (${(sel.workouts || []).filter(w => w.active).length})` },
            { id: "aulas", label: `Aulas (${(sel.lessons || []).length})` },
          ]} />

          {/* TAB GERAL */}
          {detailTab === "geral" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 13, marginBottom: 14 }}>
                {sel.phone && <div><span style={{ color: "#888" }}>📱 </span><a href={`https://wa.me/55${sel.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" style={{ color: navy, textDecoration: "none", fontWeight: 600 }}>{sel.phone}</a></div>}
                {sel.email && <div><span style={{ color: "#888" }}>✉️ </span>{sel.email}</div>}
                {sel.height && <div><span style={{ color: "#888" }}>📏 </span>{sel.height}</div>}
                {sel.weight && <div><span style={{ color: "#888" }}>⚖️ </span>{sel.weight}</div>}
                {sel.birthday && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <span style={{ color: "#888" }}>🎂 </span>
                    {new Date(sel.birthday + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
                    {getAge(sel.birthday) !== null && <span style={{ color: "#888", fontSize: 11 }}> ({getAge(sel.birthday)} anos)</span>}
                    {nextBirthdayDays(sel.birthday) !== null && nextBirthdayDays(sel.birthday) <= 30 && <span style={{ color: "#e67e22", fontSize: 11, fontWeight: 600 }}> — em {nextBirthdayDays(sel.birthday)} dias</span>}
                  </div>
                )}
              </div>

              {/* Objetivos */}
              {sel.goals && (
                <div style={{ background: "#eef4ff", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #c0d0f0" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: navy, marginBottom: 6 }}>🎯 Objetivos</div>
                  <div style={{ fontSize: 13, color: "#555", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{sel.goals}</div>
                </div>
              )}

              {/* Pontos de atenção */}
              {sel.attentionPoints && (
                <div style={{ background: "#fff8e8", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #f0d080" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#7a5c00", marginBottom: 6 }}>⚠️ Pontos de atenção da anamnese</div>
                  <div style={{ fontSize: 13, color: "#555", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{sel.attentionPoints}</div>
                </div>
              )}
              <LessonAttention client={sel} />

              {sel.notes && (
                <div style={{ background: "#f8f3ea", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#555", marginBottom: 12 }}>
                  {sel.notes}
                </div>
              )}

              {/* Férias / viagens */}
              <div style={{ background: "#f4f6f6", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #d5dbdb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (sel.pauses || []).length ? 8 : 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: navy }}>✈️ Férias e viagens</span>
                  <button onClick={openPauseForm}
                    style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    + Registrar
                  </button>
                </div>
                {[...(sel.pauses || [])].sort((a, b) => b.start > a.start ? 1 : -1).map(p => {
                  const now = activePause(sel)?.id === p.id;
                  const future = p.start > today();
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #e0e4e4", fontSize: 12 }}>
                      <div style={{ flex: 1 }}>
                        <b style={{ color: navy }}>{p.type}</b> · {fmtDate(p.start)} → {p.returnDate ? fmtDate(p.returnDate) : "sem data de volta"}
                        {now && <span style={{ marginLeft: 6, color: STAGE_COLORS["Pausado"], fontWeight: 700 }}>em andamento</span>}
                        {future && <span style={{ marginLeft: 6, color: "#2f80b8", fontWeight: 700 }}>agendada</span>}
                        {p.notes && <div style={{ color: "#777", marginTop: 2 }}>{p.notes}</div>}
                      </div>
                      {now && (
                        <button onClick={() => endPause(p.id)}
                          style={{ background: "#fff", border: "1px solid #2d7a4f", color: "#2d7a4f", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Voltou hoje
                        </button>
                      )}
                      <button onClick={() => updateSel(c => { const next = { ...c, pauses: (c.pauses || []).filter(x => x.id !== p.id) }; return { ...next, stage: stageFromPauses(next) }; })}
                        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                    </div>
                  );
                })}
              </div>
              {/* Resumo aulas mês */}
              {(() => { const s = lessonStats(sel); if (!s.total) return null; return (
                <div style={{ background: "#f0f9f0", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap", border: "1px solid #c0e4c0" }}>
                  <span style={{ fontWeight: 700, color: navy }}>Aulas este mês:</span>
                  <span style={{ color: "#2d7a4f", fontWeight: 600 }}>✅ {s.done} realizadas</span>
                  {s.rescheduled > 0 && <span style={{ color: "#b05e1a", fontWeight: 600 }}>🔄 {s.rescheduled} reagendadas</span>}
                  {s.canceled > 0 && <span style={{ color: "#c0392b", fontWeight: 600 }}>❌ {s.canceled} canceladas</span>}
                </div>
              ); })()}
              <button onClick={() => { setForm({ ...sel }); setModal("form"); }}
                style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "9px 0", fontWeight: 700, cursor: "pointer" }}>
                Editar cliente
              </button>
            </div>
          )}

          {/* TAB ANAMNESE / RELATÓRIO */}
          {detailTab === "anamnese" && (
            <div>
              {/* Pontos de atenção */}
              <div style={{ background: "#fff8e8", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #f0d080" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: navy, marginBottom: 8 }}>⚠️ Pontos de atenção (IA)</div>
                <textarea value={sel.attentionPoints || ""} onChange={e => updateSel(c => ({ ...c, attentionPoints: e.target.value }))}
                  rows={4} placeholder="Patologias, contraindicações, pontos de atenção identificados na anamnese e relatório…"
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e0c860", borderRadius: 8, fontSize: 13, background: "#fffdf0", color: "#2a2218", boxSizing: "border-box", outline: "none", resize: "vertical" }} />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>Gerado pela IA quando a anamnese chega. O campo é editável.</div>
              </div>

              {/* Relatório PDF */}
              <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #e8dfc8" }}>
                <div style={{ fontWeight: 700, color: navy, marginBottom: 8, fontSize: 13 }}>📄 Relatório de avaliação (PDF)</div>
                {sel.reportUrl ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <a href={sel.reportUrl} target="_blank" rel="noopener"
                      style={{ flex: 1, padding: "8px 14px", background: navy, color: gold, borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", textAlign: "center" }}>
                      Abrir PDF ↗
                    </a>
                    <button onClick={() => { fileInputRef.current?.click(); }}
                      style={{ padding: "8px 14px", background: "#f0ebe0", color: "#555", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                      Substituir
                    </button>
                  </div>
                ) : (
                  <button onClick={() => fileInputRef.current?.click()} disabled={aiLoading}
                    style={{ width: "100%", padding: "14px", border: "2px dashed #c9b89a", borderRadius: 8, background: "#fffdf8", cursor: "pointer", color: "#888", fontSize: 13 }}>
                    {aiLoading ? "⏳ Enviando…" : "📎 Clique para fazer upload do PDF"}
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleReportUpload(f); e.target.value = ""; }} />
              </div>

              {/* Anamnese completa */}
              <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "14px 16px", border: "1px solid #e8dfc8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: navy, fontSize: 13 }}>📋 Anamnese</span>
                  {sel.anamnese?.submittedAt && <span style={{ fontSize: 11, color: "#888" }}>Respondida em {sel.anamnese.submittedAt}</span>}
                </div>
                {!(sel.anamnese?.answers || []).length ? (
                  <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "12px 0" }}>
                    A anamnese aparece aqui automaticamente quando o cliente preenche o formulário.
                  </div>
                ) : sel.anamnese.answers.map((x, i) => (
                  <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid #e8dfc8" : "none", fontSize: 13 }}>
                    <div style={{ color: "#888", fontSize: 12, marginBottom: 2 }}>{x.q}</div>
                    <div style={{ color: "#2a2218", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{x.a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB AVALIAÇÕES */}
          {detailTab === "avaliacoes" && (() => {
            const st = reportStatus(sel);
            const reports = sortedReports(sel);
            const current = reports[0];
            const overdue = st.daysLeft !== null && st.daysLeft < 0;
            const urgent = st.daysLeft !== null && st.daysLeft <= 7;
            const warn = st.daysLeft !== null && st.daysLeft <= 14;
            const updateReport = (id, fn) => updateSel(c => ({ ...c, assessments: (c.assessments || []).map(r => r.id === id ? fn(r) : r) }));
            const startReport = () => updateSel(c => ({ ...c, assessments: [{ id: Date.now().toString(), date: today(), professional: c.professional || "", checks: {}, reportUrl: "", notes: "" }, ...(c.assessments || [])] }));
            return (
            <div>
              {/* Status do relatório (a cada 3 meses) */}
              <div style={{ background: overdue ? "#fff0ee" : urgent ? "#fff8ee" : warn ? "#fffde8" : "#f8f3ea", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: `1px solid ${overdue ? "#f0a0a0" : urgent ? "#f0c080" : warn ? "#e8d860" : "#e0d8cc"}` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: navy, marginBottom: 4 }}>📄 Relatório de avaliação (a cada {REPORT_MONTHS} meses)</div>
                {st.lastDate ? (
                  <>
                    <div style={{ fontSize: 12, color: "#555" }}>Último relatório: <b>{fmtDate(st.lastDate)}</b></div>
                    <div style={{ fontSize: 12, marginTop: 3, color: overdue ? "#c0392b" : urgent ? "#b05e1a" : warn ? "#7a6000" : "#2d7a4f", fontWeight: 600 }}>
                      {overdue ? `⚠️ Vencido há ${Math.abs(st.daysLeft)}d — refazer` :
                        urgent ? `🔶 Refazer em ${st.daysLeft}d` :
                        warn ? `📅 Refazer em ${st.daysLeft}d` :
                        `✅ Próximo: ${fmtDate(st.nextDate)}`}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#aaa", fontStyle: "italic" }}>Nenhum relatório concluído ainda</div>
                )}
              </div>

              {/* Relatório atual */}
              <SectionTitle action={(!current || reportDone(current)) && (
                <button onClick={startReport}
                  style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  + Novo relatório
                </button>
              )}>{current && !reportDone(current) ? "Relatório em andamento" : "Relatório atual"}</SectionTitle>
              {!current ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "16px 0" }}>Clique em "+ Novo relatório" para começar.</div>
              ) : (
                <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "12px 14px", marginBottom: 16, border: "1px solid #e8dfc8" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Inp half label="Data" type="date" value={current.date} onChange={v => updateReport(current.id, r => ({ ...r, date: v }))} />
                    <Inp half label="Profissional" value={current.professional || ""} onChange={v => updateReport(current.id, r => ({ ...r, professional: v }))} placeholder="Nome do profissional" />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#888", margin: "4px 0 6px" }}>AVALIAÇÕES FEITAS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 10 }}>
                    {AVAL_TYPES.map(type => {
                      const done = !!current.checks?.[type];
                      return (
                        <button key={type} onClick={() => updateReport(current.id, r => ({ ...r, checks: { ...(r.checks || {}), [type]: !done } }))}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: "2px solid", borderColor: done ? "#2d7a4f" : "#c9b89a", background: done ? "#e8f8ee" : "#fffdf8", cursor: "pointer", fontWeight: 700, fontSize: 12, color: done ? "#2d7a4f" : "#888", textAlign: "left" }}>
                          {done ? "✅" : "◻️"} {type}
                        </button>
                      );
                    })}
                  </div>
                  {current.reportUrl ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <a href={current.reportUrl} target="_blank" rel="noopener"
                        style={{ flex: 1, padding: "8px 14px", background: navy, color: gold, borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", textAlign: "center" }}>
                        Abrir PDF do relatório ↗
                      </a>
                      <button onClick={() => { fileInputRef.current?.click(); }}
                        style={{ padding: "8px 14px", background: "#f0ebe0", color: "#555", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                        Substituir
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { fileInputRef.current?.click(); }} disabled={aiLoading}
                      style={{ width: "100%", padding: "10px", border: "2px dashed #c9b89a", borderRadius: 8, background: "#fffdf8", cursor: "pointer", color: "#888", fontSize: 12, marginBottom: 10 }}>
                      {aiLoading ? "⏳ Enviando…" : "📎 Anexar PDF do relatório"}
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleReportUpload(f, current.id); e.target.value = ""; }} />
                  <TA label="Observações / resultados" value={current.notes || ""} onChange={v => updateReport(current.id, r => ({ ...r, notes: v }))} rows={3} placeholder="Resultados, medidas, progressos…" />
                  <div style={{ fontSize: 12, fontWeight: 700, color: reportDone(current) ? "#2d7a4f" : "#b05e1a" }}>
                    {reportDone(current) ? "✅ Relatório concluído" : `⏳ Faltam ${AVAL_TYPES.filter(t => !current.checks?.[t]).length} de ${AVAL_TYPES.length} avaliações`}
                  </div>
                </div>
              )}

              <SectionTitle>Relatórios anteriores</SectionTitle>
              {reports.length <= 1 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "16px 0" }}>Nenhum relatório anterior.</div>
              ) : reports.slice(1).map(r => (
                <div key={r.id} style={{ background: "#f8f3ea", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 8, border: "1px solid #e8dfc8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: navy }}>{fmtDate(r.date)}</span>
                    {r.reportUrl && <a href={r.reportUrl} target="_blank" rel="noopener" style={{ fontSize: 12, color: navy, fontWeight: 700 }}>PDF ↗</a>}
                  </div>
                  <div style={{ color: "#888", fontSize: 12 }}>
                    {AVAL_TYPES.map(t => `${r.checks?.[t] ? "✅" : "◻️"} ${t}`).join("  ")}
                  </div>
                  {r.professional && <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>👤 {r.professional}</div>}
                  {r.notes && <div style={{ color: "#555", marginTop: 6, fontSize: 13, borderTop: "1px solid #e0d8cc", paddingTop: 6 }}>{r.notes}</div>}
                </div>
              ))}
            </div>
            );
          })()}

          {/* TAB PERIODIZAÇÃO */}
          {detailTab === "periodizacao" && (
            <div>
              <SectionTitle action={
                <button onClick={() => { setWorkoutForm({ ...EMPTY_WORKOUT, start: today() }); setSubModal("workout"); }}
                  style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  + Novo treino
                </button>
              }>Treinos da periodização</SectionTitle>
              {(sel.workouts || []).length === 0 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "20px 0" }}>Nenhum treino cadastrado. Cadastre aqui os treinos (A, B, C…) para escolher na hora de registrar a aula.</div>
              ) : [...(sel.workouts || [])].sort((a, b) => (b.active - a.active) || (b.start > a.start ? 1 : -1)).map(w => {
                const done = (sel.lessons || []).filter(l => l.status === "Realizada" && l.treinoNome === w.name).sort((a, b) => b.date > a.date ? 1 : -1);
                return (
                  <div key={w.id} style={{ background: w.active ? "#fff" : "#f0f0f0", borderRadius: 10, padding: "10px 14px", marginBottom: 8, border: "1px solid #e8dfc8" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontWeight: 700, color: w.active ? navy : "#999", fontSize: 14 }}>🏋️ {w.name}</span>
                      {!w.active && <span style={{ fontSize: 11, color: "#888", border: "1px solid #ccc", borderRadius: 10, padding: "1px 8px" }}>Encerrado</span>}
                      <button onClick={() => { setWorkoutForm({ ...w }); setSubModal("workout"); }}
                        style={{ background: "none", border: "1px solid #c9b89a", borderRadius: 6, padding: "2px 10px", fontSize: 11, cursor: "pointer", color: "#888" }}>Editar</button>
                    </div>
                    <div style={{ fontSize: 11, color: "#888", margin: "2px 0 6px" }}>
                      {w.start ? `Desde ${fmtDate(w.start)}` : ""}{w.start ? " · " : ""}{done.length} aula{done.length === 1 ? "" : "s"}{done[0] ? ` · última em ${fmtDateShort(done[0].date)}` : ""}
                    </div>
                    {w.exercises && <div style={{ fontSize: 12, color: "#555", whiteSpace: "pre-wrap" }}>{w.exercises}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB AULAS */}
          {detailTab === "aulas" && (
            <div>
              <LessonAttention client={sel} />
              {/* Contador do mês */}
              {(() => { const s = lessonStats(sel); return (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <div style={{ flex: 1, background: "#e8f8ee", borderRadius: 10, padding: "10px 12px", textAlign: "center", border: "1px solid #b0ddc0" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#2d7a4f" }}>{s.done}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>Realizadas</div>
                  </div>
                  <div style={{ flex: 1, background: "#fff8e8", borderRadius: 10, padding: "10px 12px", textAlign: "center", border: "1px solid #f0d080" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#b05e1a" }}>{s.rescheduled}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>Reagendadas</div>
                  </div>
                  <div style={{ flex: 1, background: "#ffeaea", borderRadius: 10, padding: "10px 12px", textAlign: "center", border: "1px solid #f5c6c6" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#c0392b" }}>{s.canceled}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>Canceladas</div>
                  </div>
                </div>
              ); })()}

              <SectionTitle action={
                <button onClick={() => { setLessonForm({ ...EMPTY_LESSON, date: today() }); setSubModal("lesson"); }}
                  style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  + Registrar aula
                </button>
              }>Histórico de aulas</SectionTitle>

              {(sel.lessons || []).length === 0 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "20px 0" }}>Nenhuma aula registrada.</div>
              ) : [...(sel.lessons || [])].sort((a, b) => b.date > a.date ? 1 : -1).map(l => {
                const sc = LESSON_STATUS_COLORS[l.status] || LESSON_STATUS_COLORS["Realizada"];
                const isOpen = editingLesson === l.id;
                return (
                  <div key={l.id} style={{ background: "#fff", borderRadius: 10, marginBottom: 8, border: "1px solid #e8dfc8", overflow: "hidden" }}>
                    <div onClick={() => setEditingLesson(isOpen ? null : l.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}>
                      <span style={{ fontSize: 18 }}>{sc.icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, color: navy, fontSize: 13 }}>{fmtDate(l.date)}</span>
                        <span style={{ marginLeft: 8, fontSize: 11, color: sc.text, fontWeight: 600, background: sc.bg, border: "1px solid " + sc.border, borderRadius: 10, padding: "1px 8px" }}>{l.status}</span>
                        {l.presenca !== null && l.presenca !== undefined && <span style={{ marginLeft: 8, fontSize: 11, color: "#888" }}>👤{l.presenca} | 💪{l.motivacao ?? "—"}</span>}
                        {isMissed(l) && <div style={{ fontSize: 12, color: l.motivo ? "#555" : "#c0392b", marginTop: 2 }}>Motivo: {l.motivo || "não informado"}</div>}
                      </div>
                      <span style={{ color: "#aaa", fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "0 14px 14px", borderTop: "1px solid #f0ebe0" }}>
                        {l.notes && <div style={{ fontSize: 13, color: "#555", background: "#f8f3ea", borderRadius: 6, padding: "8px 10px", marginTop: 10, borderLeft: "3px solid " + gold }}>{l.notes}</div>}
                        {/* Scores */}
                        {(l.presenca !== null || l.motivacao !== null || l.troca !== null) && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 10 }}>
                            {[["Presença/Atenção", l.presenca], ["Motivação", l.motivacao], ["Troca", l.troca]].map(([label, val]) => val !== null && val !== undefined ? (
                              <div key={label} style={{ background: "#f8f3ea", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                                <div style={{ fontSize: 22, fontWeight: 700, color: val >= 8 ? "#2d7a4f" : val >= 5 ? "#b05e1a" : "#c0392b" }}>{val}</div>
                                <div style={{ fontSize: 10, color: "#888" }}>{label}</div>
                              </div>
                            ) : null)}
                          </div>
                        )}
                        {/* Outros campos */}
                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12, color: "#555" }}>
                          {l.dormiu && <div>😴 Dormiu bem: <b>{l.dormiu}</b></div>}
                          {l.descansado && <div>⚡ Descansado: <b>{l.descansado}</b></div>}
                          {l.dorChegada !== null && l.dorChegada !== undefined && <div>🤕 Dor ao chegar: <b>{l.dorChegada}/10</b></div>}
                          {l.dorChegadaDescricao && <div style={{ gridColumn: "1/-1" }}>🤕 O que sentia ao chegar: {l.dorChegadaDescricao}</div>}
                          {l.dor !== null && l.dor !== undefined && <div>🤕 Dor na sessão: <b>{l.dor}/10</b></div>}
                          {l.dorDescricao && <div style={{ gridColumn: "1/-1" }}>🤕 O que sentiu: {l.dorDescricao}</div>}
                          {l.alimentacao && <div style={{ gridColumn: "1/-1" }}>🍎 Alimentação: {l.alimentacao}</div>}
                          {l.treinoNome && <div style={{ gridColumn: "1/-1" }}>🏋️ Treino: <b>{l.treinoNome}</b></div>}
                          {l.treino && <div style={{ gridColumn: "1/-1", whiteSpace: "pre-wrap" }}>🏋️ Treino: {l.treino}</div>}
                          {l.musculosTrabalhados && <div style={{ gridColumn: "1/-1" }}>💪 Músculos: {l.musculosTrabalhados}</div>}
                          {l.adaptacoes && <div style={{ gridColumn: "1/-1" }}>🔧 Mudanças no treino: {l.adaptacoes}</div>}
                          {l.riscoRetencao && <div style={{ gridColumn: "1/-1", color: "#c0392b", fontWeight: 600 }}>⚠️ Risco: {l.riscoRetencao}</div>}
                          {l.observacaoGeral && <div style={{ gridColumn: "1/-1", marginTop: 4, padding: "6px 8px", background: "#f8f3ea", borderRadius: 6 }}>📝 {l.observacaoGeral}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </Modal>
      )}

      {/* ── SUB-MODAL: Registrar aula (formulário completo) ── */}
      {subModal === "lesson" && (
        <Modal title="💪 Registrar aula" onClose={() => setSubModal(null)} wide>
          <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
            <Inp label="Data da aula" value={lessonForm.date} onChange={lf("date")} type="date" half />
          </div>

          {/* Status da aula */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#2a2218", marginBottom: 8 }}>Status da aula</label>
            <div style={{ display: "flex", gap: 8 }}>
              {LESSON_STATUS.map(status => {
                const sc = LESSON_STATUS_COLORS[status];
                return (
                  <button key={status} onClick={() => lf("status")(status)}
                    style={{ flex: 1, padding: "10px 6px", borderRadius: 8, border: "2px solid", borderColor: lessonForm.status === status ? sc.border : "#c9b89a", background: lessonForm.status === status ? sc.bg : "#fffdf8", fontWeight: lessonForm.status === status ? 700 : 400, fontSize: 13, cursor: "pointer", color: lessonForm.status === status ? sc.text : "#888" }}>
                    {sc.icon} {status}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Motivo — obrigatório no cancelamento */}
          {isMissed(lessonForm) && (
            <TA label={lessonForm.status === "Cancelada" ? "Motivo do cancelamento *" : "Motivo do reagendamento"}
              value={lessonForm.motivo} onChange={lf("motivo")} rows={2}
              placeholder="Ex: aluno doente, compromisso de trabalho, viagem, cancelou em cima da hora sem justificar…" />
          )}
          {missedStreak({ lessons: [...(sel?.lessons || []), { ...lessonForm, id: "novo" }] }) && isMissed(lessonForm) && (
            <div style={{ fontSize: 12, color: "#c0392b", background: "#ffeaea", border: "1px solid #f5c6c6", borderRadius: 8, padding: "8px 10px", marginBottom: 13 }}>
              🚨 Esta será mais uma aula cancelada/reagendada em sequência. A gestão vai receber um alerta no Painel.
            </div>
          )}

          {/* Formulário pós-aula — só quando realizada */}
          {lessonForm.status === "Realizada" && (
            <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "16px", marginBottom: 16, border: "1px solid #e8dfc8" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: navy, marginBottom: 14 }}>📊 Avaliação da sessão</div>

              <ScoreSlider label="De 0 a 10, quanto o cliente estava presente/atento na aula?" value={lessonForm.presenca} onChange={lf("presenca")} hint="0 = totalmente distante, 10 = totalmente focado" />
              <ScoreSlider label="De 0 a 10, quanto o aluno estava motivado?" value={lessonForm.motivacao} onChange={lf("motivacao")} hint="0 = desmotivado, 10 = altamente motivado" />
              <ScoreSlider label="De 0 a 10, quanto de troca vocês tiveram?" value={lessonForm.troca} onChange={lf("troca")} hint="0 = sem interação, 10 = excelente troca" />

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                <YesNo label="Dormiu bem?" value={lessonForm.dormiu} onChange={lf("dormiu")} />
                <YesNo label="Está se sentindo descansado/recuperado?" value={lessonForm.descansado} onChange={lf("descansado")} />
              </div>

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                <ScoreSlider label="O cliente chegou com alguma dor/desconforto? (0 = nenhuma)" value={lessonForm.dorChegada} onChange={lf("dorChegada")} hint="0 = sem dor, 10 = dor intensa" />
                {lessonForm.dorChegada > 0 && (
                  <TA label="O que o cliente sentia ao chegar? Onde era a dor?" value={lessonForm.dorChegadaDescricao} onChange={lf("dorChegadaDescricao")} rows={2} placeholder="Ex: chegou com dor lombar depois de passar o dia sentada…" />
                )}
                <ScoreSlider label="Teve alguma dor/desconforto durante a sessão? (0 = nenhuma)" value={lessonForm.dor} onChange={lf("dor")} hint="0 = sem dor, 10 = dor intensa" />
                {lessonForm.dor > 0 && (
                  <TA label="O que o cliente sentiu? Onde foi a dor e o que foi feito?" value={lessonForm.dorDescricao} onChange={lf("dorDescricao")} rows={2} placeholder="Ex: dor no joelho direito no agachamento, trocamos por leg press…" />
                )}
                <TA label="Como está a alimentação e hidratação no dia da sessão?" value={lessonForm.alimentacao} onChange={lf("alimentacao")} rows={2} placeholder="Descreveu, não se alimentou, estava desidratado…" />
              </div>

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                {(sel?.workouts || []).some(w => w.active) ? (
                  <Sel label="Qual treino da periodização foi feito?" value={lessonForm.treinoNome || "—"} onChange={v => lf("treinoNome")(v === "—" ? "" : v)}
                    options={["—", ...(sel.workouts || []).filter(w => w.active).map(w => w.name)]} />
                ) : (
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 13 }}>🏋️ Cadastre os treinos na aba Periodização para escolher aqui qual foi feito.</div>
                )}
                <TA label="Teve alguma mudança no treino? Qual?" value={lessonForm.adaptacoes} onChange={lf("adaptacoes")} rows={2} placeholder="Ex: reduziu carga no quadril por dor, trabalhou mobilidade…" />
              </div>

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                <TA label="⚠️ Há algum risco/ponto de atenção que coloque a retenção do cliente em risco?" value={lessonForm.riscoRetencao} onChange={lf("riscoRetencao")} rows={3} placeholder="Ex: cliente comentou que vai viajar, está insatisfeito com resultados, problemas financeiros…" />
              </div>
            </div>
          )}

          {/* Observação geral (sempre visível) */}
          <TA label="📝 Alguma observação geral?" value={lessonForm.observacaoGeral} onChange={lf("observacaoGeral")} rows={3} placeholder="Ex: comentou que está estressada no trabalho, está com problema na família…" />

          {(() => {
            const needsReason = lessonForm.status === "Cancelada" && !(lessonForm.motivo || "").trim();
            return (
              <button disabled={needsReason} onClick={async () => {
                await updateSel(c => ({ ...c, lessons: [{ ...lessonForm, motivo: isMissed(lessonForm) ? lessonForm.motivo : "", id: Date.now().toString() }, ...(c.lessons || [])] }));
                setSubModal(null);
              }} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: needsReason ? "default" : "pointer", marginTop: 4, opacity: needsReason ? .5 : 1 }}>
                {needsReason ? "Descreva o motivo do cancelamento para salvar" : "Salvar aula"}
              </button>
            );
          })()}
        </Modal>
      )}

      {/* ── SUB-MODAL: Férias / viagem ── */}
      {subModal === "workout" && (
        <Modal title={workoutForm.id ? "🏋️ Editar treino" : "🏋️ Novo treino"} onClose={() => setSubModal(null)}>
          <Inp label="Nome do treino *" value={workoutForm.name} onChange={v => setWorkoutForm(f => ({ ...f, name: v }))} placeholder="Ex: Treino A – Inferiores" />
          <Inp label="Início" value={workoutForm.start} onChange={v => setWorkoutForm(f => ({ ...f, start: v }))} type="date" />
          <TA label="Exercícios" value={workoutForm.exercises} onChange={v => setWorkoutForm(f => ({ ...f, exercises: v }))} rows={6} placeholder="Ex: agachamento 3x12, stiff 3x10, prancha 3x40s…" />
          {workoutForm.id && (
            <YesNo label="Situação" value={workoutForm.active ? "Em uso" : "Encerrado"} onChange={v => v && setWorkoutForm(f => ({ ...f, active: v === "Em uso" }))} options={["Em uso", "Encerrado"]} />
          )}
          {(() => {
            const dup = (sel?.workouts || []).some(w => w.id !== workoutForm.id && w.name.trim().toLowerCase() === workoutForm.name.trim().toLowerCase());
            const invalid = !workoutForm.name.trim() || dup;
            return (
              <button disabled={invalid} onClick={async () => {
                const w = { ...workoutForm, name: workoutForm.name.trim() };
                const old = (sel.workouts || []).find(x => x.id === w.id);
                await updateSel(c => ({
                  ...c,
                  workouts: w.id ? (c.workouts || []).map(x => x.id === w.id ? w : x) : [{ ...w, id: Date.now().toString() }, ...(c.workouts || [])],
                  // renomear o treino mantém o vínculo com as aulas já registradas
                  lessons: old && old.name !== w.name ? (c.lessons || []).map(l => l.treinoNome === old.name ? { ...l, treinoNome: w.name } : l) : c.lessons,
                }));
                setSubModal(null);
              }} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: invalid ? "default" : "pointer", marginTop: 4, opacity: invalid ? .5 : 1 }}>
                {dup ? "Já existe um treino com esse nome" : "Salvar treino"}
              </button>
            );
          })()}
        </Modal>
      )}

      {subModal === "pause" && (
        <Modal title="✈️ Registrar férias / viagem" onClose={() => setSubModal(null)}>
          <YesNo label="Tipo" value={pauseForm.type} onChange={v => setPauseForm(f => ({ ...f, type: v || f.type }))} options={PAUSE_TYPES} />
          <div style={{ display: "flex", gap: 10 }}>
            <Inp label="Saída *" value={pauseForm.start} onChange={v => setPauseForm(f => ({ ...f, start: v }))} type="date" half />
            <Inp label="Volta prevista" value={pauseForm.returnDate} onChange={v => setPauseForm(f => ({ ...f, returnDate: v }))} type="date" half />
          </div>
          <TA label="Observação" value={pauseForm.notes} onChange={v => setPauseForm(f => ({ ...f, notes: v }))} rows={2} placeholder="Ex: viagem a trabalho, vai mandar mensagem quando voltar…" />
          <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
            Durante o período o aluno fica como "Pausado" e volta sozinho para "Cliente ativo" na data de volta. Sem data de volta, fica pausado até alguém clicar em "Voltou hoje".
          </div>
          {(() => {
            const invalid = !pauseForm.start || (pauseForm.returnDate && pauseForm.returnDate <= pauseForm.start);
            return (
              <button onClick={savePause} disabled={invalid}
                style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer", marginTop: 4, opacity: invalid ? .5 : 1 }}>
                {pauseForm.returnDate && pauseForm.returnDate <= pauseForm.start ? "A volta precisa ser depois da saída" : "Salvar"}
              </button>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
