import type { Conexao, MudancaArquivo } from "@moductus/contrato";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { Selo, type TomSelo } from "../../componentes/Selo.tsx";
import { useAgora } from "../tempo.ts";
import {
  comandoDoErro,
  eventosDoMoductus,
  leituraGithub,
  linhasDaPrevia,
  resumoGithub,
  ultimoEventoClaude,
} from "./conexoes.ts";
import { Carregando } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConexoes, type ConexoesDaTela } from "./useConexoes.ts";
// Os cartões também aparecem no primeiro uso (passo Conexões), fora da área de Configurações.
import "./Configuracoes.css";

/**
 * Configurações › Conexões (ConfigConexoes, ConfigConexoesPrevia, ConfigConexoesErros e
 * ConfigConexoesVazio.dc.html): o que os agentes alcançam fora do Moductus. Ligar o Claude Code
 * mostra antes o que muda no settings.json e só grava com o sim; o GitHub vai pelo gh já logado.
 */
export function SecaoConexoes() {
  const conexoes = useConexoes();
  if (!conexoes.claude || !conexoes.github) {
    return (
      <Secao titulo="Conexões">
        <Carregando />
      </Secao>
    );
  }
  const nenhuma = conexoes.claude.estado === "desligada" && conexoes.github.estado === "desligada";
  return (
    <Secao titulo="Conexões">
      <p className="config-intro">
        O que os agentes alcançam fora do Moductus. Tudo opcional, e desligar desfaz o que a conexão mudou.
      </p>
      {nenhuma && !conexoes.previa && (
        <div className="config-conexao config-conexao--fala">
          <FalaAgente agente="nuno" tamanho="dock">
            Sem conexão, eu não vejo suas sessões de IA nem o GitHub. Dá para ligar uma de cada vez, e
            desligar desfaz tudo.
          </FalaAgente>
        </div>
      )}
      <CartaoClaudeCode conexoes={conexoes} />
      <CartaoGithub conexoes={conexoes} />
      <CartaoOpenCode />
      <p className="config-nota">
        Desligar o Claude Code tira só os hooks do Moductus e devolve o bloco hooks como estava antes. Os seus
        continuam lá.
      </p>
    </Secao>
  );
}

const SELO_LIGACAO: Readonly<Record<Conexao["estado"], { tom: TomSelo }>> = {
  ligada: { tom: "sucesso" },
  desligada: { tom: "apagado" },
  erro: { tom: "perigo" },
};

interface PropsCartao {
  nome: string;
  /** O selo do estado: o texto diz, a cor acompanha. */
  estado: { texto: string; tom: TomSelo } | null;
  descricao: string;
  acoes?: ReactNode;
  emBreve?: boolean;
  children?: ReactNode;
}

/** Um cartão de conexão: a cabeça do Nuno, o nome, para quem é, o estado e as ações à direita. */
function CartaoConexao({ nome, estado, descricao, acoes, emBreve, children }: PropsCartao) {
  const idNome = useId();
  return (
    <section className="config-conexao" aria-labelledby={idNome}>
      <div className="config-conexao-topo">
        <Personagem agente="nuno" modo="cabeca" tamanho="dock" estado="ocioso" />
        <span className="config-conexao-textos">
          <span className="config-conexao-linha">
            <h3 id={idNome} className="config-conexao-nome">
              {nome}
            </h3>
            <span className="config-conexao-quem">para o Nuno</span>
            {estado && (
              <Selo forma="ponto" tom={estado.tom}>
                {estado.texto}
              </Selo>
            )}
            {emBreve && <Selo>em breve</Selo>}
          </span>
          <span className="config-conexao-descricao">{descricao}</span>
        </span>
        {acoes && <span className="config-conexao-acoes">{acoes}</span>}
      </div>
      {children && <div className="config-conexao-corpo">{children}</div>}
    </section>
  );
}

/** Uma coluna do resumo de uma conexão ligada: rótulo pequeno e o valor. */
function Dado({ rotulo, children, mono }: { rotulo: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="config-conexao-dado">
      <dt>{rotulo}</dt>
      <dd data-mono={mono || undefined} title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

/* ---------- Claude Code ---------- */

const DESCRICAO_CLAUDE =
  "Hooks no settings.json: cada sessão avisa o dock, e os pedidos de permissão chegam até você.";

export function CartaoClaudeCode({ conexoes }: { conexoes: ConexoesDaTela }) {
  const agora = useAgora();
  const [vendo, setVendo] = useState(false);
  const { claude, previa, andamento } = conexoes;
  if (!claude) return null;
  const ocupado = andamento["hooks-claude-code"] !== undefined || !conexoes.conectado;
  const erro = conexoes.erros["hooks-claude-code"] ?? (claude.estado === "erro" ? claude.ultimoErro : null);
  const estado = { texto: claude.estado, ...SELO_LIGACAO[claude.estado] };

  if (previa && claude.estado !== "ligada") {
    return (
      <CartaoConexao nome="Claude Code" estado={estado} descricao={DESCRICAO_CLAUDE}>
        <PreviaClaudeCode
          previa={previa}
          ocupado={ocupado}
          ligando={andamento["hooks-claude-code"] === "ligando"}
          erro={conexoes.erros["hooks-claude-code"] ?? null}
          aoCancelar={conexoes.fecharPrevia}
          aoLigar={() => void conexoes.ligar("hooks-claude-code")}
        />
      </CartaoConexao>
    );
  }

  if (claude.estado === "ligada") {
    const ligacao = claude.ligacao;
    return (
      <CartaoConexao
        nome="Claude Code"
        estado={{ texto: "ligada", tom: "sucesso" }}
        descricao={DESCRICAO_CLAUDE}
        acoes={
          <>
            <Botao
              variante="fantasma"
              disabled={ocupado}
              onClick={() => void conexoes.desligar("hooks-claude-code")}
            >
              {andamento["hooks-claude-code"] === "desligando" ? "Desligando…" : "Desligar"}
            </Botao>
            <Botao
              disabled={ocupado}
              aria-expanded={vendo}
              onClick={() => {
                if (!vendo) void conexoes.verPrevia();
                setVendo((v) => !v);
              }}
            >
              Ver o que mudou
            </Botao>
          </>
        }
      >
        <dl className="config-conexao-dados">
          <Dado rotulo="Arquivo" mono>
            {ligacao?.caminho ?? "settings.json"}
          </Dado>
          <Dado rotulo="Hooks">
            {ligacao ? `${ligacao.eventos} eventos · porta ${ligacao.porta}` : "ligados"}
          </Dado>
          <Dado rotulo="Cópia de antes" mono>
            {ligacao?.copia ?? "nenhuma: o arquivo não existia"}
          </Dado>
          <Dado rotulo="Último evento">{ultimoEventoClaude(conexoes.sessoes, agora)}</Dado>
        </dl>
        {vendo && previa && <BlocoHooks titulo="Bloco hooks de agora" linhas={semMarca(previa.depois)} />}
        {erro && <p className="config-conexao-erro">{erro}</p>}
      </CartaoConexao>
    );
  }

  return (
    <CartaoConexao
      nome="Claude Code"
      estado={estado}
      descricao={DESCRICAO_CLAUDE}
      acoes={
        <Botao variante="primario" disabled={ocupado} onClick={() => void conexoes.verPrevia()}>
          {claude.estado === "erro" ? "Tentar de novo" : "Ver o que muda"}
        </Botao>
      }
    >
      {erro && <p className="config-conexao-erro">{erro}</p>}
    </CartaoConexao>
  );
}

interface PropsPrevia {
  previa: MudancaArquivo;
  ocupado: boolean;
  ligando: boolean;
  erro: string | null;
  aoCancelar: () => void;
  aoLigar: () => void;
}

/**
 * O que ligar muda, antes do sim (ConfigConexoesPrevia.dc.html): só o bloco hooks, antes e depois,
 * com as linhas novas marcadas. Nada é gravado até o botão, que diz quantos hooks entram.
 */
export function PreviaClaudeCode({ previa, ocupado, ligando, erro, aoCancelar, aoLigar }: PropsPrevia) {
  const eventos = eventosDoMoductus(previa.depois);
  const linhas = linhasDaPrevia(previa.antes, previa.depois);
  const novas = linhas.filter((l) => l.nova).length;
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // O Esc fecha só a prévia: no primeiro uso, não volta um passo.
      e.stopPropagation();
      // Ligando, o arquivo já está sendo escrito: o Esc não finge que cancelou.
      if (!ligando) aoCancelar();
    }
  };
  return (
    <div className="config-previa" onKeyDown={aoTeclar}>
      <FalaAgente agente="nuno" tamanho="lista">
        Vou mudar só o bloco hooks do seu settings.json: {eventos} eventos passam a avisar o Moductus. Os seus
        hooks continuam como estão.
      </FalaAgente>
      <p className="config-previa-arquivo">
        <span>Arquivo</span>
        <code className="config-conexao-comando">{previa.caminho}</code>
        <span>· o resto do arquivo não muda</span>
      </p>
      <div className="config-previa-blocos">
        <BlocoHooks
          titulo="Antes · bloco hooks"
          contagem={previa.antes === null ? "não existe" : `${previa.antes.split("\n").length} linhas`}
          linhas={semMarca(previa.antes ?? "")}
        />
        <BlocoHooks
          titulo="Depois · bloco hooks"
          contagem={`${linhas.length} linhas · ${novas} novas`}
          linhas={linhas}
        />
      </div>
      <p className="config-nota config-previa-seguranca">
        <Icone nome="escudo" tamanho={14} />
        <span>
          Antes de gravar, guardo uma cópia ao lado do arquivo, e desligar devolve o bloco hooks como era. O
          token não vai no arquivo: o Claude Code lê da variável <code>MODUCTUS_HOOKS_TOKEN</code>.
        </span>
      </p>
      {erro && (
        <p role="alert" className="config-conexao-erro">
          {erro}
        </p>
      )}
      <div className="config-rodape">
        <Botao variante="fantasma" disabled={ligando} aria-keyshortcuts="Escape" onClick={aoCancelar}>
          Agora não
        </Botao>
        <Botao variante="primario" disabled={ocupado} onClick={aoLigar}>
          {ligando ? "Ligando…" : `Ligar ${eventos} hooks no Claude Code`}
        </Botao>
      </div>
    </div>
  );
}

/** O bloco como está, sem marcar nada como novo. */
const semMarca = (texto: string) => texto.split("\n").map((linha) => ({ texto: linha, nova: false }));

/** Um bloco de JSON com as linhas novas marcadas (cor e "+", nunca só a cor). Rola por dentro. */
function BlocoHooks({
  titulo,
  contagem,
  linhas,
}: {
  titulo: string;
  contagem?: string;
  linhas: readonly { texto: string; nova: boolean }[];
}) {
  const id = useId();
  return (
    <figure className="config-bloco" aria-labelledby={id}>
      <figcaption id={id} className="config-bloco-titulo">
        <span>{titulo}</span>
        {contagem && <span className="config-bloco-contagem">{contagem}</span>}
      </figcaption>
      {/* Rola por dentro com o teclado: o bloco recebe foco. */}
      <pre className="config-bloco-codigo" tabIndex={0} aria-label={titulo}>
        {linhas.map((l, i) => (
          <span key={i} className="config-bloco-linha" data-nova={l.nova || undefined}>
            <span className="config-bloco-marca" aria-hidden="true">
              {l.nova ? "+" : " "}
            </span>
            {l.texto}
            {"\n"}
          </span>
        ))}
      </pre>
    </figure>
  );
}

/* ---------- GitHub ---------- */

export function CartaoGithub({ conexoes }: { conexoes: ConexoesDaTela }) {
  const agora = useAgora();
  const [copiado, setCopiado] = useState(false);
  const { github, andamento, situacaoGithub } = conexoes;
  if (!github) return null;
  const passo = andamento.github;
  const ocupado = passo !== undefined || !conexoes.conectado;
  const erro = conexoes.erros.github ?? (github.estado === "erro" ? github.ultimoErro : null);

  if (passo === "ligando") {
    return (
      <CartaoConexao
        nome="GitHub"
        estado={{ texto: "conectando", tom: "neutro" }}
        descricao="Conferindo o gh e lendo PRs, issues e CI. Leva alguns segundos."
        acoes={<span className="config-conexao-trilho" aria-hidden="true" />}
      />
    );
  }

  if (github.estado === "ligada") {
    const resumo = resumoGithub(situacaoGithub?.itens ?? []);
    return (
      <CartaoConexao
        nome="GitHub"
        estado={{ texto: "conectado", tom: "sucesso" }}
        descricao="Pelo GitHub CLI (gh), com o login que você já fez nele. O Moductus nunca vê o token."
        acoes={
          <>
            <Botao variante="fantasma" disabled={ocupado} onClick={() => void conexoes.desligar("github")}>
              {passo === "desligando" ? "Desconectando…" : "Desconectar"}
            </Botao>
            <Botao disabled={ocupado} onClick={() => void conexoes.lerGithub()}>
              {passo === "lendo" ? "Lendo…" : "Ler agora"}
            </Botao>
          </>
        }
      >
        <dl className="config-conexao-dados">
          <Dado rotulo="Conta">{github.conta ?? "—"}</Dado>
          <Dado rotulo="Leitura">{leituraGithub(situacaoGithub?.atualizadoEm ?? null, agora)}</Dado>
          <Dado rotulo="Esperando você">{resumo.esperando}</Dado>
          <Dado rotulo="No seu código">{resumo.codigo}</Dado>
        </dl>
        {erro && <p className="config-conexao-erro">{erro}</p>}
      </CartaoConexao>
    );
  }

  const comando = comandoDoErro(erro);
  const copiar = (texto: string) => {
    void navigator.clipboard
      ?.writeText(texto)
      .then(() => setCopiado(true))
      .catch(() => setCopiado(false));
  };
  return (
    <CartaoConexao
      nome="GitHub"
      estado={
        github.estado === "erro" || conexoes.erros.github
          ? { texto: "erro", tom: "perigo" }
          : { texto: "desligado", tom: "apagado" }
      }
      descricao={
        erro
          ? "Pelo GitHub CLI (gh), com o login que você já fez nele. O Moductus nunca vê o token."
          : "Precisa do GitHub CLI (gh) instalado e com login feito. O Moductus nunca vê o token."
      }
      acoes={
        <>
          {comando && (
            <Botao disabled={ocupado} onClick={() => copiar(comando)}>
              {copiado ? "Comando copiado" : "Copiar o comando"}
            </Botao>
          )}
          <Botao
            variante={erro ? "primario" : "secundario"}
            disabled={ocupado}
            onClick={() => void conexoes.ligar("github")}
          >
            {erro ? "Conectar de novo" : "Conectar"}
          </Botao>
        </>
      }
    >
      {erro && (
        <>
          <p className="config-conexao-erro">{erro}</p>
          {comando && <code className="config-conexao-comando">{comando}</code>}
        </>
      )}
    </CartaoConexao>
  );
}

/* ---------- OpenCode ---------- */

/** O plugin existe no serviço, mas ligar por aqui ainda não (AGENTS.md §5): só o aviso. */
export function CartaoOpenCode() {
  return (
    <CartaoConexao
      nome="OpenCode"
      estado={null}
      emBreve
      descricao="O plugin do Moductus para o OpenCode já existe. Ligar por aqui chega numa próxima versão."
    />
  );
}
