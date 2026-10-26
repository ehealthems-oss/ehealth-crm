// Aba Comercial: análise SPIN Selling gerada pela IA a partir da anamnese, da aula experimental e das anotações de vendas.
// Roda na Vercel (a chave ANTHROPIC_API_KEY fica nas variáveis de ambiente do projeto, nunca no navegador).
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../src/supabase.js";

const MODEL = "claude-opus-5-5";
const MIN_SECONDS_BETWEEN = 60; // evita gerar várias vezes seguidas para o mesmo cliente

const SYSTEM = `Você é um consultor sênior de vendas consultivas, especialista em SPIN Selling (Neil Rackham), apoiando a equipe da e.Health.

# A e.Health
- Leva a tecnologia de EMS (eletroestimulação de corpo inteiro) até a casa do aluno, em São Paulo. O Raio-X (avaliação inicial) e a aula experimental acontecem no studio parceiro da Terral.
- Avalia (postura, capacidade funcional e composição corporal), entrega um relatório e treina com protocolo documentado — não um treino padrão.
- Sessão de 30 a 40 minutos em 6 fases: preparação fascial (sem EMS), mobilidade articular, propriocepção, força integrada, aeróbio/metabólico, relaxamento.
- Cadência de referência: 2x por semana. Planos: EMS 1x, 2x ou 3x por semana; duração trimestral, semestral ou anual.
- Público principal: mulheres 40+, classe A, que já fizeram personal, academia e dieta e não viram o corpo mudar. Também: agenda lotada, quer conveniência, gosta de tecnologia, não gosta de academia/musculação mas quer ganhar massa muscular.
- Os 4 argumentos de venda: método documentado, tempo (30–40 min), conveniência (em casa, sem deslocamento), tecnologia.
- Tom: adulto, preciso, econômico, frase curta. Nada motivacional, exclamativo ou com gírias ("bora", "shape", "secar", "projeto verão", "transformação radical").

# Regras inegociáveis
- Resultado: a referência de 10 a 14 semanas vem de estudos clínicos de WB-EMS, não da base de alunos da e.Health. Nunca prometer ou garantir resultado.
- Nunca chamar a avaliação de "avaliação médica" ou "check-up de saúde".
- Urgência só como bônus, nunca desconto. Não alegar fila de espera ou exclusividade.
- Não inventar preço, dado, protocolo ou resultado. Use apenas o que está nos dados do cliente; quando faltar informação, transforme a lacuna em pergunta.
- Patologias, medicações e limitações são para cuidado e personalização, nunca para assustar ou pressionar.

# Sua tarefa
Prepare o vendedor para a conversa com ESTE cliente, usando SPIN Selling:
- Situação: o que já sabemos (não repita perguntas que a anamnese já respondeu) e poucas perguntas para completar o contexto.
- Problema: dores, insatisfações e dificuldades explícitas ou implícitas, com perguntas para o cliente verbalizá-las.
- Implicação: perguntas que ampliam o custo do problema na vida do cliente (trabalho, família, saúde futura, autoestima, tempo, dinheiro já gasto sem resultado).
- Necessidade de solução: perguntas que levam o próprio cliente a dizer o valor de resolver, conectando com o que a e.Health oferece.
Tudo personalizado com os fatos do cliente (cite-os), em português do Brasil, pronto para usar. Perguntas abertas, naturais, uma ideia por pergunta. Follow-ups prontos para WhatsApp, curtos, no tom da marca, sem emoji em excesso, chamando o cliente pelo apelido quando houver.`;

const str = { type: "string" };
const list = { type: "array", items: str };
const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });

const SCHEMA = obj({
  resumo: { type: "string", description: "2 a 3 frases: quem é o cliente e o que realmente busca" },
  temperatura: { type: "string", enum: ["Quente", "Morno", "Frio"] },
  temperaturaMotivo: str,
  pontosRelevantes: { ...list, description: "Os fatos mais importantes para a venda, em ordem de relevância" },
  situacao: obj({ sabemos: list, perguntas: list }),
  problema: obj({ dores: list, perguntas: list }),
  implicacao: obj({ perguntas: list }),
  necessidade: obj({ perguntas: list }),
  argumentos: { type: "array", items: obj({ argumento: str, porque: str }) },
  objecoes: { type: "array", items: obj({ objecao: str, resposta: str }) },
  planoSugerido: obj({ plano: str, porque: str }),
  proximoPasso: str,
  followups: { type: "array", items: obj({ quando: str, objetivo: str, mensagem: str }) },
  cuidados: { ...list, description: "O que evitar falar ou fazer com este cliente" },
});

const fmtLesson = l => [
  `Data: ${l.date} — ${l.status}`,
  l.motivo && `Motivo: ${l.motivo}`,
  l.presenca != null && `Presença/atenção: ${l.presenca}/10`,
  l.motivacao != null && `Motivação: ${l.motivacao}/10`,
  l.troca != null && `Troca: ${l.troca}/10`,
  l.dorChegada != null && `Dor ao chegar: ${l.dorChegada}/10 ${l.dorChegadaDescricao || ""}`,
  l.dor != null && `Dor na sessão: ${l.dor}/10 ${l.dorDescricao || ""}`,
  l.dormiu && `Dormiu bem: ${l.dormiu}`,
  l.treinoNome && `Treino: ${l.treinoNome}`,
  l.adaptacoes && `Mudanças no treino: ${l.adaptacoes}`,
  l.riscoRetencao && `Risco de retenção: ${l.riscoRetencao}`,
  l.observacaoGeral && `Observação: ${l.observacaoGeral}`,
].filter(Boolean).join("\n");

const buildPrompt = c => {
  const com = c.commercial || {};
  const exp = com.experimental || {};
  const answers = (c.anamnese?.answers || []).filter(a => !/Nome completo|e-mail|Endereço|Telefone|Instagram/i.test(a.q));
  const lessons = [...(c.lessons || [])].sort((a, b) => (a.date > b.date ? 1 : -1)).slice(0, 3);
  return [
    `# Cliente\nPrimeiro nome: ${(c.name || "").trim().split(/\s+/)[0] || "—"}\nEtapa no funil: ${c.stage}\nLocal: ${c.location || "—"}\nPlano atual: ${c.emsFreq || "nenhum fechado"}`,
    `# Anamnese\n${answers.length ? answers.map(a => `P: ${a.q}\nR: ${a.a}`).join("\n\n") : "Ainda não respondida."}`,
    c.attentionPoints && `# Pontos de atenção da anamnese\n${c.attentionPoints}`,
    `# Aula experimental\n${Object.values(exp).some(v => v !== "" && v != null) ? [
      exp.date && `Data: ${exp.date}`,
      exp.gostou != null && `O quanto gostou da experiência: ${exp.gostou}/10`,
      exp.interesse != null && `Interesse em fechar: ${exp.interesse}/10`,
      exp.reacao && `Como reagiu / o que chamou atenção: ${exp.reacao}`,
      exp.falas && `O que o cliente disse (falas, desejos, receios): ${exp.falas}`,
      exp.dor && `Dor ou desconforto: ${exp.dor}`,
      exp.objecoes && `Dúvidas e objeções levantadas: ${exp.objecoes}`,
      exp.obs && `Observações do profissional: ${exp.obs}`,
    ].filter(Boolean).join("\n") : "Ainda não registrada."}`,
    lessons.length && `# Primeiras aulas registradas\n${lessons.map(fmtLesson).join("\n\n")}`,
    com.notes && `# Anotações do vendedor (conversas até agora)\n${com.notes}`,
    com.resultado && `# Status da negociação\n${com.resultado}${com.motivo ? ` — ${com.motivo}` : ""}`,
    `Hoje é ${new Date().toISOString().slice(0, 10)}. Prepare a análise SPIN para a próxima conversa com este cliente.`,
  ].filter(Boolean).join("\n\n");
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "A chave da IA (ANTHROPIC_API_KEY) não está configurada na Vercel." });

  const { clientId } = req.body || {};
  const { data: c, error } = await supabase.from("clients").select("*").eq("id", clientId).single();
  if (error || !c) return res.status(404).json({ error: "Cliente não encontrado." });

  const last = c.commercial?.analysis?.generatedAt;
  if (last && (Date.now() - new Date(last).getTime()) / 1000 < MIN_SECONDS_BETWEEN)
    return res.status(429).json({ error: "A análise acabou de ser gerada. Aguarde um minuto para gerar de novo." });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(c) }],
    });
    if (response.stop_reason === "refusal") return res.status(502).json({ error: "A IA não conseguiu gerar a análise para este cliente." });
    if (response.stop_reason === "max_tokens") return res.status(502).json({ error: "A análise ficou longa demais. Tente de novo." });
    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    const analysis = { ...JSON.parse(text), generatedAt: new Date().toISOString() };

    // Salva só a análise, preservando o que a equipe preencheu enquanto a IA trabalhava
    const { data: fresh } = await supabase.from("clients").select("commercial").eq("id", clientId).single();
    const commercial = { ...(fresh?.commercial || {}), analysis };
    const { data: saved, error: saveErr } = await supabase.from("clients").update({ commercial }).eq("id", clientId).select().single();
    if (saveErr) return res.status(500).json({ error: "Não foi possível salvar a análise: " + saveErr.message });
    return res.status(200).json({ client: saved });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "A chave da IA é inválida. Confira a ANTHROPIC_API_KEY na Vercel." });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Muitas análises ao mesmo tempo. Tente de novo em instantes." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `Erro da IA (${e.status}): ${e.message}` });
    return res.status(500).json({ error: "Erro ao gerar a análise: " + e.message });
  }
}
