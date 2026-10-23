import type {
  Calendario,
  Conexao,
  MudancaArquivo,
  PedidoClienteGoogle,
  SessaoIa,
  SituacaoGithub,
  SituacaoGoogle,
  TipoConexao,
} from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { mensagemDeErro } from "../../servico/conversas.ts";
import { servico, useCanal } from "../../servico/conexao.ts";

/** O pedido em andamento de cada conexão: a tela trava os botões dela e diz o que faz. */
export type Andamento = "previa" | "ligando" | "desligando" | "lendo" | "cliente";

export interface ConexoesDaTela {
  /** Null até o serviço responder. */
  claude: Conexao | null;
  github: Conexao | null;
  google: Conexao | null;
  situacaoGithub: SituacaoGithub | null;
  /** O que o cartão do Google mostra além da conexão; null até o serviço responder. */
  situacaoGoogle: SituacaoGoogle | null;
  /** Os calendários do Google (o "Moductus" primeiro); o local fica fora. */
  calendarios: readonly Calendario[];
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
  lerGoogle: () => Promise<void>;
  /** "Cancelar" na espera do navegador: a conexão volta a como estava antes de conectar. */
  cancelarGoogle: () => Promise<void>;
  /** Marca ou desmarca um calendário do Google para a Alba ler. */
  lerCalendario: (id: string, ler: boolean) => Promise<void>;
  /** Salva o cliente OAuth do usuário (ou volta ao do Moductus com `null`). */
  definirClienteGoogle: (cliente: PedidoClienteGoogle["cliente"]) => Promise<boolean>;
}

/** Os do Google, com o "Moductus" na frente: é o que a Alba escreve sem pedir. */
const doGoogle = (lista: readonly Calendario[]) =>
  lista.filter((c) => c.fonte === "google").sort((a, b) => Number(b.espelho) - Number(a.espelho));

/**
 * As conexões pelo canal (F2-22, F2-25, F3-44): o estado de cada uma, a prévia do Claude Code
 * antes do consentimento, o cache do GitHub, as sessões (para dizer quando chegou o último
 * evento) e, do Google Agenda, a situação e os calendários. Acompanha `conexoes.mudou`,
 * `github.mudou`, `google.mudou`, `agenda.calendarios` e `sessoes.mudou` de qualquer janela.
 */
export function useConexoes(): ConexoesDaTela {
  const canal = useCanal(useServico({ silencioso: true }));
  const conectado = canal === "conectado";
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  const [situacaoGithub, setSituacaoGithub] = useState<SituacaoGithub | null>(null);
  const [situacaoGoogle, setSituacaoGoogle] = useState<SituacaoGoogle | null>(null);
  const [calendarios, setCalendarios] = useState<Calendario[]>([]);
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
      servico.ouvir("google.mudou", setSituacaoGoogle),
      servico.ouvir("agenda.calendarios", (lista) => setCalendarios(doGoogle(lista))),
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
    servico
      .pedir("google.obter")
      .then((s) => vivo && setSituacaoGoogle(s))
      .catch(() => undefined);
    servico
      .pedir("agenda.calendarios")
      .then((l) => vivo && setCalendarios(doGoogle(l)))
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

  const lerGoogle = useCallback(
    () =>
      fazer("google-agenda", "lendo", async () => {
        setSituacaoGoogle(await servico.pedir("google.atualizar"));
      }),
    [fazer],
  );

  // Não passa por `fazer`: o conectar ainda está em andamento e é ele que limpa o "ligando".
  const cancelarGoogle = useCallback(async () => {
    setErros((e) => ({ ...e, "google-agenda": undefined }));
    try {
      juntar(await servico.pedir("google.cancelar"));
    } catch (e) {
      setErros((atual) => ({ ...atual, "google-agenda": mensagemDeErro(e) }));
    }
  }, [juntar]);

  const lerCalendario = useCallback(async (id: string, ler: boolean) => {
    setErros((e) => ({ ...e, "google-agenda": undefined }));
    try {
      const calendario = await servico.pedir("agenda.definirCalendario", { id, ler });
      setCalendarios((lista) => lista.map((c) => (c.id === calendario.id ? calendario : c)));
    } catch (e) {
      setErros((atual) => ({ ...atual, "google-agenda": mensagemDeErro(e) }));
    }
  }, []);

  const definirClienteGoogle = useCallback(
    async (cliente: PedidoClienteGoogle["cliente"]) => {
      let salvou = false;
      await fazer("google-agenda", "cliente", async () => {
        setSituacaoGoogle(await servico.pedir("google.definirCliente", { cliente }));
        salvou = true;
      });
      return salvou;
    },
    [fazer],
  );

  return {
    claude: conexoes?.find((c) => c.tipo === "hooks-claude-code") ?? null,
    github: conexoes?.find((c) => c.tipo === "github") ?? null,
    google: conexoes?.find((c) => c.tipo === "google-agenda") ?? null,
    situacaoGithub,
    situacaoGoogle,
    calendarios,
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
    lerGoogle,
    cancelarGoogle,
    lerCalendario,
    definirClienteGoogle,
  };
}
