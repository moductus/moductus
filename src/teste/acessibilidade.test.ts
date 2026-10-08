// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { auditar, marcos, nomeAcessivel, ordemDoTab } from "./acessibilidade.ts";

function html(conteudo: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = conteudo;
  document.body.replaceChildren(div);
  return div;
}

const motivos = (conteudo: string) => auditar(html(conteudo)).map((p) => p.motivo);

describe("checagem de acessibilidade (a própria régua)", () => {
  it("acha o nome pelo aria-label, pelo label, pelo texto e pela imagem dentro", () => {
    const raiz = html(`
      <button aria-label="Fechar"><svg aria-hidden="true"></svg></button>
      <label for="c">Buscar</label><input id="c">
      <label><input type="radio"> Começar do zero</label>
      <button>Salvar <span aria-hidden="true">→</span></button>
      <button><svg role="img" aria-label="Alba, dormindo"></svg></button>
      <span id="t">Faina</span><div role="group" aria-labelledby="t"></div>`);
    const [fechar, salvar, alba] = raiz.querySelectorAll("button");
    expect(nomeAcessivel(fechar!)).toBe("Fechar");
    expect(nomeAcessivel(raiz.querySelector("#c")!)).toBe("Buscar");
    expect(nomeAcessivel(raiz.querySelector('[type="radio"]')!)).toBe("Começar do zero");
    expect(nomeAcessivel(salvar!)).toBe("Salvar");
    expect(nomeAcessivel(alba!)).toBe("Alba, dormindo");
    expect(nomeAcessivel(raiz.querySelector('[role="group"]')!)).toBe("Faina");
    expect(auditar(raiz)).toEqual([]);
  });

  it("aponta cada tipo de falha", () => {
    expect(motivos("<button><svg aria-hidden='true'></svg></button>")).toEqual([
      "controle sem nome acessível",
    ]);
    expect(motivos("<button aria-label='x'><svg></svg></button>")).toEqual([
      "svg sem role=img nem aria-hidden",
    ]);
    expect(motivos("<button aria-label='x' aria-pressed='sim'></button>")).toEqual([
      'aria-pressed="sim" inválido',
    ]);
    expect(motivos("<button aria-label='x' tabindex='2'></button>")).toEqual([
      "tabindex 2 força a ordem do Tab",
    ]);
    expect(motivos("<div aria-hidden='true'><button>x</button></div>")).toEqual([
      "focável dentro de algo oculto do leitor de tela",
    ]);
    expect(motivos("<input aria-describedby='nada' aria-label='x'>")).toEqual([
      "aria-describedby aponta para #nada, que não existe",
    ]);
    expect(motivos("<nav><button>a</button></nav>")).toEqual(["grupo ou navegação sem nome"]);
    expect(
      motivos(
        "<nav aria-label='n'><button aria-current='page'>a</button><button aria-current='page'>b</button></nav>",
      ),
    ).toEqual(['2 itens com aria-current="page"']);
    expect(motivos("<span id='a'></span><span id='a'></span>")).toEqual(["id repetido 2 vezes"]);
    expect(motivos("<svg role='img'></svg>")).toEqual(["imagem sem nome"]);
  });

  it("título com tabindex -1 (foco por código) não é controle nem parada do Tab", () => {
    const raiz = html("<h1 tabindex='-1'>Passo</h1><button>Seguir</button><button disabled>Não</button>");
    expect(auditar(raiz)).toEqual([]);
    expect(ordemDoTab(raiz).map((e) => e.textContent)).toEqual(["Seguir"]);
  });

  it("lista os marcos com papel e nome; header dentro de main não é banner", () => {
    const raiz = html(`
      <header>Moductus</header><nav aria-label="Áreas"></nav>
      <aside aria-label="Configuração inicial"></aside>
      <main aria-labelledby="t"><header><h1 id="t">Seu time</h1></header></main>`);
    expect(marcos(raiz)).toEqual([
      "banner",
      "navigation: Áreas",
      "complementary: Configuração inicial",
      "main: Seu time",
    ]);
  });
});
