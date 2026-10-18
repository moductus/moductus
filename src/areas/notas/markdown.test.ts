import { describe, expect, it } from "vitest";
import { renderizar } from "./markdown.ts";

describe("renderizar (ADR-0036)", () => {
  it("títulos, listas e ênfase viram HTML", () => {
    const html = renderizar("## Lugares\n\n- Trilha da **cachoeira**\n- Feira");
    expect(html).toContain("<h2>Lugares</h2>");
    expect(html).toContain("<li>Trilha da <strong>cachoeira</strong></li>");
  });

  it("HTML escrito na nota não vira marcação", () => {
    const html = renderizar('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("link só para https, sem href (só a área abre, pela casca), e imagem não busca nada fora", () => {
    const html = renderizar(
      "[banco](https://banco.exemplo) [velho](http://inseguro.exemplo) [x](javascript:alert(1)) [arq](file:///C:/a.txt) ![foto](https://rastreio.exemplo/p.png)",
    );
    expect(html).toContain('<a data-endereco="https://banco.exemplo" role="link" tabindex="0">banco</a>');
    expect(html).toContain("[velho](http://inseguro.exemplo)");
    expect(html).not.toContain("href=");
    expect(html).not.toContain('data-endereco="javascript');
    expect(html).not.toContain('data-endereco="file');
    expect(html).not.toContain("<img");
  });

  it("a caixa de seleção do Markdown aparece com o estado para o leitor de tela", () => {
    const html = renderizar("- [x] Reservar a pousada\n- [ ] Revisar o carro\n- item comum");
    expect(html).toContain(
      '<li class="nota-item-caixa" data-feita=""><span class="nota-caixa" role="img" aria-label="feito"></span>Reservar a pousada</li>',
    );
    expect(html).toContain(
      '<li class="nota-item-caixa"><span class="nota-caixa" role="img" aria-label="a fazer"></span>Revisar o carro</li>',
    );
    expect(html).toContain("<li>item comum</li>");
  });

  it("quebra de linha simples vale como no bloco rápido", () => {
    expect(renderizar("código do portão 4471\ntrocar filtro da água")).toBe(
      "<p>código do portão 4471<br>\ntrocar filtro da água</p>\n",
    );
  });
});
