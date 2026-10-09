/**
 * Checagem de acessibilidade dos testes de cada superfície (dock, painel, Sistema, primeiro uso,
 * captura): nome acessível em todo controle, estados ARIA válidos, referências que existem,
 * nada focável escondido do leitor de tela e nenhuma ordem de Tab forçada. Segue o cálculo de
 * nome do accname (rótulo por id, aria-label, <label>, texto, title) no que a interface usa.
 */

const INTERATIVOS = [
  "button",
  "a[href]",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
  "[tabindex]",
].join(", ");

const BOOLEANOS = ["aria-pressed", "aria-checked", "aria-expanded", "aria-selected"];
const VALORES_BOOLEANOS = new Set(["true", "false", "mixed"]);
const VALORES_CURRENT = new Set(["page", "step", "location", "date", "time", "true", "false"]);

export interface Problema {
  elemento: string;
  motivo: string;
}

const oculto = (el: Element) => el.closest('[aria-hidden="true"], [hidden]') !== null;

/** Texto que o leitor de tela lê dentro de um elemento: pula o que está oculto para ele. */
function textoLido(no: Node): string {
  if (no.nodeType === Node.TEXT_NODE) return no.textContent ?? "";
  if (!(no instanceof Element)) return "";
  if (no.getAttribute("aria-hidden") === "true" || no.hasAttribute("hidden")) return "";
  const rotulo = no.getAttribute("aria-label");
  if (rotulo) return rotulo;
  if (no.tagName === "IMG") return no.getAttribute("alt") ?? "";
  return Array.from(no.childNodes, textoLido).join("");
}

const limpo = (texto: string) => texto.replace(/\s+/g, " ").trim();

/** Nome acessível de um elemento, como o leitor de tela anuncia. */
export function nomeAcessivel(el: Element): string {
  const documento = el.ownerDocument;
  const por = el.getAttribute("aria-labelledby");
  if (por) {
    const nome = limpo(
      por
        .split(/\s+/)
        .map((id) => documento.getElementById(id))
        .map((alvo) => (alvo ? textoLido(alvo) : ""))
        .join(" "),
    );
    if (nome) return nome;
  }
  const rotulo = limpo(el.getAttribute("aria-label") ?? "");
  if (rotulo) return rotulo;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    const porId = el.id ? documento.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const label = porId ?? el.closest("label");
    if (label) {
      // O texto do <label> sem o próprio campo (rádio dentro do cartão).
      const copia = label.cloneNode(true) as Element;
      copia.querySelectorAll("input, select, textarea").forEach((c) => c.remove());
      const nome = limpo(textoLido(copia));
      if (nome) return nome;
    }
    if (el instanceof HTMLInputElement && el.placeholder) return limpo(el.placeholder);
  } else {
    const nome = limpo(textoLido(el));
    if (nome) return nome;
  }
  return limpo(el.getAttribute("title") ?? "");
}

function descrever(el: Element): string {
  const html = el.outerHTML.replace(/\s+/g, " ");
  return html.length > 90 ? `${html.slice(0, 90)}…` : html;
}

/** Problemas de acessibilidade dentro de `raiz`; lista vazia quando está tudo certo. */
export function auditar(raiz: ParentNode): Problema[] {
  const problemas: Problema[] = [];
  const anotar = (el: Element, motivo: string) => problemas.push({ elemento: descrever(el), motivo });
  const documento = (raiz instanceof Document ? raiz : (raiz as Element).ownerDocument) as Document;

  for (const el of raiz.querySelectorAll(INTERATIVOS)) {
    const indice = el.getAttribute("tabindex");
    if (indice !== null && Number(indice) > 0) anotar(el, `tabindex ${indice} força a ordem do Tab`);
    const focavel = !(el as HTMLButtonElement).disabled && indice !== "-1";
    // Título com tabindex -1 recebe foco por código (passo novo), não pelo Tab: não é controle.
    const controle = !el.matches("[tabindex]") || el.matches(INTERATIVOS.replace(", [tabindex]", ""));
    if (oculto(el)) {
      if (focavel) anotar(el, "focável dentro de algo oculto do leitor de tela");
      continue;
    }
    if (controle && !nomeAcessivel(el)) anotar(el, "controle sem nome acessível");
  }

  for (const el of raiz.querySelectorAll("*")) {
    for (const atributo of BOOLEANOS) {
      const valor = el.getAttribute(atributo);
      if (valor !== null && !VALORES_BOOLEANOS.has(valor)) anotar(el, `${atributo}="${valor}" inválido`);
    }
    const atual = el.getAttribute("aria-current");
    if (atual !== null && !VALORES_CURRENT.has(atual)) anotar(el, `aria-current="${atual}" inválido`);
    for (const atributo of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
      for (const id of (el.getAttribute(atributo) ?? "").split(/\s+/).filter(Boolean)) {
        if (!documento.getElementById(id)) anotar(el, `${atributo} aponta para #${id}, que não existe`);
      }
    }
    if (el instanceof HTMLLabelElement && el.htmlFor && !documento.getElementById(el.htmlFor)) {
      anotar(el, `label for="${el.htmlFor}" sem campo`);
    }
    if (oculto(el)) continue;
    const role = el.getAttribute("role");
    if (role === "img" && !nomeAcessivel(el)) anotar(el, "imagem sem nome");
    if (el.tagName === "svg" && role !== "img") anotar(el, "svg sem role=img nem aria-hidden");
    // Grupos e navegações sem nome viram "grupo" e "navegação" soltos no leitor de tela.
    if (
      (el.tagName === "NAV" || role === "group" || role === "radiogroup") &&
      !el.getAttribute("aria-label")
    ) {
      if (!el.getAttribute("aria-labelledby")) anotar(el, "grupo ou navegação sem nome");
    }
  }

  // Um item "página atual" por navegação.
  for (const nav of raiz.querySelectorAll("nav")) {
    const atuais = nav.querySelectorAll('[aria-current="page"]').length;
    if (atuais > 1) anotar(nav, `${atuais} itens com aria-current="page"`);
  }

  const ids = new Map<string, number>();
  for (const el of raiz.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids)
    if (n > 1) problemas.push({ elemento: `#${id}`, motivo: `id repetido ${n} vezes` });

  return problemas;
}

/** Marcos da página como o leitor de tela lista: papel e nome ("main: Captura"). */
export function marcos(raiz: ParentNode): string[] {
  const papeis: [string, string][] = [
    ["main", "main"],
    ["nav", "navigation"],
    ["aside", "complementary"],
  ];
  const lista: string[] = [];
  for (const el of raiz.querySelectorAll("main, nav, aside, header, [role]")) {
    if (oculto(el)) continue;
    const explicito = el.getAttribute("role");
    let papel = explicito ?? papeis.find(([tag]) => el.tagName.toLowerCase() === tag)?.[1];
    // <header> só é banner fora de main, section e article.
    if (
      !papel &&
      el.tagName === "HEADER" &&
      !el.parentElement?.closest("main, section, article, aside, nav")
    ) {
      papel = "banner";
    }
    if (
      !papel ||
      !["main", "navigation", "complementary", "banner", "contentinfo", "search"].includes(papel)
    ) {
      continue;
    }
    const nome =
      el.getAttribute("aria-label") ?? (el.hasAttribute("aria-labelledby") ? nomeAcessivel(el) : "");
    lista.push(nome ? `${papel}: ${nome}` : papel);
  }
  return lista;
}

/** Elementos que o Tab visita, na ordem do documento (sem tabindex positivo, é a ordem do Tab). */
export function ordemDoTab(raiz: ParentNode): Element[] {
  return Array.from(raiz.querySelectorAll(INTERATIVOS)).filter(
    (el) =>
      !oculto(el) &&
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute("tabindex") !== "-1" &&
      el.getAttribute("aria-disabled") !== "true",
  );
}
