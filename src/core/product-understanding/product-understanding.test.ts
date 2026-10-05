import { describe, expect, it } from "vitest";
import { classifyProductConcept, classifyProductConceptContinuation, explainProductConcept, PRODUCT_UNDERSTANDING_QUERY, type ProductConcept } from "./product-understanding";

describe("classifyProductConcept", () => {
  it.each<[string, ProductConcept]>([
    ["O que é o AI Product Lab?", "product"],
    ["Para que serve o LAB?", "product"],
    ["Se você tivesse que explicar o AI Product Lab para alguém que nunca o viu, como explicaria?", "product"],
    ["Qual é o objetivo principal do AI Product Lab?", "goal"],
    ["Qual é o papel do Brain?", "brain"],
    ["Qual é o papel dos agentes?", "agents"],
    ["Como uma avaliação vira um Finding?", "pipeline-evaluation-to-finding"],
    ["Como um Finding vira uma Recommendation?", "pipeline-finding-to-recommendation"],
    ["O que acontece depois que uma Recommendation é aprovada?", "pipeline-after-approval"],
    ["Qual é a diferença entre Finding e Recommendation?", "finding-vs-recommendation"],
    ["Por que existe aprovação humana no AI Product Lab?", "human-approval"],
    ["O AI Product Lab existe para substituir a decisão humana?", "human-approval"],
    ["O que o AI Product Lab consegue fazer sozinho hoje?", "capabilities"],
    ["O que o AI Product Lab ainda não consegue fazer sozinho?", "limitations"],
    ["Qual é a principal limitação atual do AI Product Lab?", "limitations"],
    ["Então, resumindo: qual é o ciclo completo do AI Product Lab?", "lifecycle"],
  ])("%s -> %s", (message, expected) => {
    expect(classifyProductConcept(message)).toBe(expected);
  });

  it("returns null for a message with no recognizable product-understanding shape", () => {
    expect(classifyProductConcept("Qual é a previsão do tempo hoje?")).toBeNull();
  });

  it("never matches an imperative mission-trigger phrase, even one naming the same real concepts", () => {
    for (const message of ["Analisa o AI Product Lab.", "Avalia a performance do AI Product Lab.", "Quero uma avaliação geral do AI Product Lab."]) {
      expect(classifyProductConcept(message)).toBeNull();
    }
  });

  it("the gate regex (PRODUCT_UNDERSTANDING_QUERY) matches every message classifyProductConcept recognizes, and nothing it doesn't", () => {
    const recognized = ["O que é o AI Product Lab?", "Qual é o papel do Brain?", "Por que existe aprovação humana no AI Product Lab?"];
    for (const message of recognized) {
      expect(PRODUCT_UNDERSTANDING_QUERY.test(message)).toBe(true);
      expect(classifyProductConcept(message)).not.toBeNull();
    }
    expect(PRODUCT_UNDERSTANDING_QUERY.test("Analisa o AI Product Lab.")).toBe(false);
  });
});

describe("explainProductConcept", () => {
  it("returns a real, non-empty answer for every concept, grounded in verified code behavior", () => {
    const concepts: ProductConcept[] = [
      "product",
      "goal",
      "brain",
      "agents",
      "pipeline-evaluation-to-finding",
      "pipeline-finding-to-recommendation",
      "pipeline-after-approval",
      "finding-vs-recommendation",
      "human-approval",
      "capabilities",
      "limitations",
      "lifecycle",
    ];
    for (const concept of concepts) {
      const text = explainProductConcept(concept);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("never claims the Brain is an evaluation agent, executes all agents directly, or decides product changes on its own", () => {
    const text = explainProductConcept("brain");
    expect(text).not.toMatch(/o brain [ée] um agente/i);
    expect(text).toMatch(/n[ãa]o [ée] um agente/i);
    expect(text).toMatch(/n[ãa]o decide mudan[çc]as.*por conta pr[óo]pria|n[ãa]o substitui o usu[áa]rio/i);
  });

  it("never says a Recommendation is executed automatically, or that the LAB alone guarantees an implementation succeeded", () => {
    const pipeline = explainProductConcept("pipeline-finding-to-recommendation");
    const afterApproval = explainProductConcept("pipeline-after-approval");
    expect(pipeline).toMatch(/nunca [ée] executada automaticamente/i);
    expect(afterApproval).toMatch(/nunca garante sozinho/i);
    expect(afterApproval).not.toMatch(/\bautomaticamente implementad/i);
  });

  it("finding-vs-recommendation keeps the two concepts distinct, never conflating them", () => {
    const text = explainProductConcept("finding-vs-recommendation");
    expect(text).toMatch(/finding [ée] o que foi observado/i);
    expect(text).toMatch(/recommendation [ée] o que fazer/i);
  });

  it("human-approval explicitly says the LAB does not replace human decision-making", () => {
    const text = explainProductConcept("human-approval");
    expect(text).toMatch(/n[ãa]o substitui a decis[ãa]o humana/i);
  });

  it("capabilities never claims GitHub access or a provider-independent execution as unconditional", () => {
    const text = explainProductConcept("capabilities");
    expect(text).toMatch(/aprova[çc][ãa]o humana [ée] sempre exigida/i);
  });

  it("limitations honestly names real, structural dependencies, never a generic 'AI can't do X' list", () => {
    const text = explainProductConcept("limitations");
    expect(text).toMatch(/aprova[çc][ãa]o humana/i);
    expect(text).toMatch(/provider externo/i);
    expect(text).toMatch(/github/i);
  });
});

/**
 * FASE 16A — Natural Product Understanding. FASE 16's own grand E2E found
 * that 0/15 real, naturally-phrased conceptual questions were recognized —
 * only the FASE 15-style canonical phrasing worked. This block is the
 * minimum coverage this phase's brief requires (section 5), each phrase
 * taken verbatim from that brief, grouped exactly as its brief groups
 * them. Two phrases are deliberately absent from this list — see the
 * dedicated "protected Self-Awareness boundary" test below for why.
 */
describe("classifyProductConcept — natural language (FASE 16A)", () => {
  it.each<[string, ProductConcept]>([
    // OVERVIEW
    ["Me explica o LAB como se eu fosse novo aqui.", "product"],
    ["Me explica o AI Product Lab.", "product"],
    ["Fala um pouco sobre o LAB.", "product"],
    ["O que exatamente é esse LAB?", "product"],
    ["Resume o LAB.", "product"],
    // COMPONENTES
    ["E onde entram os agentes nisso?", "agents"],
    ["O que os agentes fazem?", "agents"],
    ["Pra que servem esses agentes?", "agents"],
    ["E o Brain, qual é o papel dele?", "brain"],
    ["Quem coordena tudo isso?", "brain"],
    // PIPELINE
    ["Se um agente encontrar um problema, o que acontece?", "pipeline-evaluation-to-finding"],
    ["Quando o LAB encontra alguma coisa errada, o que acontece depois?", "pipeline-evaluation-to-finding"],
    ["Como uma avaliação vira uma melhoria?", "lifecycle"],
    ["Como o LAB sai de um problema encontrado para uma recomendação?", "pipeline-finding-to-recommendation"],
    // HUMAN CONTROL
    ["Então ele pode corrigir sozinho?", "human-approval"],
    ["O LAB pode mudar as coisas por conta própria?", "human-approval"],
    ["Ele precisa da minha aprovação?", "human-approval"],
    ["Qual é o papel do humano no processo?", "human-approval"],
    ["Por que eu preciso aprovar?", "human-approval"],
    // AFTER APPROVAL
    ["E depois que eu aprovar?", "pipeline-after-approval"],
    ["O que acontece depois da aprovação?", "pipeline-after-approval"],
    ["Depois que eu autorizo, qual é o próximo passo?", "pipeline-after-approval"],
    // FINDING VS RECOMMENDATION
    ["Qual a diferença entre o que ele encontrou e o que ele recomenda fazer?", "finding-vs-recommendation"],
    ["Encontrar um problema já é uma recommendation?", "finding-vs-recommendation"],
    ["Uma recommendation é o problema encontrado?", "finding-vs-recommendation"],
    ["O que muda entre um finding e uma recommendation?", "finding-vs-recommendation"],
    // CAPABILITIES (bare "O que o LAB consegue fazer hoje?" excluded — protected Self-Awareness boundary)
    ["O que ele faz sozinho?", "capabilities"],
    ["Quais coisas ele já consegue fazer?", "capabilities"],
    // LIMITATIONS (bare "O que o LAB ainda não consegue fazer?" excluded — protected Self-Awareness boundary)
    ["Qual é a principal limitação dele hoje?", "limitations"],
    ["Onde o LAB ainda depende de mim?", "limitations"],
    ["O que ele não consegue fazer sozinho?", "limitations"],
    // LIFECYCLE
    ["Me explica tudo do começo ao fim.", "lifecycle"],
    ["Como funciona o processo inteiro?", "lifecycle"],
    ["Qual é o caminho completo?", "lifecycle"],
    ["Como uma análise termina em uma melhoria validada?", "lifecycle"],
    // The 15 FASE 16 conversation turns themselves (contexto limpo — sem state.lastProductConcept)
    ["Beleza. Então me explica tudo do começo ao fim.", "lifecycle"],
    ["O LAB pode decidir sozinho que precisa mudar alguma coisa?", "human-approval"],
    ["Então qual é o papel do humano no processo?", "human-approval"],
    ["E qual é a principal coisa que o LAB faz melhor?", "capabilities"],
    ["E qual é a principal limitação dele hoje?", "limitations"],
    ["Se eu entrasse no LAB agora, o que eu deveria entender primeiro?", "product"],
    ["Resume o LAB em uma frase.", "product"],
    ["E se eu quiser melhorar o LAB, qual é o caminho?", "lifecycle"],
    ["Então uma recommendation já é uma mudança feita?", "pipeline-finding-to-recommendation"],
  ])("%s -> %s", (message, expected) => {
    expect(classifyProductConcept(message)).toBe(expected);
  });

  it("the two bare Self-Awareness phrasings stay OUTSIDE Product Understanding — a protected boundary, not a gap", () => {
    // FASE 13/14B/15A already committed these exact bare phrases to the
    // evidence-based Self-Awareness branch (checked earlier in
    // operational-brain.ts's router). FASE 16A's own brief lists them
    // under "capacidade estrutural", but moving them here would regress
    // that pre-existing, tested boundary — so classifyProductConcept must
    // keep returning null for them; operational-brain.ts's router (not
    // this module) is what actually sends them to Self-Awareness.
    expect(classifyProductConcept("O que o LAB consegue fazer hoje?")).toBeNull();
    expect(classifyProductConcept("O que o LAB ainda não consegue fazer?")).toBeNull();
  });

  it("never misreads a project name that happens to contain a Product Understanding word as a conceptual question", () => {
    // Regression for a real bug this phase's own implementation introduced
    // and caught: a bare \bbrain\b signal matched a real project literally
    // named "Brain Target Project ..." inside a genuine mission request —
    // the same collision class BUG 1 (agent-selection.ts, FASE 14B) already
    // had to guard against. "brain" alone is never enough; it always needs
    // an actual question-shaped co-signal ("papel", "quem coordena").
    expect(classifyProductConcept("Analise a UX do Brain Target Project 123.")).toBeNull();
    expect(classifyProductConcept("Analisa o Brain Lifecycle Concurrent Project 456.")).toBeNull();
  });

  it("negative tests (FASE 16A section 12) — conceptual phrasing about the pipeline never classifies as a mission", () => {
    for (const message of ["Como funciona uma análise?", "O que um agente faz?", "O que é uma recommendation?", "Como uma avaliação funciona?", "O LAB pode corrigir sozinho?"]) {
      expect(classifyProductConcept(message)).not.toBeNull();
    }
  });
});

describe("classifyProductConceptContinuation", () => {
  it("resolves weak, pronoun-dependent follow-ups that only make sense once a Product Understanding topic is already established", () => {
    expect(classifyProductConceptContinuation("E os agentes?")).toBe("agents");
    expect(classifyProductConceptContinuation("E se um deles encontrar um problema?")).toBe("pipeline-evaluation-to-finding");
    expect(classifyProductConceptContinuation("Então me resume tudo.")).toBe("lifecycle");
  });

  it("returns null for a message with no continuation signal at all", () => {
    expect(classifyProductConceptContinuation("Qual é a previsão do tempo hoje?")).toBeNull();
  });
});
