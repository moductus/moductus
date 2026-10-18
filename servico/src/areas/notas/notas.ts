import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  NOTA_BLOCO_RAPIDO,
  type Apagados,
  type MudancaNota,
  type MudancaNotas,
  type NovaNota,
  type Nota,
  type Origem,
  type PedidoBuscarNotas,
  type PedidoNota,
  type PedidoNotas,
  type PedidoSalvarNota,
  type ResultadoBuscaNota,
  type ResultadoSalvarNota,
  type ResumoNota,
} from "@moductus/contrato";
import { nomeChave } from "../../banco/nome-chave.ts";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { comecoDoTexto, consultaFts, encurtarPedacos, lerSnippet, trechoCorrido } from "./trecho.ts";

/**
 * Notas (PRODUCT.md §5 "Notas", DATA.md §4, ADR-0036): Markdown cru que salva sozinho com a versão
 * que a janela conhece, fixar, pasta, lixeira e a busca sem acento com o trecho que bateu. O bloco
 * rápido (migração 015) é a nota fixa do topo: fica sempre fixo, e apagar esvazia o texto em vez de
 * mandá-lo à lixeira.
 *
 * A versão da nota é o `atualizado_em`, e só o texto (título e conteúdo) o muda: fixar e trocar de
 * pasta não dependem dela (contrato `MudancaNota`), então não recusam o salvar de outra janela.
 */

export const MENSAGEM_NAO_ENCONTRADA = "nota não encontrada";
export const MENSAGEM_BLOCO_FIXO = "o bloco rápido fica sempre fixo no topo";
export const MENSAGEM_NOTA_DA_TAREFA = "a nota desta tarefa não existe mais";

/** Quantos resultados a busca traz quando o pedido não diz. */
const LIMITE_BUSCA = 20;
/** Palavras do trecho da busca em volta do que bateu (o máximo do FTS5 é 64). */
const PALAVRAS_DO_TRECHO = 20;
/** Quanto do conteúdo a lista lê para montar o começo do texto. */
const LEITURA_DO_COMECO = 600;
/** Peso de cada coluna do índice na ordem da busca (`id`, `titulo`, `conteudo`): o título vale mais. */
const PESOS_BM25 = "0.0, 5.0, 1.0";

interface LinhaNota {
  id: string;
  titulo: string;
  conteudo: string;
  fixada: number;
  pasta: string | null;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const COLUNAS =
  "id, titulo, conteudo, fixada, pasta, origem, agente_id, execucao_id, criado_em, atualizado_em";

const paraNota = (l: LinhaNota): Nota => ({
  id: l.id,
  titulo: l.titulo,
  conteudo: l.conteudo,
  fixada: l.fixada === 1,
  pasta: l.pasta,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

/** A nota na lista: o começo do texto no lugar do conteúdo. */
const paraResumo = (l: LinhaNota): ResumoNota => {
  const { conteudo, ...nota } = paraNota(l);
  return { ...nota, trecho: comecoDoTexto(conteudo) };
};

/** O bloco rápido primeiro, as outras fixadas, e da mais mexida para a mais parada. */
const ORDEM_DA_LISTA = `id = '${NOTA_BLOCO_RAPIDO}' DESC, fixada DESC, atualizado_em DESC, id DESC`;

export interface NovaLinhaNota {
  id: string;
  titulo: string;
  conteudo: string;
  fixada: boolean;
  pasta: string | null;
  agora: string;
}

/** Uma linha que bateu com a busca, com o trecho do conteúdo ainda com as marcas do FTS5. */
interface LinhaBusca extends LinhaNota {
  trecho: string;
}

/** `notas` e `notas_fts` (migração 015). O que está na lixeira não aparece. */
export class RepositorioNotas {
  constructor(private readonly db: DatabaseSync) {}

  /** Com `pasta`, só as dela. O conteúdo vem só até onde o começo do texto precisa. */
  lista(pasta: string | null): LinhaNota[] {
    const filtro = pasta === null ? "" : "AND pasta = ?";
    return this.db
      .prepare(
        `SELECT ${COLUNAS.replace("conteudo", `substr(conteudo, 1, ${LEITURA_DO_COMECO}) AS conteudo`)}
           FROM notas WHERE apagado_em IS NULL ${filtro} ORDER BY ${ORDEM_DA_LISTA}`,
      )
      .all(...(pasta === null ? [] : [pasta])) as unknown as LinhaNota[];
  }

  nota(id: string): Nota | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM notas WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaNota | undefined;
    return linha ? paraNota(linha) : null;
  }

  /** As pastas em uso, como foram escritas. */
  pastas(): string[] {
    const linhas = this.db
      .prepare(
        "SELECT DISTINCT pasta FROM notas WHERE pasta IS NOT NULL AND apagado_em IS NULL ORDER BY pasta",
      )
      .all() as { pasta: string }[];
    return linhas.map((l) => l.pasta);
  }

  criar(n: NovaLinhaNota, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO notas (id, titulo, conteudo, fixada, pasta, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        n.id,
        n.titulo,
        n.conteudo,
        n.fixada ? 1 : 0,
        n.pasta,
        n.agora,
        n.agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /**
   * Grava o texto só se a nota ainda está na `versao` dada: a conferência e a gravação são um
   * comando só. Diz se gravou.
   */
  salvarTexto(
    id: string,
    versao: string,
    texto: { titulo: string; conteudo: string },
    novaVersao: string,
    carimbo: Carimbo,
  ): boolean {
    const origem = colunasDeOrigem(carimbo);
    const r = this.db
      .prepare(
        `UPDATE notas SET titulo = ?, conteudo = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND atualizado_em = ? AND apagado_em IS NULL`,
      )
      .run(
        texto.titulo,
        texto.conteudo,
        novaVersao,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        id,
        versao,
      );
    return Number(r.changes) > 0;
  }

  /** Fixar e pasta: não mudam a versão do texto. */
  definir(id: string, campos: { fixada: boolean; pasta: string | null }, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE notas SET fixada = ?, pasta = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(campos.fixada ? 1 : 0, campos.pasta, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  /** Manda à lixeira; os gatilhos da 015 tiram a nota do índice da busca. */
  apagar(id: string, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE notas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  /**
   * As que batem com a consulta do FTS5, da mais relevante para a menos, com o trecho do conteúdo
   * em volta do que bateu entre `abre` e `fecha`. O índice só tem as vivas; a junção confere.
   */
  buscar(consulta: string, limite: number, abre: string, fecha: string): LinhaBusca[] {
    // O conteúdo inteiro não vem: o resultado mostra só o trecho.
    const colunas = COLUNAS.split(", ")
      .map((c) => (c === "conteudo" ? "'' AS conteudo" : `n.${c}`))
      .join(", ");
    return this.db
      .prepare(
        `SELECT ${colunas}, snippet(notas_fts, 2, ?, ?, '…', ${PALAVRAS_DO_TRECHO}) AS trecho
           FROM notas_fts JOIN notas n ON n.id = notas_fts.id
          WHERE notas_fts MATCH ? AND n.apagado_em IS NULL
          ORDER BY bm25(notas_fts, ${PESOS_BM25}), n.atualizado_em DESC, n.id DESC
          LIMIT ?`,
      )
      .all(abre, fecha, consulta, limite) as unknown as LinhaBusca[];
  }
}

export interface AvisosNotas {
  /** O que mudou, de qualquer janela ou ferramenta. */
  mudou: (mudanca: MudancaNotas) => void;
}

export interface OpcoesNotas {
  agora?: () => Date;
  gerarId?: () => string;
}

export class ServicoNotas {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;

  constructor(
    private readonly repo: RepositorioNotas,
    private readonly avisos: AvisosNotas,
    opcoes: OpcoesNotas = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  listar(pedido: PedidoNotas): ResumoNota[] {
    const pasta = pedido.pasta === undefined ? null : this.pastaConhecida(pedido.pasta);
    return this.repo.lista(pasta).map(paraResumo);
  }

  obter(pedido: PedidoNota): Nota {
    return this.exigir(pedido.id);
  }

  criar(nova: NovaNota, carimbo: Carimbo = DO_USUARIO): Nota {
    const id = this.gerarId();
    this.repo.criar(
      {
        id,
        titulo: nova.titulo ?? "",
        conteudo: nova.conteudo ?? "",
        fixada: nova.fixada ?? false,
        pasta: nova.pasta == null ? null : this.pastaConhecida(nova.pasta),
        agora: this.agora().toISOString(),
      },
      carimbo,
    );
    return this.avisar(this.exigir(id));
  }

  /**
   * Grava o texto se a nota ainda está na versão que a janela conhece (ADR-0036). Se mudou em outra
   * janela, nada é gravado e voltam as duas: a do banco e a que a janela mandou. Texto igual ao do
   * banco não grava nem conta como conflito: nada se perderia, e a versão não muda à toa.
   */
  salvar(pedido: PedidoSalvarNota, carimbo: Carimbo = DO_USUARIO): ResultadoSalvarNota {
    const atual = this.exigir(pedido.id);
    const texto = { titulo: pedido.titulo ?? atual.titulo, conteudo: pedido.conteudo ?? atual.conteudo };
    if (texto.titulo === atual.titulo && texto.conteudo === atual.conteudo)
      return { salvou: true, nota: atual };
    const versao = this.versaoDepoisDe(atual.atualizadoEm);
    if (!this.repo.salvarTexto(atual.id, pedido.versao, texto, versao, carimbo)) {
      return { salvou: false, atual, recusada: texto };
    }
    return { salvou: true, nota: this.avisar(this.exigir(atual.id)) };
  }

  /** Fixar e mudar de pasta. O bloco rápido não se desafixa: é a nota fixa do topo. */
  definir(mudanca: MudancaNota, carimbo: Carimbo = DO_USUARIO): Nota {
    const atual = this.exigir(mudanca.id);
    if (atual.id === NOTA_BLOCO_RAPIDO && mudanca.fixada === false) throw new Error(MENSAGEM_BLOCO_FIXO);
    const campos = {
      fixada: mudanca.fixada ?? atual.fixada,
      pasta:
        mudanca.pasta === undefined
          ? atual.pasta
          : mudanca.pasta === null
            ? null
            : this.pastaConhecida(mudanca.pasta),
    };
    if (campos.fixada === atual.fixada && campos.pasta === atual.pasta) return atual;
    this.repo.definir(atual.id, campos, carimbo);
    return this.avisar(this.exigir(atual.id));
  }

  /**
   * Manda à lixeira e devolve o que foi. O bloco rápido não vai: apagar esvazia o texto dele, com
   * versão nova, e nada sai.
   */
  apagar(pedido: PedidoNota, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigir(pedido.id);
    if (atual.id === NOTA_BLOCO_RAPIDO) {
      if (atual.conteudo !== "") {
        const texto = { titulo: atual.titulo, conteudo: "" };
        const versao = this.versaoDepoisDe(atual.atualizadoEm);
        if (this.repo.salvarTexto(atual.id, atual.atualizadoEm, texto, versao, carimbo)) {
          this.avisar(this.exigir(atual.id));
        }
      }
      return { ids: [] };
    }
    this.repo.apagar(atual.id, this.agora().toISOString(), carimbo);
    this.avisos.mudou({ notas: [], apagadas: [atual.id] });
    return { ids: [atual.id] };
  }

  /**
   * Busca sem acento e sem caixa no título e no conteúdo. O trecho é do conteúdo, em volta do que
   * bateu, com as posições do que bateu; quando só o título bateu, é o começo do conteúdo, sem
   * destaque.
   */
  buscar(pedido: PedidoBuscarNotas): ResultadoBuscaNota[] {
    const consulta = consultaFts(pedido.texto);
    if (consulta === null) return [];
    const abre = marcaSorteada();
    const fecha = marcaSorteada();
    return this.repo.buscar(consulta, pedido.limite ?? LIMITE_BUSCA, abre, fecha).map((linha) => {
      const { texto, destaques } = trechoCorrido(encurtarPedacos(lerSnippet(linha.trecho, abre, fecha)));
      return { ...paraResumo(linha), trecho: texto, destaques };
    });
  }

  /**
   * A nota de onde uma tarefa nasce (`tarefas.nota_id`, "Ligado a esta nota"): só uma nota viva.
   * Sem nota, `null`. As Tarefas (F3-15) chamam ao criar.
   */
  notaParaTarefa(notaId: string | null | undefined): string | null {
    if (notaId === null || notaId === undefined) return null;
    if (!this.repo.nota(notaId)) throw new Error(MENSAGEM_NOTA_DA_TAREFA);
    return notaId;
  }

  private exigir(id: string): Nota {
    const nota = this.repo.nota(id);
    if (!nota) throw new Error(MENSAGEM_NAO_ENCONTRADA);
    return nota;
  }

  private avisar(nota: Nota): Nota {
    this.avisos.mudou({ notas: [nota], apagadas: [] });
    return nota;
  }

  /**
   * A versão nova é sempre maior que a anterior, mesmo dois salvamentos no mesmo milissegundo ou
   * com o relógio voltando: versão repetida deixaria passar um salvar de quem estava atrasado.
   */
  private versaoDepoisDe(anterior: string): string {
    const agora = this.agora().getTime();
    const depois = Date.parse(anterior) + 1;
    return new Date(Math.max(agora, depois)).toISOString();
  }

  /** A pasta com a grafia que já está em uso, sem diferença de caixa nem de acento composto. */
  private pastaConhecida(pasta: string): string {
    const chave = nomeChave(pasta);
    return this.repo.pastas().find((p) => nomeChave(p) === chave) ?? pasta.trim();
  }
}

/** Uma marca que não aparece em texto de nota nenhuma: controle mais bytes sorteados. */
function marcaSorteada(): string {
  return `\u0001${randomBytes(8).toString("hex")}\u0001`;
}
