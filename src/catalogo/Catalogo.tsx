import type { Aprovacao, PedidoDecidir, SituacaoAgente } from "@moductus/contrato";
import { ServicoIndisponivel } from "@moductus/contrato/cliente";
import { useState, type ReactNode } from "react";
import { Atalho } from "../componentes/Atalho.tsx";
import { Botao, type VarianteBotao } from "../componentes/Botao.tsx";
import { Caixa } from "../componentes/Caixa.tsx";
import { Campo } from "../componentes/Campo.tsx";
import { Cartao } from "../componentes/Cartao.tsx";
import { CartaoAprovacao } from "../componentes/CartaoAprovacao.tsx";
import { FalaAgente } from "../componentes/FalaAgente.tsx";
import { Icone, NOMES_ICONES } from "../componentes/Icone.tsx";
import { Interruptor } from "../componentes/Interruptor.tsx";
import { ItemLista, Lista } from "../componentes/ItemLista.tsx";
import { Marca } from "../componentes/Marca.tsx";
import { DADOS_AGENTES, type Agente } from "../componentes/personagem/agentes.ts";
import { Personagem } from "../componentes/personagem/Personagem.tsx";
import { lerSituacao } from "../componentes/personagem/situacao.ts";
import { Progresso } from "../componentes/Progresso.tsx";
import { Seletor } from "../componentes/Seletor.tsx";
import { Contagem, Selo } from "../componentes/Selo.tsx";
import type { TemaConcreto } from "../tokens/tema.ts";
import "./Catalogo.css";

/*
 * Catálogo interno dos componentes base: os três temas lado a lado, cada coluna com o próprio
 * data-tema (os tokens valem por escopo). Hover, pressionado e foco aparecem forçados por
 * data-estado; a última amostra de cada grupo é interativa de verdade.
 */

const TEMAS: { tema: TemaConcreto; nome: string }[] = [
  { tema: "grafite", nome: "Grafite" },
  { tema: "papel", nome: "Papel" },
  { tema: "vidro", nome: "Vidro" },
];

const VARIANTES: { variante: VarianteBotao; nome: string }[] = [
  { variante: "primario", nome: "Primário" },
  { variante: "secundario", nome: "Secundário" },
  { variante: "fantasma", nome: "Fantasma" },
];

const ESTADOS = ["hover", "ativo", "foco"] as const;

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="catalogo-grupo">
      <h3 className="catalogo-grupo-titulo">{titulo}</h3>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo?: string; children: ReactNode }) {
  return (
    <div className="catalogo-linha">
      {rotulo && <span className="catalogo-rotulo">{rotulo}</span>}
      {children}
    </div>
  );
}

function Botoes() {
  return (
    <Grupo titulo="Botões">
      {VARIANTES.map(({ variante, nome }) => (
        <Linha key={variante} rotulo={nome}>
          <Botao variante={variante}>Normal</Botao>
          {ESTADOS.map((estado) => (
            <Botao key={estado} variante={variante} data-estado={estado}>
              {estado === "hover" ? "Hover" : estado === "ativo" ? "Pressionado" : "Foco"}
            </Botao>
          ))}
          <Botao variante={variante} disabled>
            Desativado
          </Botao>
        </Linha>
      ))}
      <Linha rotulo="Com ícone">
        <Botao variante="primario" icone="tarefas">
          Nova tarefa
        </Botao>
        <Botao variante="secundario" icone="notas">
          Editar blocos
        </Botao>
        <Botao variante="fantasma" icone="foco">
          Encerrar
        </Botao>
      </Linha>
      <Linha rotulo="Pequeno">
        <Botao variante="primario" tamanho="pequeno">
          Permitir
        </Botao>
        <Botao variante="secundario" tamanho="pequeno">
          Negar
        </Botao>
        <Botao variante="fantasma" tamanho="pequeno">
          Depois
        </Botao>
        <Botao variante="secundario" tamanho="pequeno" disabled>
          Desativado
        </Botao>
      </Linha>
      <Linha rotulo="Só ícone">
        <Botao variante="fantasma" icone="minimizar" aria-label="Minimizar" />
        <Botao variante="fantasma" icone="maximizar" aria-label="Maximizar" />
        <Botao variante="fantasma" icone="fechar" aria-label="Fechar" />
        <Botao variante="secundario" icone="configuracoes" aria-label="Configurações" />
      </Linha>
    </Grupo>
  );
}

function Campos() {
  const [texto, setTexto] = useState("");
  return (
    <Grupo titulo="Campo">
      <div className="catalogo-coluna-campos">
        <Campo rotulo="Normal" placeholder="Capturar tarefa, nota ou lembrete" />
        <Campo rotulo="Hover" placeholder="Capturar tarefa" data-estado="hover" />
        <Campo rotulo="Foco" defaultValue="Revisar extrato" data-estado="foco" />
        <Campo rotulo="Busca" rotuloOculto icone="busca" placeholder="Buscar em tudo" />
        <Campo rotulo="Com dica" dica="Enter salva; Esc cancela." placeholder="Título" />
        <Campo rotulo="Desativado" placeholder="Indisponível" disabled />
        <Campo
          rotulo="Interativo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Digite aqui"
        />
      </div>
    </Grupo>
  );
}

function Atalhos() {
  return (
    <Grupo titulo="Atalho">
      <Linha>
        <Atalho teclas="Ctrl+K" />
        <Atalho teclas="Ctrl+Alt+N" />
        <Atalho teclas="Ctrl+Alt+Espaço" />
        <Atalho teclas="Enter" />
        <Atalho teclas="Ctrl++" />
      </Linha>
    </Grupo>
  );
}

function Cartoes() {
  return (
    <Grupo titulo="Cartão">
      <Cartao>
        <strong>Cartão</strong>
        <span className="catalogo-apagado">Fundo do cartão e borda fina.</span>
      </Cartao>
      <Cartao variante="elevado">
        <strong>Cartão elevado</strong>
        <span className="catalogo-apagado">Fundo elevado e borda forte, sem sombra.</span>
      </Cartao>
    </Grupo>
  );
}

function Listas() {
  return (
    <Grupo titulo="Item de lista">
      <Cartao>
        <Lista>
          <ItemLista icone="tarefas" meta={<Atalho teclas="Ctrl+2" />}>
            Tarefas
          </ItemLista>
          <ItemLista
            icone="dev"
            detalhe="moductus · feat/fase-1-casca"
            meta={<Selo tom="sucesso">pronto</Selo>}
          >
            CI da branch
          </ItemLista>
          <ItemLista icone="financas" meta="R$ 120,00">
            Conta de luz
          </ItemLista>
          <ItemLista meta={<Contagem valor={3} rotulo="arquivos novos" />}>
            Um texto longo que não cabe na linha inteira e termina em reticências
          </ItemLista>
        </Lista>
      </Cartao>
    </Grupo>
  );
}

function Alternaveis() {
  const [marcado, setMarcado] = useState(false);
  const [ligado, setLigado] = useState(true);
  const nada = () => undefined;
  return (
    <Grupo titulo="Caixa e interruptor">
      <div className="catalogo-grade">
        <Caixa marcado={false} aoMudar={nada}>
          Desmarcada
        </Caixa>
        <Caixa marcado aoMudar={nada}>
          Marcada
        </Caixa>
        <Caixa marcado={false} aoMudar={nada} data-estado="hover">
          Hover
        </Caixa>
        <Caixa marcado aoMudar={nada} data-estado="foco">
          Foco
        </Caixa>
        <Caixa marcado={false} aoMudar={nada} desativado>
          Desativada
        </Caixa>
        <Caixa marcado aoMudar={nada} desativado>
          Marcada desativada
        </Caixa>
        <Caixa marcado={marcado} aoMudar={setMarcado}>
          Interativa
        </Caixa>
        <span />
        <Interruptor ligado={false} aoMudar={nada}>
          Desligado
        </Interruptor>
        <Interruptor ligado aoMudar={nada}>
          Ligado
        </Interruptor>
        <Interruptor ligado={false} aoMudar={nada} data-estado="hover">
          Hover
        </Interruptor>
        <Interruptor ligado aoMudar={nada} data-estado="foco">
          Foco
        </Interruptor>
        <Interruptor ligado={false} aoMudar={nada} desativado>
          Desativado
        </Interruptor>
        <Interruptor ligado aoMudar={nada} desativado>
          Ligado desativado
        </Interruptor>
        <Interruptor ligado={ligado} aoMudar={setLigado}>
          Interativo
        </Interruptor>
      </div>
    </Grupo>
  );
}

function Progressos() {
  return (
    <Grupo titulo="Progresso">
      <div className="catalogo-coluna-campos">
        <Progresso rotulo="Vazio" valor={0} />
        <Progresso rotulo="Foco de hoje" valor={25} />
        <Progresso rotulo="Tarefas" valor={3} maximo={4} textoValor="3 de 4 tarefas" tom="sucesso" />
        <Progresso rotulo="Orçamento" valor={85} tom="aviso" />
        <Progresso rotulo="Cota" valor={100} tom="perigo" />
      </div>
    </Grupo>
  );
}

function Selos() {
  return (
    <Grupo titulo="Selo e contagem">
      <Linha>
        <Selo>rascunho</Selo>
        <Selo tom="sucesso" icone="tarefas">
          pronto
        </Selo>
        <Selo tom="aviso">vence amanhã</Selo>
        <Selo tom="perigo">falhou</Selo>
      </Linha>
      <Linha>
        <Contagem valor={4} rotulo="tarefas pendentes" />
        <Contagem valor={12} rotulo="notificações" />
        <Contagem valor={120} rotulo="arquivos novos" />
      </Linha>
    </Grupo>
  );
}

function Seletores() {
  const [tema, setTema] = useState<TemaConcreto>("grafite");
  const [posicao, setPosicao] = useState("esquerda");
  return (
    <Grupo titulo="Seletor segmentado">
      <Seletor
        rotulo="Tema"
        valor={tema}
        aoMudar={setTema}
        opcoes={TEMAS.map(({ tema, nome }) => ({ valor: tema, rotulo: nome }))}
      />
      <Seletor
        rotulo="Posição do dock"
        valor={posicao}
        aoMudar={setPosicao}
        opcoes={[
          { valor: "esquerda", rotulo: "Esquerda" },
          { valor: "direita", rotulo: "Direita" },
          { valor: "embaixo", rotulo: "Embaixo", desativada: true },
        ]}
      />
    </Grupo>
  );
}

function Icones() {
  return (
    <Grupo titulo="Marca e ícones">
      <Linha>
        <Marca tamanho={16} />
        <Marca tamanho={26} />
        <Marca tamanho={48} rotulo="Moductus" />
      </Linha>
      <div className="catalogo-icones">
        {NOMES_ICONES.map((nome) => (
          <span key={nome} className="catalogo-icone">
            <Icone nome={nome} tamanho={20} />
            <span>{nome}</span>
          </span>
        ))}
      </div>
    </Grupo>
  );
}

function SelosDeStatus() {
  return (
    <Grupo titulo="Selo de status: pílula e ponto">
      <Linha rotulo="Selo (listas do time)">
        <Selo>ocioso</Selo>
        <Selo tom="sucesso">trabalhando</Selo>
        <Selo tom="aviso">esperando você</Selo>
        <Selo tom="perigo">erro</Selo>
        <Selo tom="apagado">desligado</Selo>
      </Linha>
      <Linha rotulo="Ponto (sessões e PRs)">
        <Selo forma="ponto" tom="sucesso">
          trabalhando
        </Selo>
        <Selo forma="ponto" tom="aviso">
          esperando você
        </Selo>
        <Selo forma="ponto" tom="perigo">
          CI falhou
        </Selo>
        <Selo forma="ponto" tom="apagado">
          terminou
        </Selo>
      </Linha>
    </Grupo>
  );
}

const SITUACAO_BASE: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

/** Uma situação do runtime para cada linha do Estados.dc.html, e o que o personagem faz com ela. */
const SITUACOES: { agente: Agente; situacao: SituacaoAgente | null; nota: string }[] = [
  { agente: "alba", situacao: null, nota: "sem serviço" },
  { agente: "alba", situacao: SITUACAO_BASE, nota: "ativo, ocioso" },
  { agente: "tula", situacao: { ...SITUACAO_BASE, atividade: "trabalhando" }, nota: "ativo, trabalhando" },
  { agente: "faina", situacao: { ...SITUACAO_BASE, atividade: "esperando" }, nota: "ativo, esperando" },
  { agente: "tula", situacao: { ...SITUACAO_BASE, atividade: "erro" }, nota: "ativo, erro" },
  {
    agente: "nuno",
    situacao: { ...SITUACAO_BASE, estado: "dormindo", motivoSono: "limite" },
    nota: "dormindo, limite",
  },
  {
    agente: "nuno",
    situacao: { ...SITUACAO_BASE, estado: "dormindo", motivoSono: "teto" },
    nota: "dormindo, teto",
  },
  { agente: "faina", situacao: { ...SITUACAO_BASE, estado: "pausado" }, nota: "pausado" },
  { agente: "alba", situacao: { ...SITUACAO_BASE, estado: "desligado" }, nota: "desligado" },
];

function Situacoes() {
  return (
    <Grupo titulo="Personagem e estado real">
      <ul className="catalogo-situacoes">
        {SITUACOES.map(({ agente, situacao, nota }) => {
          const { expressao, moldura, texto, tom } = lerSituacao(situacao);
          return (
            <li key={nota} className="catalogo-situacao">
              <Personagem agente={agente} modo="cabeca" tamanho="dock" estado={expressao} moldura={moldura} />
              <span className="catalogo-situacao-nome">{DADOS_AGENTES[agente].nome}</span>
              <Selo tom={tom}>{texto}</Selo>
              <span className="catalogo-apagado">{nota}</span>
            </li>
          );
        })}
      </ul>
    </Grupo>
  );
}

function Falas() {
  return (
    <Grupo titulo="Fala do agente">
      <FalaAgente agente="tula">
        R$ 512 de R$ 600 em mercado em outubro, 85% do previsto, com 8 dias passados.
      </FalaAgente>
      <FalaAgente agente="nuno" estado="esperando" acao={<AcoesFala />}>
        A sessão do Codex chegou a 85% do contexto. Compacto agora?
      </FalaAgente>
    </Grupo>
  );
}

function AcoesFala() {
  return (
    <div className="catalogo-linha">
      <Botao tamanho="pequeno">Depois</Botao>
      <Botao tamanho="pequeno" variante="primario">
        Compactar
      </Botao>
    </div>
  );
}

const INSTANTE = "2026-10-09T14:31:00.000Z";

const DO_TERMINAL: Aprovacao = {
  id: "aprovacao-terminal",
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "sessao-api-pedidos",
  descricao: "Quer rodar o comando abaixo.",
  acao: { ferramenta: "Bash", entrada: null, rotulo: null, rotuloRecusar: null, desfazivel: false },
  estado: "pendente",
  criadoEm: INSTANTE,
  decididaEm: null,
  regraCriadaId: null,
};

const DA_FAINA: Aprovacao = {
  id: "aprovacao-faina",
  fonte: "moductus",
  agenteId: "faina",
  execucaoId: "execucao-faina",
  sessaoId: null,
  descricao:
    "Achei 38 instaladores (1,4 GB) com mais de 60 dias. Vou mover para a Lixeira; a lista está abaixo.",
  acao: {
    ferramenta: "arquivos.mover",
    entrada: null,
    rotulo: "Mover 38 arquivos",
    rotuloRecusar: "Não mover",
    desfazivel: true,
  },
  estado: "pendente",
  criadoEm: INSTANTE,
  decididaEm: null,
  regraCriadaId: null,
};

/** No catálogo, decidir só muda o cartão na tela; nada sai daqui. */
function useAprovacaoDeMentira(inicial: Aprovacao) {
  const [aprovacao, setAprovacao] = useState(inicial);
  const aoDecidir = async (pedido: PedidoDecidir) => {
    setAprovacao((a) => ({
      ...a,
      estado: pedido.decisao === "permitir" ? "aprovada" : "negada",
      decididaEm: INSTANTE,
      regraCriadaId: pedido.sempre ? "regra-catalogo" : null,
    }));
  };
  const refazer = () => setAprovacao(inicial);
  return { aprovacao, aoDecidir, refazer };
}

function OrigemSessao() {
  return (
    <>
      <Selo forma="ponto" tom="aviso">
        esperando você
      </Selo>
      <span className="catalogo-situacao-nome">api-pedidos</span>
      <span className="catalogo-apagado">Claude Code</span>
    </>
  );
}

function Aprovacoes() {
  const terminal = useAprovacaoDeMentira(DO_TERMINAL);
  const faina = useAprovacaoDeMentira(DA_FAINA);
  const nunca = async () => {
    throw new ServicoIndisponivel();
  };
  return (
    <Grupo titulo="Cartão de aprovação">
      <Linha rotulo="Sessão do terminal (interativo)">
        <Botao tamanho="pequeno" variante="fantasma" onClick={terminal.refazer}>
          Recomeçar
        </Botao>
      </Linha>
      <CartaoAprovacao
        aprovacao={terminal.aprovacao}
        origem={<OrigemSessao />}
        detalhe={<code>npm test -- --watch=false</code>}
        aoDecidir={terminal.aoDecidir}
      />
      <Linha rotulo="Agente do Moductus, dentro da fala (interativo)">
        <Botao tamanho="pequeno" variante="fantasma" onClick={faina.refazer}>
          Recomeçar
        </Botao>
      </Linha>
      <FalaAgente
        agente="faina"
        estado="esperando"
        acao={
          <CartaoAprovacao
            aprovacao={faina.aprovacao}
            semDescricao
            tamanho="pequeno"
            detalhe={
              <>
                <span>Setup-editor-1.82.exe · 98 MB · 74 dias</span>
                <span>instalador-impressora.msi · 210 MB · 190 dias</span>
                <span>+ 36 outros</span>
              </>
            }
            extra={<Botao tamanho="pequeno">Ver lista</Botao>}
            aoDecidir={faina.aoDecidir}
          />
        }
      >
        {DA_FAINA.descricao}
      </FalaAgente>
      <Linha rotulo="Serviço fora do ar ao responder">
        <span className="catalogo-apagado">Os botões mostram o erro no próprio cartão.</span>
      </Linha>
      <CartaoAprovacao aprovacao={DO_TERMINAL} origem={<OrigemSessao />} aoDecidir={nunca} />
      <Linha rotulo="Já decidido e expirado">
        <span className="catalogo-apagado">Sem botões: o cartão diz o que valeu.</span>
      </Linha>
      <CartaoAprovacao
        aprovacao={{ ...DO_TERMINAL, estado: "aprovada", regraCriadaId: "regra-catalogo" }}
        origem={<OrigemSessao />}
        aoDecidir={nunca}
      />
      <CartaoAprovacao aprovacao={{ ...DA_FAINA, estado: "expirada" }} aoDecidir={nunca} />
    </Grupo>
  );
}

function Coluna({ tema, nome }: { tema: TemaConcreto; nome: string }) {
  return (
    <div className="catalogo-tema" data-tema={tema}>
      <h2 className="catalogo-tema-titulo">{nome}</h2>
      <Icones />
      <Botoes />
      <Campos />
      <Atalhos />
      <Cartoes />
      <Listas />
      <Alternaveis />
      <Progressos />
      <Selos />
      <Seletores />
      <SelosDeStatus />
      <Situacoes />
      <Falas />
      <Aprovacoes />
    </div>
  );
}

export function Catalogo() {
  return (
    <main className="catalogo" aria-label="Catálogo de componentes">
      {TEMAS.map((t) => (
        <Coluna key={t.tema} {...t} />
      ))}
    </main>
  );
}
