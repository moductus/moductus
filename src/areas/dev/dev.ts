import type { Conexao, ItemGithub, SituacaoGithub } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import type { Leitura } from "../leitura.ts";
import { haQuanto } from "../tempo.ts";

/**
 * A área Dev (AreaDev.dc.html) lida do cache do GitHub que o serviço mantém (F2-25): PRs que
 * esperam seu review, os seus, e o que foi atribuído a você. Quem decide o que "precisa de você" é
 * o serviço (`precisaDeMim`); aqui só se separa em colunas e se diz em texto.
 */

export type IdColuna = "review" | "meus" | "atribuidos";

export interface ColunaDev {
  id: IdColuna;
  nome: string;
  /** Tom da contagem no alto da coluna: a de review chama atenção quando tem item. */
  tom: TomSelo;
  itens: ItemGithub[];
}

/**
 * As colunas do quadro, só com itens abertos e na ordem do serviço (precisa de você primeiro). A
 * quarta coluna do quadro, CI das branches principais, fica de fora: o contrato não traz esse
 * tipo de item (F2-25); o CI quebrado dos seus PRs aparece em "Seus PRs".
 */
export function colunasDoGithub(itens: readonly ItemGithub[]): ColunaDev[] {
  const abertos = itens.filter((i) => i.estado === "aberto");
  const review = abertos.filter((i) => i.tipo === "pr" && i.meuPapel === "revisor");
  return [
    {
      id: "review",
      nome: "Esperando seu review",
      tom: review.length > 0 ? "aviso" : "neutro",
      itens: review,
    },
    {
      id: "meus",
      nome: "Seus PRs",
      tom: "neutro",
      itens: abertos.filter((i) => i.tipo === "pr" && i.meuPapel === "autor"),
    },
    {
      id: "atribuidos",
      nome: "Issues para você",
      tom: "neutro",
      itens: abertos.filter((i) => i.meuPapel === "atribuido"),
    },
  ];
}

/** `dono/api-pedidos` vira `api-pedidos`, como no quadro; o nome inteiro fica no título. */
export const repositorioCurto = (repositorio: string) => repositorio.split("/").at(-1) || repositorio;

/** "api-pedidos #412". */
export const referencia = (item: ItemGithub) => `${repositorioCurto(item.repositorio)} #${item.numero}`;

export interface SeloItem {
  texto: string;
  tom: TomSelo;
}

/** O selo do cartão: a situação que faz o item estar ali, com texto. */
export function seloDoItem(item: ItemGithub, coluna: IdColuna): SeloItem {
  if (coluna === "review") {
    // Review pedido a um time de que você faz parte aparece, mas não chama (cliente.ts do GitHub).
    return item.precisaDeMim
      ? { texto: "pedido a você", tom: "aviso" }
      : { texto: "pedido ao time", tom: "apagado" };
  }
  if (coluna === "atribuidos") return { texto: item.tipo === "issue" ? "issue" : "PR", tom: "neutro" };
  if (item.ciEstado === "falhou") return { texto: "CI falhou", tom: "perigo" };
  // Seu PR precisa de você sem CI quebrado: alguém pediu mudanças.
  if (item.precisaDeMim) return { texto: "mudanças pedidas", tom: "aviso" };
  if (item.ciEstado === "rodando") return { texto: "CI rodando", tom: "neutro" };
  if (item.ciEstado === "passou") return { texto: "CI passou", tom: "sucesso" };
  return { texto: "aberto", tom: "apagado" };
}

/** A linha de baixo do cartão: quem abriu (quando não é você) e a última mudança no GitHub. */
export function metaDoItem(item: ItemGithub, coluna: IdColuna, agora: Date): string {
  const partes: string[] = [];
  if (coluna !== "meus" && item.autor) partes.push(`de ${item.autor}`);
  if (item.atualizadoNoGithub) partes.push(`mudou ${haQuanto(item.atualizadoNoGithub, agora)}`);
  return partes.join(" · ");
}

/** A ordem em que o Nuno fala do que precisa de você: review, CI quebrado, mudanças, atribuídos. */
function prioridade(item: ItemGithub): number {
  if (item.meuPapel === "revisor") return 0;
  if (item.meuPapel === "autor") return item.ciEstado === "falhou" ? 1 : 2;
  return 3;
}

function fraseDoItem(item: ItemGithub): string {
  const ref = referencia(item);
  if (item.meuPapel === "revisor") return `O ${ref} espera seu review.`;
  if (item.meuPapel === "autor") {
    return item.ciEstado === "falhou" ? `O CI do seu ${ref} falhou.` : `Pediram mudanças no seu ${ref}.`;
  }
  return item.tipo === "issue"
    ? `A issue ${ref} está atribuída a você.`
    : `O PR ${ref} está atribuído a você.`;
}

/**
 * A fala do Nuno no alto da área, em até duas frases (AGENTS.md §2 Voz): o item mais urgente e
 * quantos mais precisam de você. Nada precisando, ele não fala.
 */
export function falaDoNuno(itens: readonly ItemGithub[]): string | null {
  const precisam = itens.filter((i) => i.estado === "aberto" && i.precisaDeMim);
  // Estável: dentro da mesma prioridade, vale a ordem do serviço (mais recente primeiro).
  const [primeiro] = [...precisam].sort((a, b) => prioridade(a) - prioridade(b));
  if (!primeiro) return null;
  const outros = precisam.length - 1;
  if (outros === 0) return fraseDoItem(primeiro);
  return `${fraseDoItem(primeiro)} Mais ${outros} ${outros === 1 ? "item precisa" : "itens precisam"} de você.`;
}

/** "4 repositórios · atualizado há 2 min", no alto da área. */
export function situacaoDaLeitura(situacao: SituacaoGithub, agora: Date): string {
  const abertos = situacao.itens.filter((i) => i.estado === "aberto");
  const repositorios = new Set(abertos.map((i) => i.repositorio)).size;
  const quantos = `${repositorios} ${repositorios === 1 ? "repositório" : "repositórios"}`;
  const quando = situacao.atualizadoEm
    ? `atualizado ${haQuanto(situacao.atualizadoEm, agora)}`
    : "ainda não lido";
  return `${quantos} · ${quando}`;
}

export interface DadosDev {
  situacao: SituacaoGithub;
  /** A conexão do GitHub; `null` enquanto o serviço não disse. */
  conexao: Conexao | null;
}

/**
 * O cache do GitHub e a conexão dele, pelo canal: ao conectar (`github.obter`, `conexoes.listar`)
 * e a cada mudança (`github.mudou`, `conexoes.mudou`). A área não manda o serviço ir ao GitHub:
 * o vigia lê a cada 15 min. Sem conexão com o serviço, esperando; pedido recusado, falhou (com o
 * tentar de novo).
 */
export function useDadosDev(canal: EstadoConexao): Leitura<DadosDev> {
  const [situacao, setSituacao] = useState<SituacaoGithub | null>(null);
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const tentarDeNovo = useCallback(() => {
    setFalhou(false);
    setTentativa((n) => n + 1);
  }, []);
  // Aviso que chega com a carga a caminho é mais novo que ela: a carga não o desfaz.
  const chegou = useRef({ situacao: false, conexao: false });

  useEffect(() => {
    const paradas = [
      servico.ouvir("github.mudou", (s) => {
        chegou.current.situacao = true;
        setSituacao(s);
      }),
      servico.ouvir("conexoes.mudou", (c) => {
        if (c.tipo !== "github") return;
        chegou.current.conexao = true;
        setConexao(c);
      }),
    ];
    return () => paradas.forEach((parar) => parar());
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    const durante = { situacao: false, conexao: false };
    chegou.current = durante;
    Promise.all([servico.pedir("github.obter"), servico.pedir("conexoes.listar")])
      .then(([github, conexoes]) => {
        if (!vivo) return;
        if (!durante.situacao) setSituacao(github);
        if (!durante.conexao) setConexao(conexoes.find((c) => c.tipo === "github") ?? null);
      })
      .catch(() => {
        if (!vivo) return;
        setSituacao(null);
        setFalhou(true);
      });
    return () => {
      vivo = false;
      setSituacao(null);
      setFalhou(false);
    };
  }, [canal, tentativa]);

  if (canal !== "conectado") return { estado: "esperando" };
  if (situacao) return { estado: "pronta", dados: { situacao, conexao } };
  return falhou ? { estado: "falhou", tentarDeNovo } : { estado: "esperando" };
}
