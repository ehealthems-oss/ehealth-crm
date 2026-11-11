// Assistente gerencial: responde perguntas da liderança com os dados do CRM.
// Usado pelo api/whatsapp.js. Só lê dados — nunca altera nada no CRM.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const TZ = "America/Sao_Paulo";

const SYSTEM = `Você é o assistente gerencial da e.Health e responde perguntas da liderança pelo WhatsApp, usando apenas os dados do CRM enviados abaixo.

# A e.Health
Leva a tecnologia de EMS (eletroestimulação de corpo inteiro) até a casa do aluno, em São Paulo. Funil do aluno: Prospecção → Raio-X feito → Experimental feita → Cliente ativo ⇄ Pausado → Inativo. Aulas têm status Realizada, Reagendada ou Cancelada, e um formulário pós-aula com notas de 0 a 10 (presença/atenção, motivação, troca, dor ao chegar, dor na sessão).

# Como responder
- Responda só com base nos dados. Se a informação não estiver no CRM, diga isso em uma frase; nunca invente números, nomes ou datas.
- Conte com cuidado: quando a pergunta pedir números, confira a lista linha a linha antes de responder.
- Datas relativas ("hoje", "ontem", "esta semana", "mês passado") usam a data de hoje informada nos dados. Semana = segunda a domingo, salvo se a pergunta disser outra coisa.
- Formato WhatsApp: curto e direto, no máximo uns 15 linhas. Use *negrito* para destaques e "• " para listas. Sem títulos com #, sem tabelas, sem links.
- Tom: adulto, preciso, frase curta, sem exclamações nem linguagem motivacional.
- Quando algo pedir atenção (dor alta, notas baixas, faltas seguidas, risco de saída), aponte em uma linha no fim.
- Se a pergunta não tiver relação com a e.Health ou com o CRM, diga que só responde sobre os dados do CRM.`;

// ─── Dados do CRM em texto compacto ──────────────────────────────────────────

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const diaSemana = d => new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
const limpa = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const nota = v => (v === null || v === undefined || v === "" ? "-" : v);
const dataSP = iso => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso)) : "");

export function montarContexto(clientes, hoje = hojeSP()) {
  const pausaAtiva = c => (c.pauses || []).find(p => p.start && p.start <= hoje && (!p.returnDate || p.returnDate > hoje));
  const linhasClientes = clientes
    .slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(c => {
      const com = c.commercial || {}, exp = com.experimental || {}, an = com.analysis || {};
      const p = pausaAtiva(c);
      const ultimoRel = (c.assessments || []).map(a => a.date).filter(Boolean).sort().pop();
      return [
        limpa(c.name, 60), c.stage || "-", c.location || "-", c.professional || "-", c.emsFreq || "-",
        c.startDate || "-", dataSP(c.created_at) || "-", c.birthday || "-",
        p ? `${p.type} ${p.start}→${p.returnDate || "sem data"}` : "-",
        com.resultado ? `${com.resultado}${com.motivo ? " (" + limpa(com.motivo, 80) + ")" : ""}` : "-",
        exp.date ? `${exp.date} gostou ${nota(exp.gostou)} interesse ${nota(exp.interesse)}` : "-",
        an.temperatura || "-", ultimoRel || "-",
        limpa(c.goals, 120) || "-", limpa(c.attentionPoints, 200) || "-",
      ].join(" | ");
    });

  const aulas = [];
  clientes.forEach(c => (c.lessons || []).forEach(l => { if (l.date) aulas.push({ c, l }); }));
  aulas.sort((x, y) => (x.l.date < y.l.date ? 1 : -1));
  const linhasAulas = aulas.map(({ c, l }) => [
    l.date, limpa(c.name, 60), l.status || "-", limpa(l.motivo, 120) || "-",
    nota(l.presenca), nota(l.motivacao), nota(l.troca), nota(l.dorChegada), nota(l.dor),
    limpa(l.treinoNome || l.treino, 60) || "-", limpa(l.riscoRetencao, 150) || "-",
    limpa([l.dorChegadaDescricao, l.dorDescricao, l.adaptacoes, l.observacaoGeral].filter(Boolean).join(" / "), 250) || "-",
  ].join(" | "));

  return [
    `# Data de hoje: ${hoje} (${diaSemana(hoje)})`,
    `# Clientes (${clientes.length})`,
    "nome | etapa | local | profissional | plano | início | cadastrado em | aniversário | pausa ativa | negociação | aula experimental | temperatura (IA) | último relatório de avaliação | objetivos | pontos de atenção",
    ...linhasClientes,
    `# Aulas (${aulas.length}, da mais recente para a mais antiga)`,
    "data | cliente | status | motivo | presença | motivação | troca | dor ao chegar | dor na sessão | treino | risco de retenção | observações",
    ...linhasAulas,
  ].join("\n");
}

// ─── Pergunta → resposta ─────────────────────────────────────────────────────

export async function responderPergunta(pergunta, clientes, { client = new Anthropic(), hoje } = {}) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: montarContexto(clientes, hoje), cache_control: { type: "ephemeral" } },
        { type: "text", text: `Pergunta: ${pergunta}` },
      ],
    }],
  });
  if (response.stop_reason === "refusal") return "Não consegui responder essa pergunta.";
  const texto = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  return texto || "Não consegui montar uma resposta. Tente perguntar de outro jeito.";
}
