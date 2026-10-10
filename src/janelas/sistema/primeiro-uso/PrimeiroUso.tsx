import {
  CONFIG_PADRAO,
  PASSOS_PRIMEIRO_USO,
  type Config,
  type ConfigDock,
  type EstadoPrimeiroUso,
  type FimDoPasso,
  type MudancaConfig,
  type PassoPrimeiroUso,
  type ProvedorDetectado,
  type Tema,
} from "@moductus/contrato";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import type { Destino } from "../../../areas/areas.ts";
import { Botao } from "../../../componentes/Botao.tsx";
import { Campo } from "../../../componentes/Campo.tsx";
import { Icone } from "../../../componentes/Icone.tsx";
import { Personagem } from "../../../componentes/personagem/Personagem.tsx";
import type { Agente, EstadoPersonagem } from "../../../componentes/personagem/agentes.ts";
import { Selo } from "../../../componentes/Selo.tsx";
import { Seletor, type OpcaoSeletor } from "../../../componentes/Seletor.tsx";
import { servico } from "../../../servico/conexao.ts";
import {
  CLIS,
  formatarLatencia,
  MODELO_INICIAL,
  novoDaApi,
  situacaoDoCli,
  type EscolhaModelo,
  type EstadoModelo,
  type TipoApi,
} from "./modelo.ts";
import "./PrimeiroUso.css";

/** Nome de cada passo na lateral (Uso1Boas…Uso5Conexoes.dc.html). */
export const NOMES_PASSOS: Readonly<Record<PassoPrimeiroUso, string>> = {
  "boas-vindas": "Boas-vindas",
  "tema-dock": "Tema e dock",
  modelo: "Modelo",
  time: "Conhecer o time",
  conexoes: "Conexões",
};

type Origem = "zero" | "outro-pc";
type Fins = Partial<Record<PassoPrimeiroUso, FimDoPasso>>;

interface PropsPrimeiroUso {
  /** Recebe o estado gravado pelo serviço e para onde o Sistema vai em seguida. */
  aoConcluir: (estado: EstadoPrimeiroUso, destino: Destino) => void;
}

/**
 * Configuração do primeiro uso, no lugar das áreas até ser concluída ou pulada. As escolhas de
 * tema e dock gravam na hora pela configuração do serviço (a prévia é a própria tela); o fim
 * grava como cada passo terminou. Esc volta um passo; Enter numa opção segue adiante.
 */
export function PrimeiroUso({ aoConcluir }: PropsPrimeiroUso) {
  const [indice, setIndice] = useState(0);
  const [fins, setFins] = useState<Fins>({});
  const [origem, setOrigem] = useState<Origem>("zero");
  const [config, setConfig] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [modelo, setModelo] = useState<EstadoModelo>(MODELO_INICIAL);
  const modeloPronto = modelo.resultado.fase === "ok";
  const titulo = useRef<HTMLHeadingElement>(null);
  const idTitulo = useId();

  const passo = PASSOS_PRIMEIRO_USO[indice]!;
  const ultimo = indice === PASSOS_PRIMEIRO_USO.length - 1;

  useEffect(() => servico.ouvir("config.mudou", (estado) => setConfig(estado.config)), []);
  useEffect(() => {
    servico
      .pedir("config.obter")
      .then((estado) => setConfig(estado.config))
      .catch(() => undefined);
  }, []);

  // Passo novo: o foco vai ao título, o leitor de tela anuncia e o Tab segue dali.
  useEffect(() => titulo.current?.focus(), [indice]);

  const concluir = (finais: Fins, destino: Destino) => {
    setGravando(true);
    setErro(null);
    servico
      .pedir("primeiroUso.concluir", { passos: finais })
      .then((estado) => aoConcluir(estado, destino))
      .catch((e: unknown) => {
        setGravando(false);
        setErro(`Não deu para gravar a configuração (${mensagem(e)}). Tente de novo.`);
      });
  };

  const avancar = () => {
    if (gravando) return;
    // "Depois" no modelo: nenhum passou no teste, o passo conta como pulado.
    const novos: Fins = { ...fins, [passo]: passo === "modelo" && !modeloPronto ? "pulado" : "feito" };
    setFins(novos);
    if (passo === "boas-vindas" && origem === "outro-pc") {
      concluir(novos, { area: "configuracoes", secao: "outro-pc" });
    } else if (ultimo) {
      concluir(novos, { area: "inicio" });
    } else {
      setErro(null);
      setIndice(indice + 1);
    }
  };

  const voltar = () => {
    if (indice === 0 || gravando) return;
    setErro(null);
    setIndice(indice - 1);
  };

  const definir = (mudanca: MudancaConfig) => {
    setErro(null);
    setConfig((atual) => (atual ? { ...atual, ...mudanca } : atual));
    servico
      .pedir("config.definir", mudanca)
      .then((estado) => setConfig(estado.config))
      .catch((e: unknown) => {
        setErro(`O Moductus não aplicou essa escolha (${mensagem(e)}).`);
        servico
          .pedir("config.obter")
          .then((estado) => setConfig(estado.config))
          .catch(() => undefined);
      });
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && indice > 0) {
      e.preventDefault();
      voltar();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type === "radio") {
      e.preventDefault();
      avancar();
    }
  };

  const rotuloAvancar =
    passo === "boas-vindas"
      ? origem === "outro-pc"
        ? "Importar o arquivo"
        : "Começar"
      : passo === "modelo" && !modeloPronto
        ? "Depois"
        : ultimo
          ? "Concluir"
          : "Continuar";

  const cabecalho = { idTitulo, refTitulo: titulo };

  return (
    <div className="uso" onKeyDown={aoTeclar}>
      <aside className="uso-lateral" aria-label="Configuração inicial">
        <p className="uso-rotulo">Configuração</p>
        <ol className="uso-passos">
          {PASSOS_PRIMEIRO_USO.map((p, i) => {
            const marca = i < indice ? "feito" : i === indice ? "atual" : "futuro";
            return (
              <li
                key={p}
                className="uso-passo"
                data-estado={marca}
                aria-current={i === indice ? "step" : undefined}
              >
                <span className="uso-passo-marca" aria-hidden="true">
                  {i < indice ? "✓" : i + 1}
                </span>
                <span>{NOMES_PASSOS[p]}</span>
                {i < indice && <span className="so-leitor">, visto</span>}
              </li>
            );
          })}
        </ol>
        <p className="uso-rotulo uso-rotulo--depois">Depois</p>
        <div className="uso-passo" data-estado="depois">
          <span className="uso-passo-marca" aria-hidden="true">
            {PASSOS_PRIMEIRO_USO.length + 1}
          </span>
          <span>Primeiros passos</span>
        </div>
        <p className="uso-rotulo uso-lateral-pe">
          Leva uns 3 minutos. Tudo aqui muda depois em Configurações.
        </p>
      </aside>

      {/* O conteúdo principal da janela enquanto configura: o leitor de tela pula direto para cá. */}
      <main className="uso-conteudo" aria-labelledby={idTitulo} data-passo={passo}>
        <div className="uso-corpo">
          {passo === "boas-vindas" && <BoasVindas {...cabecalho} origem={origem} aoMudar={setOrigem} />}
          {passo === "tema-dock" && <TemaDock {...cabecalho} config={config} definir={definir} />}
          {passo === "modelo" && <Modelo {...cabecalho} estado={modelo} mudar={setModelo} />}
          {passo === "time" && <Time {...cabecalho} />}
          {passo === "conexoes" && <Conexoes {...cabecalho} />}
          {erro && (
            <p className="uso-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <footer className="uso-rodape">
          <span className="uso-rotulo" aria-live="polite">
            Passo {indice + 1} de {PASSOS_PRIMEIRO_USO.length}
          </span>
          <span className="uso-espaco" />
          <Botao variante="fantasma" disabled={gravando} onClick={() => concluir(fins, { area: "inicio" })}>
            Pular configuração
          </Botao>
          {indice > 0 && (
            <Botao disabled={gravando} aria-keyshortcuts="Escape" onClick={voltar}>
              Voltar
            </Botao>
          )}
          <Botao variante="primario" disabled={gravando} onClick={avancar}>
            {rotuloAvancar}
          </Botao>
        </footer>
      </main>
    </div>
  );
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface PropsCabecalho {
  idTitulo: string;
  refTitulo: Ref<HTMLHeadingElement>;
}

function Cabecalho({
  idTitulo,
  refTitulo,
  rotulo,
  titulo,
  children,
}: PropsCabecalho & { rotulo: string; titulo: string; children: ReactNode }) {
  return (
    <header className="uso-cabecalho">
      <span className="uso-rotulo">{rotulo}</span>
      <h1 id={idTitulo} ref={refTitulo} className="uso-titulo" tabIndex={-1}>
        {titulo}
      </h1>
      <p className="uso-texto">{children}</p>
    </header>
  );
}

/* ---------- 1. Boas-vindas ---------- */

const TIME_BOAS_VINDAS: readonly [Agente, EstadoPersonagem][] = [
  ["alba", "ocioso"],
  ["tula", "ocioso"],
  ["faina", "esperando"],
  ["nuno", "ocioso"],
];

function BoasVindas({
  origem,
  aoMudar,
  ...cabecalho
}: PropsCabecalho & { origem: Origem; aoMudar: (o: Origem) => void }) {
  return (
    <>
      <div className="uso-boas-vindas" aria-hidden="true">
        {TIME_BOAS_VINDAS.map(([agente, estado]) => (
          <Personagem key={agente} agente={agente} modo="inteiro" tamanho="boasVindas" estado={estado} />
        ))}
      </div>
      <Cabecalho {...cabecalho} rotulo="Boas-vindas" titulo="Seu time no PC">
        Quatro agentes cuidam do seu dia, do seu dinheiro, dos seus arquivos e das suas sessões de IA. Eles
        ficam no dock, sempre ligados, e pedem sua aprovação antes de agir fora do Moductus.
      </Cabecalho>
      <fieldset className="uso-opcoes">
        <legend className="so-leitor">Como começar</legend>
        <Opcao
          nome="origem"
          marcada={origem === "zero"}
          aoMarcar={() => aoMudar("zero")}
          titulo="Começar do zero"
          texto="Você escolhe tema, modelo e conexões nos próximos passos."
        />
        <Opcao
          nome="origem"
          marcada={origem === "outro-pc"}
          aoMarcar={() => aoMudar("outro-pc")}
          titulo="Já uso em outro PC"
          texto={
            <>
              Abra o arquivo <code className="uso-codigo">.moductus</code> exportado no outro PC, em Levar
              para outro PC. O que ele já traz não precisa ser escolhido de novo.
            </>
          }
        />
      </fieldset>
      <p className="uso-aviso">
        <Icone nome="escudo" tamanho={14} />
        Tudo fica neste PC. Nada sai daqui sem você conectar um serviço.
      </p>
    </>
  );
}

interface PropsOpcao {
  nome: string;
  marcada: boolean;
  aoMarcar: () => void;
  titulo: string;
  texto: ReactNode;
  desativada?: boolean;
  /** Prévia acima do título (os temas). */
  previa?: ReactNode;
  /** Selo ao lado do título (o estado de cada modelo). */
  selo?: ReactNode;
}

/** Cartão de opção com rádio de verdade: Tab entra no grupo, as setas trocam, Enter segue. */
function Opcao({ nome, marcada, aoMarcar, titulo, texto, desativada, previa, selo }: PropsOpcao) {
  const id = useId();
  return (
    <label className="uso-opcao" data-marcada={marcada}>
      {previa}
      <span className="uso-opcao-linha">
        <input
          type="radio"
          name={nome}
          checked={marcada}
          disabled={desativada}
          onChange={aoMarcar}
          aria-describedby={`${id}-texto`}
        />
        <span className="uso-opcao-titulo">{titulo}</span>
        {selo}
      </span>
      <span id={`${id}-texto`} className="uso-opcao-texto">
        {texto}
      </span>
    </label>
  );
}

/* ---------- 2. Tema e dock ---------- */

const TEMAS: readonly { valor: Tema; nome: string; texto: string }[] = [
  { valor: "automatico", nome: "Automático", texto: "Grafite no escuro, Papel no claro" },
  { valor: "grafite", nome: "Grafite", texto: "Escuro e denso" },
  { valor: "papel", nome: "Papel", texto: "Claro, papel e tinta" },
  { valor: "vidro", nome: "Vidro", texto: "Translúcido, Windows 11" },
];

const LADOS: readonly OpcaoSeletor<ConfigDock["lado"]>[] = [
  { valor: "esquerda", rotulo: "Esquerda" },
  { valor: "direita", rotulo: "Direita" },
];
const MODOS: readonly OpcaoSeletor<ConfigDock["modo"]>[] = [
  { valor: "fixo", rotulo: "Fixo" },
  { valor: "esconder", rotulo: "Esconder" },
  { valor: "inteligente", rotulo: "Inteligente" },
];
const FORMAS: readonly OpcaoSeletor<ConfigDock["forma"]>[] = [
  { valor: "colada", rotulo: "Colado" },
  { valor: "flutuante", rotulo: "Flutuante" },
];

function TemaDock({
  config,
  definir,
  ...cabecalho
}: PropsCabecalho & { config: Config | null; definir: (m: MudancaConfig) => void }) {
  const dock = config?.dock ?? CONFIG_PADRAO.dock;
  const semServico = config === null;
  const opcoes = <T extends string>(lista: readonly OpcaoSeletor<T>[]) =>
    semServico ? lista.map((o) => ({ ...o, desativada: true })) : lista;
  const mudarDock = (mudanca: Partial<ConfigDock>) => definir({ dock: { ...dock, ...mudanca } });

  return (
    <>
      <Cabecalho {...cabecalho} rotulo="Tema e dock" titulo="Como o Moductus fica na sua tela">
        A prévia muda na hora. Dá para trocar a qualquer momento em Configurações.
      </Cabecalho>
      <fieldset className="uso-opcoes uso-opcoes--temas">
        <legend className="so-leitor">Tema</legend>
        {TEMAS.map((t) => (
          <Opcao
            key={t.valor}
            nome="tema"
            marcada={config?.tema === t.valor}
            desativada={semServico}
            aoMarcar={() => definir({ tema: t.valor })}
            titulo={t.nome}
            texto={t.texto}
            previa={<PreviaTema tema={t.valor} />}
          />
        ))}
      </fieldset>
      <div className="uso-ajustes">
        <div className="uso-ajuste">
          <span className="uso-rotulo">Lado do dock</span>
          <Seletor
            rotulo="Lado do dock"
            opcoes={opcoes(LADOS)}
            valor={dock.lado}
            aoMudar={(lado) => mudarDock({ lado })}
          />
        </div>
        <div className="uso-ajuste">
          <span className="uso-rotulo">Comportamento</span>
          <Seletor
            rotulo="Comportamento do dock"
            opcoes={opcoes(MODOS)}
            valor={dock.modo}
            aoMudar={(modo) => mudarDock({ modo })}
          />
        </div>
        <div className="uso-ajuste">
          <span className="uso-rotulo">Forma</span>
          <Seletor
            rotulo="Forma do dock"
            opcoes={opcoes(FORMAS)}
            valor={dock.forma}
            aoMudar={(forma) => mudarDock({ forma })}
          />
        </div>
      </div>
      <p className="uso-rotulo">
        Fixo reserva a faixa da tela, e as janelas maximizadas param antes dele. Em tela cheia, ele some
        sozinho.
      </p>
    </>
  );
}

/** Miniatura do tema com as cores do próprio tema (data-tema por escopo). */
function PreviaTema({ tema }: { tema: Tema }) {
  return (
    <span className="uso-previa" aria-hidden="true">
      {tema === "automatico" ? (
        <>
          <MiniTela tema="grafite" />
          <MiniTela tema="papel" />
        </>
      ) : (
        <MiniTela tema={tema} />
      )}
    </span>
  );
}

function MiniTela({ tema }: { tema: Exclude<Tema, "automatico"> }) {
  return (
    <span className="uso-previa-tela" data-tema={tema}>
      <span className="uso-previa-dock">
        <span className="uso-previa-ponto uso-previa-ponto--ativo" />
        <span className="uso-previa-ponto" />
        <span className="uso-previa-ponto" />
      </span>
      <span className="uso-previa-painel">
        <span className="uso-previa-linha uso-previa-linha--forte" />
        <span className="uso-previa-linha" />
        <span className="uso-previa-linha" />
      </span>
    </span>
  );
}

/* ---------- 3. Modelo ---------- */

const TIPOS_API: readonly OpcaoSeletor<TipoApi>[] = [
  { valor: "openai", rotulo: "OpenAI" },
  { valor: "openai-compativel", rotulo: "Compatível com OpenAI" },
];

interface PropsModelo extends PropsCabecalho {
  estado: EstadoModelo;
  mudar: Dispatch<SetStateAction<EstadoModelo>>;
}

/**
 * Conectar um modelo (PRODUCT.md §5): os CLIs que o serviço achou no PC, ou uma chave de API, e um
 * teste de verdade, só quando o usuário pede. O provedor que passa vai para os quatro agentes (o
 * serviço faz isso); trocar de escolha e testar de novo tira o que este passo tinha criado.
 */
function Modelo({ estado, mudar, ...cabecalho }: PropsModelo) {
  const [detectados, setDetectados] = useState<ProvedorDetectado[] | null>(null);
  const [erroDeteccao, setErroDeteccao] = useState<string | null>(null);
  // Cada "Procurar de novo" é uma rodada: depois de instalar ou entrar no CLI, sem reabrir nada.
  const [rodada, setRodada] = useState(0);
  const { escolha, formulario, resultado } = estado;
  const testando = resultado.fase === "testando";

  useEffect(() => {
    let vivo = true;
    setDetectados(null);
    setErroDeteccao(null);
    servico
      .pedir("provedores.detectar")
      .then((achados) => {
        if (!vivo) return;
        setDetectados(achados);
        // Sem escolha ainda, fica o primeiro CLI que dá para usar.
        const pronto = CLIS.find(
          (c) =>
            situacaoDoCli(
              c.nome,
              achados.find((a) => a.tipo === c.tipo),
            ).escolhivel,
        );
        if (pronto) mudar((e) => (e.escolha === null ? { ...e, escolha: pronto.tipo } : e));
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setDetectados([]);
        setErroDeteccao(`Não deu para procurar os CLIs (${mensagem(e)}). Uma chave de API ainda funciona.`);
      });
    return () => {
      vivo = false;
    };
  }, [rodada, mudar]);

  const escolher = (nova: EscolhaModelo) =>
    mudar((e) => (e.escolha === nova ? e : { ...e, escolha: nova, resultado: { fase: "parado" } }));
  const mudarFormulario = (mudanca: Partial<EstadoModelo["formulario"]>) =>
    mudar((e) => ({ ...e, formulario: { ...e.formulario, ...mudanca }, resultado: { fase: "parado" } }));

  const nomeDaEscolha =
    escolha === "api"
      ? novoDaApi(formulario).nome
      : (CLIS.find((c) => c.tipo === escolha)?.nome ?? "o modelo");

  const testar = async () => {
    if (!escolha || testando) return;
    const nome = nomeDaEscolha;
    mudar((e) => ({ ...e, resultado: { fase: "testando", nome } }));
    try {
      const anterior = estado.criadoAqui;
      let id: string;
      if (escolha === "api") {
        // A chave vai junto do provedor novo; o de antes, deste passo, sai.
        if (anterior) await servico.pedir("provedores.remover", { id: anterior });
        id = (await servico.pedir("provedores.criar", novoDaApi(formulario))).id;
      } else {
        const existente = (await servico.pedir("provedores.listar")).find((p) => p.tipo === escolha);
        if (anterior && anterior !== existente?.id)
          await servico.pedir("provedores.remover", { id: anterior });
        id = existente?.id ?? (await servico.pedir("provedores.criar", { tipo: escolha, nome })).id;
      }
      mudar((e) => ({ ...e, criadoAqui: id }));
      const r = await servico.pedir("provedores.testar", { id });
      mudar((e) => ({
        ...e,
        resultado: r.ok
          ? { fase: "ok", nome, latenciaMs: r.latenciaMs, assinatura: escolha !== "api" }
          : { fase: "falhou", nome, mensagem: r.falha.mensagem },
      }));
    } catch (e) {
      mudar((atual) => ({ ...atual, resultado: { fase: "falhou", nome, mensagem: mensagem(e) } }));
    }
  };

  return (
    <>
      <Cabecalho {...cabecalho} rotulo="Modelo" titulo="Qual IA move os agentes">
        Os quatro usam o mesmo modelo no começo. Depois você troca por agente.{" "}
        {detectados === null ? "Procurando no seu PC…" : "Achei estes no seu PC:"}
      </Cabecalho>
      <fieldset className="uso-opcoes uso-opcoes--lista" aria-busy={detectados === null}>
        <legend className="so-leitor">Modelo</legend>
        {CLIS.map((c) => {
          const situacao =
            detectados === null
              ? {
                  estado: "procurando",
                  tom: "neutro" as const,
                  texto: "Procurando no PATH…",
                  escolhivel: false,
                }
              : situacaoDoCli(
                  c.nome,
                  detectados.find((d) => d.tipo === c.tipo),
                );
          return (
            <Opcao
              key={c.tipo}
              nome="modelo"
              marcada={escolha === c.tipo}
              desativada={!situacao.escolhivel || testando}
              aoMarcar={() => escolher(c.tipo)}
              titulo={c.nome}
              selo={<Selo tom={situacao.tom}>{situacao.estado}</Selo>}
              texto={situacao.texto}
            />
          );
        })}
        <Opcao
          nome="modelo"
          marcada={escolha === "api"}
          desativada={testando}
          aoMarcar={() => escolher("api")}
          titulo="Chave de API"
          texto="OpenAI ou compatível com OpenAI (Ollama, OpenRouter, LM Studio) · paga por uso"
        />
      </fieldset>
      {erroDeteccao && (
        <p className="uso-erro" role="alert">
          {erroDeteccao}
        </p>
      )}
      {detectados !== null && (
        <div className="uso-procurar">
          <Botao
            variante="fantasma"
            tamanho="pequeno"
            disabled={testando}
            onClick={() => setRodada((n) => n + 1)}
          >
            Procurar de novo
          </Botao>
        </div>
      )}
      {escolha === "api" && (
        <div className="uso-api">
          <div className="uso-ajuste">
            <span className="uso-rotulo">Provedor</span>
            <Seletor
              rotulo="Provedor da chave"
              opcoes={TIPOS_API}
              valor={formulario.tipo}
              aoMudar={(tipo) => mudarFormulario({ tipo })}
            />
          </div>
          {formulario.tipo === "openai-compativel" && (
            <Campo
              rotulo="Endereço (base_url)"
              placeholder="http://localhost:11434/v1"
              value={formulario.baseUrl}
              disabled={testando}
              onChange={(e) => mudarFormulario({ baseUrl: e.target.value })}
            />
          )}
          <Campo
            rotulo="Modelo"
            placeholder={formulario.tipo === "openai" ? "gpt-5-mini" : "qwen3:8b"}
            value={formulario.modelo}
            disabled={testando}
            onChange={(e) => mudarFormulario({ modelo: e.target.value })}
          />
          <Campo
            rotulo="Chave"
            type="password"
            autoComplete="off"
            dica={
              formulario.tipo === "openai"
                ? "Fica no Gerenciador de Credenciais do Windows."
                : "Opcional para modelo local. Fica no Gerenciador de Credenciais do Windows."
            }
            value={formulario.chave}
            disabled={testando}
            onChange={(e) => mudarFormulario({ chave: e.target.value })}
          />
        </div>
      )}
      <ResultadoDoTeste estado={estado} aoTestar={() => void testar()} />
    </>
  );
}

/** A nota do Nuno embaixo da lista: o que testar, o teste rodando ou o que deu. */
function ResultadoDoTeste({ estado, aoTestar }: { estado: EstadoModelo; aoTestar: () => void }) {
  const { resultado, escolha } = estado;
  const botao = (rotulo: string) => (
    <Botao tamanho="pequeno" disabled={escolha === null} onClick={aoTestar}>
      {rotulo}
    </Botao>
  );
  return (
    <div className="uso-nota" aria-live="polite">
      {resultado.fase === "parado" && (
        <>
          <Personagem agente="nuno" modo="cabeca" tamanho="painel" estado="ocioso" />
          <span className="uso-item-texto">
            <span className="uso-item-nome">Um teste de verdade antes de seguir</span>
            <span className="uso-rotulo">
              Uma chamada curta ao modelo escolhido, para ver se ele responde. Só roda quando você pede.
            </span>
          </span>
          {botao("Testar")}
        </>
      )}
      {resultado.fase === "testando" && (
        <>
          <Personagem agente="nuno" modo="cabeca" tamanho="painel" estado="trabalhando" />
          <span className="uso-item-texto">
            <span className="uso-item-nome">Testando {resultado.nome}…</span>
            <span className="uso-rotulo">Uma pergunta curta, esperando a resposta inteira.</span>
          </span>
          <Selo>testando</Selo>
        </>
      )}
      {resultado.fase === "ok" && (
        <>
          <Personagem agente="nuno" modo="cabeca" tamanho="painel" estado="ocioso" />
          <span className="uso-item-texto">
            <span className="uso-item-nome">
              Teste feito: {resultado.nome} respondeu em{" "}
              <span className="uso-numero">{formatarLatencia(resultado.latenciaMs)}</span>
            </span>
            <span className="uso-rotulo">
              {resultado.assinatura
                ? "Usa a sua assinatura. Os agentes contam o uso no limite semanal dela, e o Nuno avisa quando chegar perto."
                : "Paga por uso, na conta do provedor. O Nuno mostra o gasto estimado de cada agente."}
            </span>
          </span>
          <Selo tom="sucesso">funcionando</Selo>
        </>
      )}
      {resultado.fase === "falhou" && (
        <>
          <Personagem agente="nuno" modo="cabeca" tamanho="painel" estado="erro" />
          <span className="uso-item-texto">
            <span className="uso-item-nome">{resultado.nome} não passou no teste</span>
            <span className="uso-rotulo">{resultado.mensagem}</span>
          </span>
          <Selo tom="perigo">não funcionou</Selo>
          {botao("Testar de novo")}
        </>
      )}
    </div>
  );
}

/* ---------- 4. Conhecer o time ---------- */

const TIME: readonly {
  agente: Agente;
  nome: string;
  estado: EstadoPersonagem;
  funcao: string;
  fala: string;
}[] = [
  {
    agente: "alba",
    nome: "Alba",
    estado: "ocioso",
    funcao: "Agenda, tarefas e lembretes",
    fala: "Bom dia. Eu organizo o seu dia e lembro do que importa, sem cobrar.",
  },
  {
    agente: "tula",
    nome: "Tula",
    estado: "ocioso",
    funcao: "Gastos, dívidas e planos",
    fala: "Eu cuido das contas com você. Números primeiro, sem julgamento.",
  },
  {
    agente: "faina",
    nome: "Faina",
    estado: "trabalhando",
    funcao: "Organizar, limpar e criar arquivos",
    fala: "Eu faço o trabalho pesado nas suas pastas. Sempre mostro a lista antes.",
  },
  {
    agente: "nuno",
    nome: "Nuno",
    estado: "esperando",
    funcao: "Sessões de IA, PRs e CI",
    fala: "Eu acompanho suas sessões de IA: contexto, gasto e limite.",
  },
];

function Time(cabecalho: PropsCabecalho) {
  return (
    <>
      <Cabecalho {...cabecalho} rotulo="Conhecer o time" titulo="Alba, Tula, Faina e Nuno">
        Cada um cuida de uma parte e todos dividem a mesma memória. Você fala com o time inteiro ou com um só,
        com @alba, @tula, @faina ou @nuno.
      </Cabecalho>
      <ul className="uso-time" aria-label="O time">
        {TIME.map((m) => (
          <li key={m.agente} className="uso-membro">
            <Personagem agente={m.agente} modo="inteiro" tamanho="apresentacao" estado={m.estado} />
            <span className="uso-membro-nomes">
              <span className="uso-membro-nome" data-agente={m.agente}>
                {m.nome}
              </span>
              <span className="uso-rotulo">{m.funcao}</span>
            </span>
            <p className="uso-membro-fala">“{m.fala}”</p>
          </li>
        ))}
      </ul>
      <p className="uso-rotulo">
        A expressão de cada um mostra o que ele está fazendo: descansando, focado, atento, preocupado ou
        dormindo.
      </p>
    </>
  );
}

/* ---------- 5. Conexões ---------- */

const CONEXOES: readonly { agente: Agente; quem: string; nome: string; texto: string; fase: string }[] = [
  {
    agente: "alba",
    quem: "Alba",
    nome: "Google Agenda",
    texto: "Lê seus calendários e cria um calendário “Moductus” para os lembretes chegarem ao celular.",
    fase: "fase 3",
  },
  {
    agente: "faina",
    quem: "Faina",
    nome: "Pastas autorizadas",
    texto: "Downloads e Área de Trabalho sugeridas. Ela nunca sai delas nem toca no Windows.",
    fase: "fase 5",
  },
  {
    agente: "nuno",
    quem: "Nuno",
    nome: "Sessões de IA e GitHub",
    texto: "Instala os hooks do Claude Code e lê PRs, issues e CI dos seus repositórios.",
    fase: "fase 2",
  },
  {
    agente: "tula",
    quem: "Tula",
    nome: "Primeiro extrato",
    texto: "OFX, CSV ou XML do seu banco. Nubank, Itaú, Inter e outros já têm perfil pronto.",
    fase: "fase 4",
  },
];

function Conexoes(cabecalho: PropsCabecalho) {
  return (
    <>
      <Cabecalho {...cabecalho} rotulo="Conexões" titulo="O que cada agente pode alcançar">
        Tudo opcional. Sem conexão, o agente trabalha só com o que você contar a ele. Cada conexão chega junto
        com o seu agente e fica em Configurações, Conexões.
      </Cabecalho>
      <ul className="uso-lista" aria-label="Conexões por agente">
        {CONEXOES.map((c) => (
          <li key={c.nome} className="uso-item">
            <Personagem agente={c.agente} modo="cabeca" tamanho="dock" estado="ocioso" />
            <span className="uso-item-texto">
              <span className="uso-item-linha">
                <span className="uso-item-nome">{c.nome}</span>
                <span className="uso-rotulo">para {c.quem}</span>
              </span>
              <span className="uso-item-descricao">{c.texto}</span>
            </span>
            <Selo>{c.fase}</Selo>
          </li>
        ))}
      </ul>
    </>
  );
}
