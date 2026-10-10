import type { Conexao, MudancaArquivo, SessaoIa, SituacaoGithub, TipoConexao } from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { mensagemDeErro } from "../../servico/conversas.ts";
import { servico, useCanal } from "../../servico/conexao.ts";

/** O pedido em andamento de cada conexão: a tela trava os botões dela e diz o que faz. */
export type Andamento = "previa" | "ligando" | "desligando" | "lendo";

export interface ConexoesDaTela {
  /** Null até o serviço responder. */
  claude: Conexao | null;
  github: Conexao | null;
  situacaoGithub: SituacaoGithub | null;
  sessoes: readonly SessaoIa[];
  /** A prévia do que ligar o Claude Code muda; `null` fechada. */
  previa: MudancaArquivo | null;
  andamento: Partial<Record<TipoConexao, Andamento>>;
  conectado: boolean;
  /** O motivo da última recusa do serviço, por conexão; some no próximo pedido dela. */
  erros: Partial<Record<TipoConexao, string>>;
  verPrevia: () => Promise<void>;
  fecharPrevia: () => void;
  ligar: (tipo: TipoConexao) => Promise<void>;
  desligar: (tipo: TipoConexao) => Promise<void>;
  lerGithub: () => Promise<void>;
}

/**
 * As conexões do Nuno pelo canal (F2-22, F2-25): o estado de cada uma, a prévia do Claude Code
 * antes do consentimento, o cache do GitHub e as sessões (para dizer quando chegou o último
 * evento). Acompanha `conexoes.mudou`, `github.mudou` e `sessoes.mudou` de qualquer janela.
 */
export function useConexoes(): ConexoesDaTela {
  const canal = useCanal(useServico({ silencioso: true }));
  const conectado = canal === "conectado";
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  const [situacaoGithub, setSituacaoGithub] = useState<SituacaoGithub | null>(null);
  const [sessoes, setSessoes] = useState<SessaoIa[]>([]);
  const [previa, setPrevia] = useState<MudancaArquivo | null>(null);
  const [andamento, setAndamento] = useState<Partial<Record<TipoConexao, Andamento>>>({});
  const [erros, setErros] = useState<Partial<Record<TipoConexao, string>>>({});

  const juntar = useCallback(
    (c: Conexao) =>
      setConexoes((lista) =>
        lista?.some((x) => x.tipo === c.tipo)
          ? lista.map((x) => (x.tipo === c.tipo ? c : x))
          : [...(lista ?? []), c],
      ),
    [],
  );

  useEffect(() => {
    const paradas = [
      servico.ouvir("conexoes.mudou", juntar),
      servico.ouvir("github.mudou", setSituacaoGithub),
      servico.ouvir("sessoes.mudou", ({ sessao }) =>
        setSessoes((lista) =>
          lista.some((s) => s.id === sessao.id)
            ? lista.map((s) => (s.id === sessao.id ? sessao : s))
            : [sessao, ...lista],
        ),
      ),
    ];
    return () => paradas.forEach((parar) => parar());
  }, [juntar]);

  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    servico
      .pedir("conexoes.listar")
      .then((lista) => vivo && setConexoes(lista))
      .catch(() => undefined);
    // O GitHub e as sessões só completam as linhas: sem resposta, elas dizem menos.
    servico
      .pedir("github.obter")
      .then((s) => vivo && setSituacaoGithub(s))
      .catch(() => undefined);
    servico
      .pedir("sessoes.listar")
      .then((l) => vivo && setSessoes(l.sessoes))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [conectado]);

  const fazer = useCallback(async (tipo: TipoConexao, passo: Andamento, pedido: () => Promise<void>) => {
    setAndamento((a) => ({ ...a, [tipo]: passo }));
    setErros((e) => ({ ...e, [tipo]: undefined }));
    try {
      await pedido();
    } catch (e) {
      setErros((atual) => ({ ...atual, [tipo]: mensagemDeErro(e) }));
    } finally {
      setAndamento((a) => ({ ...a, [tipo]: undefined }));
    }
  }, []);

  const verPrevia = useCallback(
    () =>
      fazer("hooks-claude-code", "previa", async () => {
        const r = await servico.pedir("conexoes.previa", { tipo: "hooks-claude-code" });
        setPrevia(r.arquivos[0] ?? null);
      }),
    [fazer],
  );

  const ligar = useCallback(
    (tipo: TipoConexao) =>
      fazer(tipo, "ligando", async () => {
        juntar(await servico.pedir("conexoes.ligar", { tipo }));
        if (tipo === "hooks-claude-code") setPrevia(null);
      }),
    [fazer, juntar],
  );

  const desligar = useCallback(
    (tipo: TipoConexao) =>
      fazer(tipo, "desligando", async () => {
        juntar(await servico.pedir("conexoes.desligar", { tipo }));
        // A prévia aberta ("Ver o que mudou") era do arquivo ligado: desligado, ela não vale mais.
        if (tipo === "hooks-claude-code") setPrevia(null);
      }),
    [fazer, juntar],
  );

  const lerGithub = useCallback(
    () =>
      fazer("github", "lendo", async () => {
        setSituacaoGithub(await servico.pedir("github.atualizar"));
      }),
    [fazer],
  );

  return {
    claude: conexoes?.find((c) => c.tipo === "hooks-claude-code") ?? null,
    github: conexoes?.find((c) => c.tipo === "github") ?? null,
    situacaoGithub,
    sessoes,
    previa,
    andamento,
    conectado,
    erros,
    verPrevia,
    fecharPrevia: () => setPrevia(null),
    ligar,
    desligar,
    lerGithub,
  };
}
