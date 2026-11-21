import markdownIt, { type StateCore, type Token } from "markdown-it";

/**
 * A leitura da nota (ADR-0036): o Markdown cru vira HTML pelo `markdown-it` sem HTML de quem
 * escreveu (`html: false` escapa qualquer marcação), sem imagem (nada busca fora do PC só porque
 * a nota foi aberta) e com link só para `https://`, o único que a casca abre (ADR-0038); o resto
 * fica texto. O link sai sem `href`, com o endereço em `data-endereco`: só a área o abre, pela
 * casca, e o WebView2 não tem como navegar nem abrir por conta própria.
 * A caixa de seleção (`- [ ]` e `- [x]`) é desenhada aqui, sem plugin. Este módulo só é carregado
 * pela área Notas do Sistema, por import dinâmico: o painel e o dock não levam o `markdown-it`.
 */

const md = markdownIt({ html: false, linkify: false, typographer: false, breaks: true });
md.disable("image");
md.validateLink = (endereco) => /^https:\/\//i.test(endereco.trim());

/** `[ ] ` ou `[x] ` no começo do item. */
const MARCA_CAIXA = /^\[([ xX])\]\s+/;

/**
 * Item de lista que começa com a caixa: o item ganha a classe e, feito, o `data-feita`; a marca
 * sai do texto e entra um quadrado com o estado para o leitor de tela.
 */
function caixasDeSelecao(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const item = tokens[i];
    if (item?.type !== "list_item_open") continue;
    // O texto do item vem logo depois do parágrafo (escondido nas listas apertadas).
    const inline = tokens[i + 2];
    if (tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const marca = MARCA_CAIXA.exec(inline.content);
    const primeiro = inline.children?.[0];
    if (!marca || primeiro?.type !== "text" || !MARCA_CAIXA.test(primeiro.content)) continue;
    const feita = marca[1] !== " ";
    primeiro.content = primeiro.content.replace(MARCA_CAIXA, "");
    inline.content = inline.content.replace(MARCA_CAIXA, "");
    item.attrJoin("class", "nota-item-caixa");
    if (feita) item.attrSet("data-feita", "");
    const caixa = new state.Token("html_inline", "", 0);
    caixa.content = `<span class="nota-caixa" role="img" aria-label="${feita ? "feito" : "a fazer"}"></span>`;
    inline.children?.unshift(caixa);
  }
}

md.core.ruler.after("inline", "caixas_de_selecao", caixasDeSelecao);

// Link da nota não navega a janela: sem `href`, focável e com papel de link; quem abre é a área.
md.renderer.rules.link_open = (tokens: Token[], idx, opcoes, _env, self) => {
  const token = tokens[idx];
  if (token) {
    const endereco = token.attrGet("href") ?? "";
    token.attrs = (token.attrs ?? []).filter(([nome]) => nome !== "href");
    token.attrSet("data-endereco", endereco);
    token.attrSet("role", "link");
    token.attrSet("tabindex", "0");
  }
  return self.renderToken(tokens, idx, opcoes);
};

/** O HTML da leitura de uma nota. */
export function renderizar(texto: string): string {
  return md.render(texto);
}
