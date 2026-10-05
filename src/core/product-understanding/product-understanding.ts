/**
 * FASE 15A — Product Understanding.
 *
 * FASE 15 found that the Brain can operate on its own real state (Team
 * Intelligence, Self-Awareness) but has zero model of what it IS as a
 * product — 14 of 15 identity questions fell to the generic fallback, and
 * one ("Como uma avaliação vira um Finding?") was actively misread as a
 * mission request because it contains the word "avaliação".
 *
 * This module is the fix's knowledge half: a small, static, structured
 * dictionary of what the real, already-built system already does — never
 * a new architecture, never a guess about a feature that doesn't exist.
 * Every entry below is grounded in code already read and verified across
 * FASE 10–14B (operational-brain.ts, evaluation-orchestrator.ts,
 * recommendations.ts, implementations.ts, validations.ts, team-
 * intelligence.ts, lab-self-awareness.ts) — if a claim here is wrong, the
 * bug is in this file, never a feature invented to sound complete.
 *
 * Deliberately NOT a service: no database access, no provider call, no
 * LLM. "product understanding" is conceptual/structural knowledge about
 * the LAB itself, not live evidence about one project's history — that
 * distinction is also what keeps this module from duplicating Self-
 * Awareness (FASE 13), which answers the SAME-sounding but
 * evidence-based question ("o que o LAB consegue fazer" as demonstrated
 * by this project's own real missions) rather than this module's
 * structural one ("o que o LAB consegue fazer, por construção").
 */

export type ProductConcept =
  | "product"
  | "goal"
  | "brain"
  | "agents"
  | "pipeline-evaluation-to-finding"
  | "pipeline-finding-to-recommendation"
  | "pipeline-after-approval"
  | "finding-vs-recommendation"
  | "human-approval"
  | "capabilities"
  | "limitations"
  | "lifecycle"
  | "agent-ranking";

export const PRODUCT_CONCEPTS: Record<ProductConcept, string> = {
  product:
    "O AI Product Lab é um sistema que avalia produtos/sistemas reais usando agentes especializados, transforma as evidências encontradas em findings, propõe recommendations para melhorá-los, exige uma decisão humana antes de qualquer mudança, e acompanha a implementação e o reteste dessas melhorias. É um ciclo completo de avaliação e melhoria — não um dashboard, não um chatbot genérico, não só um conjunto de agentes, e não só uma ferramenta de testes.",
  goal:
    "O objetivo principal é ajudar a avaliar um sistema real e fechar o ciclo de melhoria contínua: da avaliação até a validação da mudança, sempre com uma decisão humana no meio do caminho — não só encontrar problemas, mas acompanhar até a correção ser confirmada.",
  brain:
    "O Brain é a camada conversacional e operacional do LAB: ele interpreta sua intenção, resolve o projeto certo e encaminha a solicitação para a capacidade real adequada (missão, Team Intelligence, Self-Awareness, aprovação, reteste). Ele não é um agente de avaliação, não executa todos os agentes por padrão, não decide mudanças no produto por conta própria, e não substitui o usuário.",
  agents:
    "Os agentes são especialistas de avaliação, cada um focado em uma dimensão real do produto (UX, acessibilidade, performance, segurança, qualidade/QA, produto, experiência de novo usuário). Eles executam avaliações reais contra um alvo e produzem evidências — eles são uma parte do ciclo, nunca o produto inteiro.",
  "pipeline-evaluation-to-finding":
    "Uma missão de avaliação real é executada pelos agentes selecionados contra um alvo real, produzindo evidências — o que cada agente de fato observou. Quando essas evidências sustentam um problema, risco, lacuna ou sinal real, isso se consolida em um Finding. A opinião isolada de um agente, por si só, nunca vira Finding automaticamente — precisa estar sustentada pela evidência real da missão.",
  "pipeline-finding-to-recommendation":
    "Cada Finding real gera uma Recommendation — uma proposta concreta do que fazer a respeito. A Recommendation nunca é executada automaticamente: ela nasce PENDING e fica assim até uma decisão humana (aprovar ou ignorar).",
  "pipeline-after-approval":
    "Depois que uma Recommendation é aprovada por um humano, ela pode virar uma Implementation Task — um registro real do trabalho de correção, que pode ser encaminhado ao mecanismo de implementação existente. O resultado dessa implementação pode depois ser validado/retestado pelo mecanismo real de validação já existente — o LAB nunca garante sozinho que a mudança funcionou; isso depende de evidência real de reteste.",
  "finding-vs-recommendation":
    "Finding é o que foi observado/encontrado a partir de evidência real de uma missão. Recommendation é o que fazer a respeito — uma proposta de ação derivada desse Finding. Um nunca substitui o outro: toda Recommendation real existe porque há um Finding real por trás dela.",
  "human-approval":
    "A aprovação humana existe porque o LAB pode produzir Recommendations e identificar candidatos a ação, mas a decisão de alterar o sistema real continua sendo humana — é uma barreira operacional deliberada, não uma etapa opcional. Por isso o LAB não substitui a decisão humana: ele amplia a capacidade de avaliar e propor melhorias, mas quem decide agir continua sendo uma pessoa.",
  capabilities:
    "Hoje, por construção, o LAB consegue: interpretar perguntas e comandos operacionais pelo Brain; resolver o projeto certo a partir do que você menciona; selecionar os agentes certos para uma missão (ou todos, numa avaliação geral); executar avaliações reais com agentes; registrar evidências e, quando sustentado por elas, gerar findings e recommendations; analisar o próprio estado operacional (Self-Awareness) e o da equipe (Team Intelligence); encaminhar aprovação, implementação e reteste pelos mecanismos já existentes. Mas sempre dentro de limites — aprovação humana é sempre exigida antes de qualquer mudança real.",
  limitations:
    "Hoje o LAB ainda não tem autonomia irrestrita: não decide mudanças importantes sozinho, depende de aprovação humana para qualquer ação real, depende de um provider externo de modelo para executar avaliações novas, só consulta o GitHub quando configurado, e sua compreensão de linguagem natural é determinística — reconhece os padrões já cobertos, não qualquer forma de perguntar.",
  lifecycle:
    "O ciclo completo é: avaliar (missão real com agentes) → observar/coletar evidências → consolidar findings quando sustentados pela evidência → propor recommendations → aprovação humana → implementation → validação/reteste. A nomenclatura pode variar, mas o conceito — evidência real antes de qualquer afirmação, decisão humana antes de qualquer mudança — não muda em nenhuma etapa.",
  // FINAL HARDENING — a genuine structural fact, not a live computation:
  // by construction there is no cross-history "quality" or "performance"
  // score per agent anywhere in the system (Team Intelligence tracks real
  // activity/findings, Team Architect reasons about coverage/overlap/gaps —
  // neither ranks agents against each other). So "qual agente foi o
  // melhor?" has no real metric to answer from, ever, regardless of which
  // project is in context — this is honesty about an absent capability,
  // never a live "insufficient data for THIS project" judgment, which is
  // why it belongs here and not in Team Intelligence.
  "agent-ranking":
    "Não há essa métrica. O LAB não calcula um ranking de \"melhor agente\" ou \"mais eficiente\" — não existe, por construção, uma pontuação de qualidade ou desempenho comparável entre agentes no sistema atual. O que existe é atividade real (missões, findings, cobertura) por agente, visível via Team Intelligence — não um placar. Não vou inventar um ranking que o produto não tem como sustentar com evidência.",
};

export function explainProductConcept(concept: ProductConcept): string {
  return PRODUCT_CONCEPTS[concept];
}

// ── Classification ──────────────────────────────────────────────────────
//
// Deliberately interrogative-shaped ("o que é", "qual", "como ... vira",
// "por que"): real mission-trigger phrases ("Analisa X.", "Avalia a
// performance de X.", "Quero uma avaliação geral de X.") are imperative,
// never open with these forms and never ask "o que é"/"qual"/"por que" —
// so these patterns are placed in the router BEFORE MISSION_TRIGGER is
// ever reached (see operational-brain.ts) with no extra guard needed: the
// FASE 15 bug ("Como uma avaliação vira um Finding?" being read as a
// mission request) is fixed by this ordering, not by changing
// MISSION_TRIGGER itself.
//
// Each pattern also avoids the exact pre-existing LAB_SELF_AWARENESS_
// CAPABILITIES/LIMITATIONS phrasing ("o que o lab consegue fazer", "o que
// o lab ainda não consegue fazer") on purpose — that bare phrasing keeps
// answering from real per-project evidence (FASE 13, unchanged, checked
// earlier in the router); this module only claims phrasing the
// Self-Awareness patterns never covered.
//
// FASE 16A — FASE 16's grand E2E found that real conversation never uses
// the FASE 15-style canonical phrasing these patterns were originally
// built from ("me explica" instead of "explicar", "corrigir sozinho"
// instead of "consegue fazer sozinho", "dele" instead of repeating
// "lab"...). Rather than adding one literal regex per real sentence (the
// brittle path this phase's own brief explicitly forbids), every pattern
// below is now built from small, reusable SIGNALS — word/stem presence,
// combined order-independently via lookaheads (the same technique
// RETEST_QUERY and the original PRODUCT_WHAT_IS already used) — plus two
// small, genuinely justified equivalence classes (AUTONOMY, CHANGE_VERB)
// for the two real synonym clusters FASE 16 exposed. This is
// normalization-by-stem/equivalence-class, not a rewritten-text pipeline:
// smaller, and it can't drift into a second source of truth about what
// the LAB actually does (PRODUCT_CONCEPTS above is untouched).

/** `(?=.*\bWORD\b)` for every word, so all must be present, in any order. */
function allOf(...words: string[]): string {
  return words.map((w) => `(?=.*\\b${w}\\b)`).join("");
}

// Two real synonym clusters FASE 16 exposed — not simple stems (different
// words for the same idea), so each gets exactly one small alternation,
// reused across whichever concepts actually need it below.
//
// FINAL HARDENING — "por mim" added: "Você pode aprovar essa mudança por
// mim?" is the same "do this instead of a human deciding" idea as
// "sozinho"/"automaticamente", just phrased as a favor instead of
// independence. Always combined with another word via allOf() at every call
// site, so this stays narrow in practice.
const AUTONOMY = `(sozinho|por conta pr[óo]pria|sem ajuda|sem aprova[çc][ãa]o|automaticamente|por mim)`;
const CHANGE_VERB = `(corrig\\w*|mud\\w*|alter\\w*|modific\\w*)`;
const LAB = `(ai product lab|lab)`;

const PRODUCT_WHAT_IS = new RegExp(
  [
    `\\bo que [ée] o ${LAB}\\b`,
    `\\bpara que serve o ${LAB}\\b`,
    allOf("explic\\w*", LAB), // "me explica"/"explique"/"explicaria" o LAB, em qualquer ordem
    allOf("fala\\w*", "sobre", LAB), // "fala um pouco sobre o LAB"
    // "o que exatamente é esse LAB?" — no trailing \b right after [ée]: JS
    // \b only recognizes ASCII \w, so \b immediately after an accented "é"
    // between spaces never matches (the exact bug this codebase already
    // hit and fixed twice in operational-brain.ts's own TEAM_INTELLIGENCE_
    // OVERVIEW/HOW_IS_IT_SHAPE) — "esse" anchors the end instead.
    allOf("o que", "esse", LAB),
    allOf("entender", "primeiro"), // "o que eu deveria entender primeiro?"
    allOf("resum\\w*", LAB), // "resume o LAB" — PRODUCT_LIFECYCLE is checked first in classifyProductConcept, so "resume... ciclo completo" is claimed there instead; this only wins when no ciclo-word is present
  ].join("|"),
  "i",
);
const PRODUCT_GOAL = new RegExp(
  [
    allOf("objetivo", LAB),
    // FINAL HARDENING — "Qual é o principal problema que o LAB resolve?"
    // fell to the generic fallback: the existing phrasing only recognized
    // "objetivo", never "problema...resolve", even though PRODUCT_CONCEPTS'
    // own "goal" text already answers this ("ajudar a avaliar um sistema
    // real e fechar o ciclo de melhoria contínua").
    allOf("problema", "resolve", LAB),
  ].join("|"),
  "i",
);
// Bare "\bbrain\b" is deliberately NOT used alone: a real project name can
// legitimately contain the word "Brain" (e.g. a test fixture "Brain Target
// Project ..."), and a mission request naming such a project ("Analise a
// UX do Brain Target Project ...") must never be misread as a Product
// Understanding question about the Brain itself — same collision class
// BUG 1 (agent-selection.ts) already had to guard against. "brain" only
// counts combined with an actual question-shaped signal.
const PRODUCT_BRAIN = new RegExp([`\\bo que [ée] o brain\\b`, allOf("papel", "brain"), allOf("quem", "coordena")].join("|"), "i");
const PRODUCT_AGENTS = new RegExp(
  [
    allOf("papel", "agentes?"),
    allOf("agentes?", "entram"),
    `\\bo que [ée] um agente\\b`,
    allOf("agentes?", "faz(em)?"), // "o que os agentes fazem" / "o que um agente faz"
    allOf("serv\\w*", "agentes?"), // "pra que servem esses agentes"
  ].join("|"),
  "i",
);
// Eval → Finding: a real problem surfacing from a mission's own evidence.
// "acontece" is required for the strong (stand-alone) form; the weaker
// "encontr*+problema" alone (no "acontece") is deliberately NOT included
// here — that one is a continuation-only signal (see
// classifyProductConceptContinuation below), since on its own it's too
// weak/ambiguous to classify without already knowing the topic is Product
// Understanding.
const PRODUCT_PIPELINE_EVAL_TO_FINDING = new RegExp(
  [
    `\\bcomo\\b.*\\bavalia[çc][ãa]o\\b.*\\bvira\\b.*\\bfinding\\b`,
    allOf("encontr\\w*", "(problemas?|errad[ao]|algo errado)", "acontece"), // "encontra um problema" ou "encontra algo errado"
  ].join("|"),
  "i",
);
const PRODUCT_PIPELINE_FINDING_TO_RECOMMENDATION = new RegExp(
  [
    `\\bcomo\\b.*\\bfinding\\b.*\\bvira\\b.*\\brecommendation\\b`,
    allOf("problema", "recomend\\w*"),
    allOf("recommendation", "(mudan[çc]\\w*|feit[ao]|implementad\\w*)"), // "uma recommendation já é uma mudança feita?"
  ].join("|"),
  "i",
);
const PRODUCT_PIPELINE_AFTER_APPROVAL = new RegExp(
  [
    `\\bo que acontece depois\\b.*\\b(aprova[çc][ãa]o|aprovada)\\b`,
    allOf("depois", "(aprov\\w*|autoriz\\w*)"),
    // FINAL HARDENING — "Como sabemos se a mudança funcionou?" fell to the
    // generic fallback: this concept's own text already answers it exactly
    // ("o LAB nunca garante sozinho que a mudança funcionou; isso depende
    // de evidência real de reteste"), the question just never had a pattern.
    allOf("sabemos", "funcionou"),
  ].join("|"),
  "i",
);
const PRODUCT_FINDING_VS_RECOMMENDATION = new RegExp(
  [
    `\\bdiferen[çc]a entre finding e recommendation\\b`,
    `\\bfinding (vs\\.?|versus|ou) recommendation\\b`,
    allOf("finding", "recommendation"), // ambos os termos presentes, em qualquer forma/ordem
    allOf("encontrou", "recomenda"), // "o que ele encontrou" vs "o que ele recomenda fazer"
    allOf("encontr\\w*", "problema", "recommend\\w*"), // "encontrar um problema já é uma recommendation?"
    // "o que é uma recommendation?" / "o que é um finding?" — same accented
    // \b trap as PRODUCT_WHAT_IS above: "um"/"uma" anchors the end instead
    // of putting \b right after [ée].
    `\\bo que [ée] (um|uma) (finding|recommendation)\\b`,
  ].join("|"),
  "i",
);
const PRODUCT_HUMAN_CONTROL = new RegExp(
  [
    `\\bpor que existe aprova[çc][ãa]o humana\\b`,
    `\\bsubstitu\\w* a decis[ãa]o humana\\b`,
    allOf("papel", "humano"),
    allOf(CHANGE_VERB, AUTONOMY), // "corrigir sozinho", "mudar por conta própria"
    allOf(AUTONOMY, "decid\\w*"), // "decidir sozinho que precisa mudar"
    allOf("precisa", "aprov\\w*"), // "ele precisa da minha aprovação?"
    allOf("por que", "aprov\\w*"), // "por que eu preciso aprovar?"
    // FINAL HARDENING — three real gaps the FINAL VALIDATION found, all
    // genuinely the same "can the LAB decide/approve by itself" question
    // the concept's own text already answers honestly:
    allOf("n[ãa]o deve", "fazer"), // "O que o LAB não deve fazer?"
    allOf("quem", "decide"), // "Quem decide se uma mudança será feita?"
    allOf("aprov\\w*", AUTONOMY), // "Pode aprovar...automaticamente?", "Aprove...automaticamente.", "...aprovar essa mudança por mim?"
  ].join("|"),
  "i",
);
const PRODUCT_CAPABILITIES = new RegExp(
  [`\\bconsegue fazer sozinho\\b`, allOf("ele", "faz", AUTONOMY), allOf("ele", "consegue", "fazer"), allOf("principal", "melhor")].join("|"),
  "i",
);
const PRODUCT_LIMITATIONS = new RegExp(
  [
    `\\bainda n[ãa]o consegue fazer sozinho\\b`,
    allOf("principal", "limita\\w*"),
    allOf("depende", "mim"),
    `(?=.*\\bn[ãa]o\\b)${allOf("consegue", AUTONOMY)}`, // "o que ele não consegue fazer sozinho?"
  ].join("|"),
  "i",
);
const PRODUCT_LIFECYCLE = new RegExp(
  [
    `\\bciclo completo\\b.*\\b${LAB}\\b`,
    `\\bresum\\w*\\b.*\\b${LAB}\\b.*\\b(ciclo|completo|processo|caminho|come[çc]o)\\b`,
    allOf("come[çc]o", "fim"),
    allOf("processo", "inteiro"),
    allOf("caminho", "completo"),
    allOf("termina", "melhoria"),
    allOf("melhorar", "caminho"),
    allOf("avalia\\w*", "vira"), // "como uma avaliação vira uma melhoria?"
    allOf("como", "funciona", "(an[áa]lise|avalia[çc][ãa]o)"), // "como funciona uma avaliação?" / "como uma avaliação funciona?" — qualquer ordem
  ].join("|"),
  "i",
);
// FINAL HARDENING — "Qual agente foi o melhor da história do LAB?", "...o
// agente mais eficiente...", "...melhor desempenho historicamente?": none
// of these ask what an agent IS (PRODUCT_AGENTS, above) — they ask for a
// cross-history quality ranking that genuinely doesn't exist (see
// PRODUCT_CONCEPTS["agent-ranking"]'s own comment). "agente(s)" is
// deliberately required alongside each ranking word, never "melhor"/
// "eficiente"/"desempenho" alone, to stay narrow.
const PRODUCT_AGENT_RANKING = new RegExp([allOf("agentes?", "melhor"), allOf("agentes?", "eficiente"), allOf("agentes?", "desempenho")].join("|"), "i");

/** The one gate: does this message belong to Product Understanding at all? Checked once in the router before the (slightly more expensive) per-concept dispatch below. */
export const PRODUCT_UNDERSTANDING_QUERY = new RegExp(
  [
    PRODUCT_WHAT_IS,
    PRODUCT_GOAL,
    PRODUCT_BRAIN,
    PRODUCT_AGENTS,
    PRODUCT_PIPELINE_EVAL_TO_FINDING,
    PRODUCT_PIPELINE_FINDING_TO_RECOMMENDATION,
    PRODUCT_PIPELINE_AFTER_APPROVAL,
    PRODUCT_FINDING_VS_RECOMMENDATION,
    PRODUCT_HUMAN_CONTROL,
    PRODUCT_CAPABILITIES,
    PRODUCT_LIMITATIONS,
    PRODUCT_LIFECYCLE,
    PRODUCT_AGENT_RANKING,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);

/**
 * intenção conceitual → conceito: the one place that decides WHICH
 * concept a Product Understanding question is about. Order matters only
 * where two patterns could both match the same text (none currently do);
 * most specific concepts are checked first on general principle.
 */
export function classifyProductConcept(text: string): ProductConcept | null {
  if (PRODUCT_PIPELINE_EVAL_TO_FINDING.test(text)) return "pipeline-evaluation-to-finding";
  if (PRODUCT_PIPELINE_FINDING_TO_RECOMMENDATION.test(text)) return "pipeline-finding-to-recommendation";
  if (PRODUCT_PIPELINE_AFTER_APPROVAL.test(text)) return "pipeline-after-approval";
  if (PRODUCT_FINDING_VS_RECOMMENDATION.test(text)) return "finding-vs-recommendation";
  if (PRODUCT_HUMAN_CONTROL.test(text)) return "human-approval";
  // LIMITATIONS checked before CAPABILITIES: "ainda não consegue fazer
  // sozinho" contains "consegue fazer sozinho" as a literal substring, so
  // the more specific (negated) pattern must win first.
  if (PRODUCT_LIMITATIONS.test(text)) return "limitations";
  if (PRODUCT_CAPABILITIES.test(text)) return "capabilities";
  if (PRODUCT_LIFECYCLE.test(text)) return "lifecycle";
  // Checked before PRODUCT_AGENTS: a ranking question also contains
  // "agente(s)", so the more specific pattern must win first.
  if (PRODUCT_AGENT_RANKING.test(text)) return "agent-ranking";
  if (PRODUCT_BRAIN.test(text)) return "brain";
  if (PRODUCT_AGENTS.test(text)) return "agents";
  if (PRODUCT_GOAL.test(text)) return "goal";
  if (PRODUCT_WHAT_IS.test(text)) return "product";
  return null;
}

// ── Conversational continuity (FASE 16A) ────────────────────────────────
//
// FASE 16's own E2E found real follow-ups too weak/pronoun-dependent to
// classify on their own ("E os agentes?", "E se um deles encontrar um
// problema?", "Então me resume tudo.") — none name the LAB, and the last
// one's only signal ("resum*") is too generic to trust without already
// knowing the conversation's topic. These are deliberately NOT folded into
// classifyProductConcept's own patterns above (which must stay safe to
// call with zero context, e.g. from PRODUCT_UNDERSTANDING_QUERY): this
// second, weaker classifier is only ever consulted by the caller
// (operational-brain.ts) when state.lastProductConcept says the
// immediately preceding reply already was Product Understanding — never
// from "any earlier message" in the conversation, and never on its own.
export function classifyProductConceptContinuation(text: string): ProductConcept | null {
  if (/\bagentes?\b/i.test(text)) return "agents";
  if (/\bencontr\w*\b/i.test(text) && /\bproblemas?\b/i.test(text)) return "pipeline-evaluation-to-finding";
  if (/\bresum\w*\b/i.test(text)) return "lifecycle";
  return null;
}
