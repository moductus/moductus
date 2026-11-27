// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { auditar, nomeAcessivel } from "../teste/acessibilidade.ts";
import { BarraOrcamento } from "./BarraOrcamento.tsx";
import { LinhaLancamento } from "./LinhaLancamento.tsx";
import { Lista } from "./ItemLista.tsx";
import { PrivacidadeContexto } from "./privacidade.ts";
import { TextoSensivel } from "./TextoSensivel.tsx";
import { falarCentavos, Valor } from "./Valor.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement | undefined;

function montar(no: ReactNode, privacidade = false) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  act(() => raiz!.render(<PrivacidadeContexto value={privacidade}>{no}</PrivacidadeContexto>));
  return recipiente;
}

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  recipiente = undefined;
});

/**
 * Os pedaços de texto de `el`, um por nó, separados por espaço. Para cada elemento, `ler` diz se
 * pula (`null`), se vale um texto no lugar dele (o nome de um ícone) ou se desce nos filhos.
 */
function pedacos(el: Element, ler: (no: Element) => string | null | undefined): string {
  const partes: string[] = [];
  const andar = (no: Node) => {
    if (no.nodeType === Node.TEXT_NODE) partes.push(no.textContent ?? "");
    if (!(no instanceof Element)) return;
    const lido = ler(no);
    if (lido === undefined) no.childNodes.forEach(andar);
    else if (lido !== null) partes.push(lido);
  };
  el.childNodes.forEach(andar);
  return partes
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

/** O que aparece na tela: o texto escondido por `visibility` e o do leitor de tela não contam. */
const textoNaTela = (el: Element) =>
  pedacos(el, (no) =>
    no.matches(".so-leitor, .sensivel[data-mascarado] > .sensivel-texto") ? null : undefined,
  );

/** O que o leitor de tela percorre numa linha: pula o `aria-hidden` e lê o nome dos ícones. */
const lidoNaLinha = (el: Element) =>
  pedacos(el, (no) =>
    no.getAttribute("aria-hidden") === "true" ? null : (no.getAttribute("aria-label") ?? undefined),
  );

describe("falarCentavos", () => {
  it("diz o valor em palavras, com o sinal", () => {
    expect(falarCentavos(-4500)).toBe("menos 45 reais");
    expect(falarCentavos(4500)).toBe("45 reais");
    expect(falarCentavos(1000, { sinal: true })).toBe("mais 10 reais");
    expect(falarCentavos(123456)).toBe("1.234 reais e 56 centavos");
    expect(falarCentavos(100)).toBe("1 real");
    expect(falarCentavos(-1)).toBe("menos 1 centavo");
    expect(falarCentavos(0, { sinal: true })).toBe("0 reais");
  });

  it("arredonda como a tela no sem centavos e dá nome a outra moeda", () => {
    expect(falarCentavos(123456, { semCentavos: true })).toBe("1.235 reais");
    expect(falarCentavos(-1999, { moeda: "USD" })).toMatch(/^menos 19,99 dólares/);
    expect(falarCentavos(100, { moeda: "EUR", semCentavos: true })).toBe("1 euro");
  });
});

describe("Valor", () => {
  it("mostra o formato do contrato e o leitor de tela lê em palavras, não o R$", () => {
    const tela = montar(<Valor centavos={-4500} />);
    const valor = tela.querySelector(".valor")!;
    expect(textoNaTela(valor)).toBe("− R$ 45,00");
    expect(nomeAcessivel(valor)).toBe("menos 45 reais");
    expect(valor.getAttribute("data-tom")).toBe("saida");
  });

  it("entrada com sinal leva o + e o tom de sucesso; transferência fica sem sinal", () => {
    const tela = montar(
      <>
        <Valor centavos={685000} sinal />
        <Valor centavos={-50000} sinal transferencia />
        <Valor centavos={821450} />
      </>,
    );
    const [entrada, transferencia, neutro] = [...tela.querySelectorAll(".valor")];
    expect(textoNaTela(entrada!)).toBe("+ R$ 6.850,00");
    expect(entrada!.getAttribute("data-tom")).toBe("entrada");
    expect(nomeAcessivel(entrada!)).toBe("mais 6.850 reais");
    expect(textoNaTela(transferencia!)).toBe("R$ 500,00");
    expect(transferencia!.getAttribute("data-tom")).toBe("transferencia");
    expect(textoNaTela(neutro!)).toBe("R$ 8.214,50");
    expect(neutro!.getAttribute("data-tom")).toBe("neutro");
  });

  it("com o modo privacidade, mostra R$ ••• no mesmo lugar e o leitor de tela não ouve o valor", () => {
    const tela = montar(<Valor centavos={-4500} />, true);
    const valor = tela.querySelector(".valor")!;
    expect(valor.hasAttribute("data-mascarado")).toBe(true);
    expect(textoNaTela(valor)).toBe("R$ •••");
    expect(nomeAcessivel(valor)).toBe("valor escondido");
    // O texto fica na célula, invisível, para a máscara não mudar o tamanho da linha.
    const escondido = valor.querySelector(".sensivel-texto")!;
    expect(escondido.textContent).toBe("− R$ 45,00");
    expect(escondido.getAttribute("aria-hidden")).toBe("true");
  });

  it("mascarado em outra moeda usa o símbolo dela", () => {
    const tela = montar(<Valor centavos={1999} moeda="USD" />, true);
    expect(textoNaTela(tela.querySelector(".valor")!)).toBe("US$ •••");
  });
});

describe("TextoSensivel", () => {
  it("é lido como está com o modo desligado e some da tela e do leitor com ele ligado", () => {
    const desligado = montar(<TextoSensivel>Mercado do bairro</TextoSensivel>);
    const texto = desligado.querySelector(".sensivel")!;
    expect(nomeAcessivel(texto)).toBe("Mercado do bairro");
    expect(texto.hasAttribute("data-mascarado")).toBe(false);
    act(() => raiz!.unmount());
    recipiente!.remove();

    const ligado = montar(<TextoSensivel>Mercado do bairro</TextoSensivel>, true);
    const mascarado = ligado.querySelector(".sensivel")!;
    expect(textoNaTela(mascarado)).toBe("•••••");
    expect(nomeAcessivel(mascarado)).toBe("texto escondido");
  });
});

describe("BarraOrcamento", () => {
  it("diz o percentual e a situação em texto, e a barra fica cheia quando passa", () => {
    const tela = montar(
      <BarraOrcamento
        nome="Compras"
        linha={{ gastoCentavos: 38000, limiteCentavos: 35000, percentual: 109, situacao: "estourado" }}
      />,
    );
    const barra = tela.querySelector(".barra-orcamento")!;
    expect(textoNaTela(barra)).toBe("Compras R$ 380 de R$ 350 · 109%, passou do limite");
    const progresso = barra.querySelector('[role="progressbar"]')!;
    expect(progresso.getAttribute("aria-label")).toBe("Orçamento de Compras");
    expect(progresso.getAttribute("aria-valuenow")).toBe("100");
    expect(progresso.getAttribute("aria-valuetext")).toBe("109%, passou do limite");
    expect(progresso.className).toContain("progresso--perigo");
  });

  it("dentro do previsto mostra só o percentual; mascarada, esconde os valores e mantém o percentual", () => {
    const tela = montar(
      <BarraOrcamento
        nome="Transporte"
        linha={{ gastoCentavos: 18800, limiteCentavos: 40000, percentual: 47, situacao: "ok" }}
      />,
      true,
    );
    const barra = tela.querySelector(".barra-orcamento")!;
    expect(textoNaTela(barra)).toBe("Transporte R$ ••• de R$ ••• · 47%");
    expect(barra.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe("47%");
  });
});

describe("LinhaLancamento", () => {
  const BASE = {
    moeda: "BRL",
    parcelaNumero: null,
    parcelaTotal: null,
    transferenciaId: null,
    conciliado: false,
  };

  it("mostra descrição, parcela, categoria, origem, conta e valor", () => {
    const tela = montar(
      <Lista>
        <LinhaLancamento
          lancamento={{
            ...BASE,
            descricao: "Notebook",
            valorCentavos: -28990,
            parcelaNumero: 3,
            parcelaTotal: 10,
            conciliado: true,
          }}
          categoria="Compras"
          origem="importado do Nubank em 12/11"
          conta="Cartão Nubank"
        />
      </Lista>,
    );
    const linha = tela.querySelector(".linha-lancamento")!;
    expect(textoNaTela(linha)).toBe(
      "Notebook 3/10 Compras · importado do Nubank em 12/11 conciliado Cartão Nubank − R$ 289,90",
    );
    expect(lidoNaLinha(linha)).toBe(
      "Notebook parcela 3 de 10 Compras importado do Nubank em 12/11 conciliado Cartão Nubank menos 289 reais e 90 centavos",
    );
    expect(auditar(tela)).toEqual([]);
  });

  it("sem categoria aparece marcado; receita leva +; a cabeça do agente é decorativa", () => {
    const tela = montar(
      <Lista>
        <LinhaLancamento
          lancamento={{ ...BASE, descricao: "PAG*JOSEFA ARTES", valorCentavos: -6400 }}
          categoria={null}
          origem="importado do Nubank hoje"
        />
        <LinhaLancamento
          lancamento={{ ...BASE, descricao: "Pix recebido", valorCentavos: 15000 }}
          categoria="Renda"
          origem="Tula leu o extrato"
          agente="tula"
        />
      </Lista>,
    );
    const [semCategoria, receita] = [...tela.querySelectorAll(".linha-lancamento")];
    expect(semCategoria!.querySelector(".linha-lancamento-sem-categoria")?.textContent).toBe("sem categoria");
    expect(textoNaTela(receita!.querySelector(".valor")!)).toBe("+ R$ 150,00");
    expect(receita!.querySelector(".linha-lancamento-agente")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("transferência tem o ícone com nome, não pede categoria e não tem sinal", () => {
    const tela = montar(
      <Lista>
        <LinhaLancamento
          lancamento={{
            ...BASE,
            descricao: "Nubank → Poupança",
            valorCentavos: -50000,
            transferenciaId: "t1",
          }}
          categoria={null}
          origem="você · 10:05"
        />
      </Lista>,
    );
    const linha = tela.querySelector(".linha-lancamento")!;
    expect(linha.querySelector(".linha-lancamento-sem-categoria")).toBeNull();
    expect(lidoNaLinha(linha)).toBe("Transferência Nubank → Poupança você · 10:05 500 reais");
  });

  it("com o modo privacidade, descrição, conta e valor somem; categoria e origem ficam", () => {
    const tela = montar(
      <Lista>
        <LinhaLancamento
          lancamento={{ ...BASE, descricao: "Farmácia", valorCentavos: -4180 }}
          categoria="Saúde"
          origem="importado do Nubank hoje"
          conta="Cartão Nubank"
        />
      </Lista>,
      true,
    );
    const linha = tela.querySelector(".linha-lancamento")!;
    expect(textoNaTela(linha)).toBe("••••• Saúde · importado do Nubank hoje ••••• R$ •••");
    const lido = lidoNaLinha(linha);
    expect(lido).not.toMatch(/Farmácia|Cartão|41|R\$/);
    expect(lido).toBe("texto escondido Saúde importado do Nubank hoje texto escondido valor escondido");
  });
});
