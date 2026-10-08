import { useState, type ReactNode } from "react";
import { Atalho } from "../componentes/Atalho.tsx";
import { Botao, type VarianteBotao } from "../componentes/Botao.tsx";
import { Caixa } from "../componentes/Caixa.tsx";
import { Campo } from "../componentes/Campo.tsx";
import { Cartao } from "../componentes/Cartao.tsx";
import { Icone, NOMES_ICONES } from "../componentes/Icone.tsx";
import { Interruptor } from "../componentes/Interruptor.tsx";
import { ItemLista, Lista } from "../componentes/ItemLista.tsx";
import { Marca } from "../componentes/Marca.tsx";
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
