import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// ─── Constants ───────────────────────────────────────────────────────────────
const EMS_FREQ = ["EMS 1x/semana", "EMS 2x/semana", "EMS 3x/semana"];
const LOCATIONS = ["In Home", "Racquet Club Terral", "Racquet Club Salve Arena"];
// Apenas 2 categorias visíveis no CRM
const CLIENT_STAGES = ["Cliente ativo", "Prospecção"];
const STAGE_COLORS = {
  "Cliente ativo": "#2d7a4f",
  "Prospecção":    "#c9a96e",
};
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
  location: "In Home", emsFreq: "EMS 2x/semana", professional: "", notes: "",
  anamneseLink: "", anamneseDone: false,
  startDate: "", // data de início para LTV
  reportUrl: "", // PDF do relatório
  attentionPoints: "", // pontos de atenção extraídos/editados
  height: "", weight: "", goals: "", // vindos da anamnese
  assessments: [], lessons: [], touchpoints: [], tasks: [],
};

const EMPTY_LESSON = {
  date: "", status: "Realizada", notes: "",
  // Formulário pós-aula
  presenca: null,        // 0-10
  motivacao: null,       // 0-10
  troca: null,           // 0-10
  riscoRetencao: "",     // texto livre
  dormiu: "",            // Sim / Não / Parcialmente
  descansado: "",        // Sim / Não / Parcialmente
  dor: null,             // 0-10 (null = sem dor)
  alimentacao: "",       // texto livre
  musculosTrabalhados: "",
  adaptacoes: "",
  observacaoGeral: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const locLabel = l =>
  l === "In Home" ? "🏠 In Home" :
  l === "Racquet Club Terral" ? "🎾 Terral" : "🎾 Salve Arena";
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

// Avaliações: próximas por tipo (2 meses)
const avalStatus = c => {
  const assessments = c.assessments || [];
  return AVAL_TYPES.map(type => {
    const ofType = assessments.filter(a => a.type === type).sort((a, b) => b.date > a.date ? 1 : -1);
    const last = ofType[0];
    if (!last) return { type, lastDate: null, nextDate: null, daysLeft: null };
    const next = new Date(last.date + "T12:00:00");
    next.setMonth(next.getMonth() + 2);
    const nextStr = next.toISOString().split("T")[0];
    return { type, lastDate: last.date, nextDate: nextStr, daysLeft: daysUntil(nextStr) };
  });
};

const nextAvalAlert = c => {
  const statuses = avalStatus(c).filter(s => s.daysLeft !== null && s.daysLeft <= 14);
  if (!statuses.length) return null;
  return statuses.sort((a, b) => a.daysLeft - b.daysLeft)[0];
};

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

function AlertBadge({ days, label }) {
  if (days === null || days < 0 || days > 30) return null;
  const urgent = days <= 7;
  return (
    <span style={{ background: urgent ? "#ffeaea" : "#fff8e8", color: urgent ? "#c0392b" : "#b05e1a", border: `1px solid ${urgent ? "#f5c6c6" : "#f0d080"}`, borderRadius: 16, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
      {label} {days === 0 ? "hoje" : `em ${days}d`}
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
  const [assessForm, setAssessForm] = useState({ type: "Postural", date: today(), professional: "", notes: "" });
  const [lessonForm, setLessonForm] = useState({ ...EMPTY_LESSON, date: today() });
  const [touchForm, setTouchForm] = useState({ date: today(), channel: "WhatsApp", direction: "Saída", summary: "" });
  const [taskForm, setTaskForm] = useState({ title: "", dueDate: "", done: false });
  const [aiLoading, setAiLoading] = useState(false);
  const [editingLesson, setEditingLesson] = useState(null); // id da aula sendo visualizada
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (data) setClients(data.map(normalizeClient));
      setLoading(false);
    })();
  }, []);

  const normalizeClient = c => ({
    ...EMPTY_CLIENT, ...c,
    assessments: c.assessments || [],
    lessons: c.lessons || [],
    touchpoints: c.touchpoints || [],
    tasks: c.tasks || [],
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

  const ff = k => v => setForm(f => ({ ...f, [k]: v }));
  const lf = k => v => setLessonForm(f => ({ ...f, [k]: v }));

  // ── Upload de relatório PDF ──
  const handleReportUpload = async (file) => {
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

      await updateSel(c => ({ ...c, reportUrl: urlData.publicUrl }));
    } catch (e) {
      console.error("Upload error:", e);
      alert("Erro ao fazer upload: " + (e.message || "tente novamente"));
    } finally {
      setAiLoading(false);
    }
  };

  // ── Extração de pontos de atenção via IA (Edge Function) ──
  const extractAttentionPoints = async () => {
    if (!sel?.reportUrl && !sel?.anamneseLink) {
      alert("Adicione o PDF do relatório ou o link da anamnese primeiro.");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-attention-points", {
        body: {
          clientName: sel.name,
          reportUrl: sel.reportUrl || null,
          anamneseLink: sel.anamneseLink || null,
        },
      });
      if (error) throw error;
      const points = data?.attentionPoints || "Nenhum ponto de atenção identificado.";
      await updateSel(c => ({ ...c, attentionPoints: points }));
    } catch (e) {
      console.error("AI extraction error:", e);
      // Fallback: prompt manual
      await updateSel(c => ({ ...c, attentionPoints: sel.attentionPoints || "" }));
      alert("Extração automática indisponível. Você pode preencher manualmente os pontos de atenção.");
    } finally {
      setAiLoading(false);
    }
  };

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    return (!q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q)) &&
      (filterStage === "Todos" || c.stage === filterStage);
  });

  // Alertas
  const alerts = clients
    .filter(c => c.stage === "Cliente ativo")
    .map(c => ({ c, bd: nextBirthdayDays(c.birthday), avalAlert: nextAvalAlert(c), risk: calcRisk(c) }))
    .filter(x => (x.bd !== null && x.bd <= 14) || x.avalAlert !== null || x.risk.level === "Alto");

  const stats = {
    total: clients.length,
    active: clients.filter(c => c.stage === "Cliente ativo").length,
    prospects: clients.filter(c => c.stage === "Prospecção").length,
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { l: "Ativas", v: stats.active, c: "#2d7a4f" },
              { l: "Prospecção", v: stats.prospects, c: gold },
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
              {alerts.map(({ c, bd, avalAlert, risk }) => (
                <div key={c.id} onClick={() => { setSel(c); setDetailTab("geral"); setModal("detail"); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "#f8f3ea", marginBottom: 5, cursor: "pointer", border: "1px solid #e8dfc8" }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: navy }}>{c.name}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {bd !== null && bd <= 14 && <AlertBadge days={bd} label="🎂" />}
                    {avalAlert && <AlertBadge days={avalAlert.daysLeft} label={`📋 ${avalAlert.type}`} />}
                    {risk.level === "Alto" && <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 700, background: "#ffeaea", border: "1px solid #f5c6c6", borderRadius: 10, padding: "2px 8px" }}>🌡️ Alto risco</span>}
                  </div>
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
                  {aa && <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 600 }}>📋{aa.daysLeft}d</span>}
                  {(c.lessons || []).length >= 2 && <span style={{ fontSize: 11, color, fontWeight: 700 }}>🌡️{level}</span>}
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
          <Sel label="Status" value={form.stage} onChange={ff("stage")} options={CLIENT_STAGES} />
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
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Frequência EMS</label>
            <div style={{ display: "flex", gap: 6 }}>
              {EMS_FREQ.map(f => (
                <button key={f} onClick={() => ff("emsFreq")(f)}
                  style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "2px solid", borderColor: form.emsFreq === f ? gold : "#c9b89a", background: form.emsFreq === f ? gold + "22" : "#fffdf8", fontWeight: form.emsFreq === f ? 700 : 400, fontSize: 11, cursor: "pointer", color: form.emsFreq === f ? "#7a5c1e" : "#2a2218" }}>
                  {f}
                </button>
              ))}
            </div>
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
            {nextBirthdayDays(sel.birthday) !== null && nextBirthdayDays(sel.birthday) <= 14 && <AlertBadge days={nextBirthdayDays(sel.birthday)} label="🎂" />}
            {avalStatus(sel).filter(s => s.daysLeft !== null && s.daysLeft <= 14).map(s => (
              <AlertBadge key={s.type} days={s.daysLeft} label={`📋 ${s.type}`} />
            ))}
          </div>

          {/* Termômetro */}
          <RiskThermometer client={sel} />

          {/* Mover status */}
          <div style={{ margin: "0 0 14px", background: "#f8f3ea", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6 }}>STATUS</div>
            <div style={{ display: "flex", gap: 8 }}>
              {CLIENT_STAGES.map(st => (
                <button key={st} onClick={() => mv(sel.id, st)}
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 20, border: "1px solid", borderColor: sel.stage === st ? STAGE_COLORS[st] : "#ddd", background: sel.stage === st ? STAGE_COLORS[st] + "22" : "#fff", color: sel.stage === st ? STAGE_COLORS[st] : "#888", fontSize: 12, cursor: "pointer", fontWeight: sel.stage === st ? 700 : 400 }}>
                  {st}
                </button>
              ))}
            </div>
          </div>

          <Tabs active={detailTab} onChange={setDetailTab} tabs={[
            { id: "geral", label: "Geral" },
            { id: "anamnese", label: "Anamnese / Relatório" },
            { id: "avaliacoes", label: "Avaliações" },
            { id: "aulas", label: `Aulas (${(sel.lessons || []).length})` },
            { id: "touchpoints", label: `Contatos (${(sel.touchpoints || []).length})` },
            { id: "tarefas", label: `Tarefas (${(sel.tasks || []).filter(t => !t.done).length})` },
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
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#7a5c00", marginBottom: 6 }}>⚠️ Pontos de atenção</div>
                  <div style={{ fontSize: 13, color: "#555", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{sel.attentionPoints}</div>
                </div>
              )}

              {sel.notes && (
                <div style={{ background: "#f8f3ea", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#555", marginBottom: 12 }}>
                  {sel.notes}
                </div>
              )}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: navy }}>⚠️ Pontos de atenção (IA)</span>
                  <button onClick={extractAttentionPoints} disabled={aiLoading}
                    style={{ background: navy, color: gold, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: aiLoading ? "default" : "pointer", opacity: aiLoading ? .6 : 1 }}>
                    {aiLoading ? "Analisando…" : "🤖 Extrair"}
                  </button>
                </div>
                <textarea value={sel.attentionPoints || ""} onChange={e => updateSel(c => ({ ...c, attentionPoints: e.target.value }))}
                  rows={4} placeholder="Patologias, contraindicações, pontos de atenção identificados na anamnese e relatório…"
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e0c860", borderRadius: 8, fontSize: 13, background: "#fffdf0", color: "#2a2218", boxSizing: "border-box", outline: "none", resize: "vertical" }} />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>O campo é editável. A IA preenche automaticamente quando você clica em "Extrair".</div>
              </div>

              {/* Relatório PDF */}
              <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid #e8dfc8" }}>
                <div style={{ fontWeight: 700, color: navy, marginBottom: 8, fontSize: 13 }}>📄 Relatório Postural/Funcional (PDF)</div>
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

              {/* Anamnese */}
              <div style={{ background: "#f8f3ea", borderRadius: 10, padding: "14px 16px", border: "1px solid #e8dfc8" }}>
                <div style={{ fontWeight: 700, color: navy, marginBottom: 8, fontSize: 13 }}>📋 Anamnese (Google Forms)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <button onClick={() => updateSel(c => ({ ...c, anamneseDone: !c.anamneseDone }))}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, border: "2px solid", borderColor: sel.anamneseDone ? "#2d7a4f" : "#c9b89a", background: sel.anamneseDone ? "#e8f8ee" : "#fffdf8", cursor: "pointer", fontWeight: 700, fontSize: 13, color: sel.anamneseDone ? "#2d7a4f" : "#888" }}>
                    {sel.anamneseDone ? "✅ Anamnese realizada" : "◻️ Anamnese pendente"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={sel.anamneseLink || ""} onChange={e => updateSel(c => ({ ...c, anamneseLink: e.target.value }))}
                    placeholder="Cole aqui o link do Google Forms…"
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #c9b89a", borderRadius: 8, fontSize: 13, background: "#fffdf8", color: "#2a2218", outline: "none" }} />
                  {sel.anamneseLink && (
                    <a href={sel.anamneseLink} target="_blank" rel="noopener"
                      style={{ padding: "8px 14px", background: navy, color: gold, borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
                      Abrir ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB AVALIAÇÕES */}
          {detailTab === "avaliacoes" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16 }}>
                {avalStatus(sel).map(({ type, lastDate, nextDate, daysLeft }) => {
                  const hasAval = !!lastDate;
                  const urgent = daysLeft !== null && daysLeft <= 7;
                  const warn = daysLeft !== null && daysLeft <= 14;
                  const overdue = daysLeft !== null && daysLeft < 0;
                  return (
                    <div key={type} style={{ background: overdue ? "#fff0ee" : urgent ? "#fff8ee" : warn ? "#fffde8" : "#f8f3ea", borderRadius: 10, padding: "12px 14px", border: `1px solid ${overdue ? "#f0a0a0" : urgent ? "#f0c080" : warn ? "#e8d860" : "#e0d8cc"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: navy }}>{type}</span>
                        <button onClick={() => { setAssessForm({ type, date: today(), professional: sel.professional || "", notes: "" }); setSubModal("assessment"); }}
                          style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          + Registrar
                        </button>
                      </div>
                      {hasAval ? (
                        <>
                          <div style={{ fontSize: 12, color: "#555" }}>Última: <b>{fmtDate(lastDate)}</b></div>
                          <div style={{ fontSize: 12, marginTop: 3, color: overdue ? "#c0392b" : urgent ? "#b05e1a" : warn ? "#7a6000" : "#2d7a4f", fontWeight: 600 }}>
                            {overdue ? `⚠️ Vencida há ${Math.abs(daysLeft)}d` :
                              urgent ? `🔶 Vence em ${daysLeft}d` :
                              warn ? `📅 Vence em ${daysLeft}d` :
                              `✅ Próxima: ${fmtDate(nextDate)}`}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: "#aaa", fontStyle: "italic" }}>Ainda não realizada</div>
                      )}
                    </div>
                  );
                })}
              </div>

              <SectionTitle>Histórico de avaliações</SectionTitle>
              {(sel.assessments || []).length === 0 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "16px 0" }}>Nenhuma avaliação registrada.</div>
              ) : [...(sel.assessments || [])].sort((a, b) => b.date > a.date ? 1 : -1).map(a => (
                <div key={a.id} style={{ background: "#f8f3ea", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 8, border: "1px solid #e8dfc8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: navy }}>{a.type}</span>
                    <span style={{ color: "#888", fontSize: 12 }}>{fmtDate(a.date)}</span>
                  </div>
                  {a.professional && <div style={{ color: "#888", fontSize: 12, marginBottom: 2 }}>👤 {a.professional}</div>}
                  {a.notes && <div style={{ color: "#555", marginTop: 6, fontSize: 13, borderTop: "1px solid #e0d8cc", paddingTop: 6 }}>{a.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {/* TAB AULAS */}
          {detailTab === "aulas" && (
            <div>
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
                          {l.dor !== null && l.dor !== undefined && <div>🤕 Dor/desconforto: <b>{l.dor}/10</b></div>}
                          {l.alimentacao && <div style={{ gridColumn: "1/-1" }}>🍎 Alimentação: {l.alimentacao}</div>}
                          {l.musculosTrabalhados && <div style={{ gridColumn: "1/-1" }}>💪 Músculos: {l.musculosTrabalhados}</div>}
                          {l.adaptacoes && <div style={{ gridColumn: "1/-1" }}>🔧 Adaptações: {l.adaptacoes}</div>}
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

          {/* TAB TOUCHPOINTS */}
          {detailTab === "touchpoints" && (
            <div>
              <SectionTitle action={
                <button onClick={() => { setTouchForm({ date: today(), channel: "WhatsApp", direction: "Saída", summary: "" }); setSubModal("touch"); }}
                  style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  + Registrar contato
                </button>
              }>Touch points</SectionTitle>
              {(sel.touchpoints || []).length === 0 ? (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "20px 0" }}>Nenhum contato registrado.</div>
              ) : [...(sel.touchpoints || [])].sort((a, b) => b.date > a.date ? 1 : -1).map(tp => (
                <div key={tp.id} style={{ display: "flex", gap: 10, padding: "9px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e8dfc8", marginBottom: 6 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: tp.direction === "Saída" ? navy + "15" : gold + "25", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                    {tp.channel === "WhatsApp" ? "💬" : tp.channel === "Ligação" ? "📞" : "🤝"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: navy }}>{tp.channel} · {tp.direction}</span>
                      <span style={{ fontSize: 11, color: "#aaa" }}>{fmtDateShort(tp.date)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>{tp.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB TAREFAS */}
          {detailTab === "tarefas" && (
            <div>
              <SectionTitle action={
                <button onClick={() => { setTaskForm({ title: "", dueDate: "", done: false }); setSubModal("task"); }}
                  style={{ background: gold, color: navy, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  + Nova tarefa
                </button>
              }>Tarefas</SectionTitle>
              {(sel.tasks || []).filter(t => !t.done).length === 0 && (sel.tasks || []).filter(t => t.done).length === 0 && (
                <div style={{ fontSize: 13, color: "#aaa", textAlign: "center", padding: "20px 0" }}>Nenhuma tarefa.</div>
              )}
              {(sel.tasks || []).filter(t => !t.done).map(t => {
                const ov = t.dueDate && new Date(t.dueDate + "T12:00:00") < new Date();
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: ov ? "#fff3ee" : "#fff", borderRadius: 8, border: "1px solid " + (ov ? "#f0a070" : "#e8dfc8"), marginBottom: 6 }}>
                    <button onClick={() => updateSel(c => ({ ...c, tasks: (c.tasks || []).map(x => x.id === t.id ? { ...x, done: true } : x) }))}
                      style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid #c9b89a", background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: navy }}>{t.title}</div>
                      {t.dueDate && <div style={{ fontSize: 11, color: ov ? "#b05e1a" : "#888" }}>📅 {fmtDate(t.dueDate)}{ov ? " · Atrasada" : ""}</div>}
                    </div>
                    <button onClick={() => updateSel(c => ({ ...c, tasks: (c.tasks || []).filter(x => x.id !== t.id) }))}
                      style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
              {(sel.tasks || []).filter(t => t.done).length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: "#aaa", margin: "10px 0 5px", fontWeight: 600 }}>CONCLUÍDAS</div>
                  {(sel.tasks || []).filter(t => t.done).map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#f0f0f0", borderRadius: 8, marginBottom: 4 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: "#2d7a4f", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, flexShrink: 0 }}>✓</div>
                      <span style={{ flex: 1, fontSize: 12, color: "#aaa", textDecoration: "line-through" }}>{t.title}</span>
                      <button onClick={() => updateSel(c => ({ ...c, tasks: (c.tasks || []).filter(x => x.id !== t.id) }))}
                        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16 }}>×</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── SUB-MODAL: Registrar avaliação ── */}
      {subModal === "assessment" && (
        <Modal title={`📋 Registrar avaliação — ${assessForm.type}`} onClose={() => setSubModal(null)}>
          <Inp label="Data da avaliação" value={assessForm.date} onChange={v => setAssessForm(f => ({ ...f, date: v }))} type="date" />
          <Inp label="Profissional" value={assessForm.professional} onChange={v => setAssessForm(f => ({ ...f, professional: v }))} placeholder="Nome do profissional" />
          <TA label="Observações / resultados" value={assessForm.notes} onChange={v => setAssessForm(f => ({ ...f, notes: v }))} rows={4} placeholder="Resultados, medidas, progressos…" />
          <button onClick={async () => {
            await updateSel(c => ({ ...c, assessments: [{ ...assessForm, id: Date.now().toString() }, ...(c.assessments || [])] }));
            setSubModal(null);
          }} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer", marginTop: 4 }}>
            Salvar avaliação
          </button>
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
                <ScoreSlider label="Teve alguma dor/desconforto durante a sessão? (0 = nenhuma)" value={lessonForm.dor} onChange={lf("dor")} hint="0 = sem dor, 10 = dor intensa" />
                <TA label="Como está a alimentação e hidratação no dia da sessão?" value={lessonForm.alimentacao} onChange={lf("alimentacao")} rows={2} placeholder="Descreveu, não se alimentou, estava desidratado…" />
              </div>

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                <TA label="Quais foram os principais músculos trabalhados?" value={lessonForm.musculosTrabalhados} onChange={lf("musculosTrabalhados")} rows={2} placeholder="Ex: glúteos, isquiotibiais, core…" />
                <TA label="Teve alguma adaptação no treino? Qual?" value={lessonForm.adaptacoes} onChange={lf("adaptacoes")} rows={2} placeholder="Ex: reduziu carga no quadril por dor, trabalhou mobilidade…" />
              </div>

              <div style={{ borderTop: "1px solid #e0d8cc", paddingTop: 14, marginTop: 4 }}>
                <TA label="⚠️ Há algum risco/ponto de atenção que coloque a retenção do cliente em risco?" value={lessonForm.riscoRetencao} onChange={lf("riscoRetencao")} rows={3} placeholder="Ex: cliente comentou que vai viajar, está insatisfeito com resultados, problemas financeiros…" />
              </div>
            </div>
          )}

          {/* Observação geral (sempre visível) */}
          <TA label="📝 Alguma observação geral?" value={lessonForm.observacaoGeral} onChange={lf("observacaoGeral")} rows={3} placeholder="Observações gerais sobre a aula, o cliente, próximos passos…" />

          <button onClick={async () => {
            await updateSel(c => ({ ...c, lessons: [{ ...lessonForm, id: Date.now().toString() }, ...(c.lessons || [])] }));
            setSubModal(null);
          }} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer", marginTop: 4 }}>
            Salvar aula
          </button>
        </Modal>
      )}

      {/* ── SUB-MODAL: Contato ── */}
      {subModal === "touch" && (
        <Modal title="💬 Registrar contato" onClose={() => setSubModal(null)}>
          <Inp label="Data" value={touchForm.date} onChange={v => setTouchForm(f => ({ ...f, date: v }))} type="date" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Sel label="Canal" value={touchForm.channel} onChange={v => setTouchForm(f => ({ ...f, channel: v }))} options={["WhatsApp", "Presencial", "Ligação", "E-mail"]} />
            <Sel label="Direção" value={touchForm.direction} onChange={v => setTouchForm(f => ({ ...f, direction: v }))} options={["Saída", "Entrada"]} />
          </div>
          <TA label="Resumo do contato *" value={touchForm.summary} onChange={v => setTouchForm(f => ({ ...f, summary: v }))} rows={3} placeholder="Do que se tratou o contato…" />
          <button onClick={async () => {
            if (!touchForm.summary) return;
            await updateSel(c => ({ ...c, touchpoints: [{ ...touchForm, id: Date.now().toString() }, ...(c.touchpoints || [])] }));
            setSubModal(null);
          }} disabled={!touchForm.summary} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer", marginTop: 4, opacity: touchForm.summary ? 1 : .5 }}>
            Salvar contato
          </button>
        </Modal>
      )}

      {/* ── SUB-MODAL: Tarefa ── */}
      {subModal === "task" && (
        <Modal title="✅ Nova tarefa" onClose={() => setSubModal(null)}>
          <Inp label="Descrição *" value={taskForm.title} onChange={v => setTaskForm(f => ({ ...f, title: v }))} placeholder="Ex: Enviar protocolo de treino" />
          <Inp label="Data limite" value={taskForm.dueDate} onChange={v => setTaskForm(f => ({ ...f, dueDate: v }))} type="date" />
          <button onClick={async () => {
            if (!taskForm.title) return;
            await updateSel(c => ({ ...c, tasks: [{ ...taskForm, id: Date.now().toString(), done: false }, ...(c.tasks || [])] }));
            setSubModal(null);
          }} disabled={!taskForm.title} style={{ width: "100%", background: navy, color: gold, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer", marginTop: 4, opacity: taskForm.title ? 1 : .5 }}>
            Salvar tarefa
          </button>
        </Modal>
      )}
    </div>
  );
}
