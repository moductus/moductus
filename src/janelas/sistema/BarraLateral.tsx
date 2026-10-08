import { useEffect, useId, useState, type Ref } from "react";
import { AREAS, type IdArea } from "../../areas/areas.ts";
import { ListaNavegacao, type ItemNavegacao } from "../../areas/ListaNavegacao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import type { Tema } from "../../tokens/tema.ts";

const ITENS: readonly ItemNavegacao<IdArea>[] = AREAS.map((a) => ({
  id: a.id,
  nome: a.nome,
  icone: a.icone,
  ...(a.atalho ? { atalho: { aria: `Control+${a.atalho}`, texto: `Ctrl ${a.atalho}` } } : {}),
}));

const TEMAS: readonly OpcaoSeletor<Tema>[] = [
  { valor: "grafite", rotulo: "Grafite" },
  { valor: "papel", rotulo: "Papel" },
  { valor: "vidro", rotulo: "Vidro" },
];

interface PropsBarraLateral {
  ativa: IdArea;
  aoEscolher: (area: IdArea) => void;
  /** O Ctrl+K da janela foca a busca por aqui. */
  refBusca: Ref<HTMLInputElement>;
}

/** Barra lateral de 232: busca Ctrl+K, as 12 áreas e o tema ao pé (Sistema.dc.html). */
export function BarraLateral({ ativa, aoEscolher, refBusca }: PropsBarraLateral) {
  return (
    <ListaNavegacao
      rotulo="Áreas"
      className="barra-lateral"
      itens={ITENS}
      ativo={ativa}
      aoEscolher={aoEscolher}
      antes={<Busca refBusca={refBusca} />}
      depois={<TemaRapido />}
    />
  );
}

/**
 * Campo da busca global. A busca em si vem com os dados das áreas; até lá, focar o campo
 * explica isso em uma linha, em vez de não fazer nada.
 */
function Busca({ refBusca }: { refBusca: Ref<HTMLInputElement> }) {
  const id = useId();
  const [focada, setFocada] = useState(false);
  return (
    <div className="busca">
      <label htmlFor={id} className="so-leitor">
        Buscar
      </label>
      <div className="busca-caixa">
        <Icone nome="busca" tamanho={14} />
        <input
          ref={refBusca}
          id={id}
          className="busca-entrada"
          type="search"
          placeholder="Buscar"
          aria-keyshortcuts="Control+K"
          aria-describedby={`${id}-aviso`}
          onFocus={() => setFocada(true)}
          onBlur={() => setFocada(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
        <kbd className="busca-atalho">Ctrl K</kbd>
      </div>
      <p id={`${id}-aviso`} className="busca-aviso" hidden={!focada}>
        A busca em tarefas, notas e memória chega com essas áreas, a partir da fase 3.
      </p>
    </div>
  );
}

/** Troca rápida de tema, gravada na configuração do serviço (todas as janelas acompanham). */
function TemaRapido() {
  const canal = useCanal(useServico({ silencioso: true }));
  const [tema, setTema] = useState<Tema>("automatico");

  useEffect(() => servico.ouvir("config.mudou", (estado) => setTema(estado.config.tema)), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("config.obter")
      .then((estado) => setTema(estado.config.tema))
      .catch(() => undefined);
  }, [canal]);

  const conectado = canal === "conectado";
  const escolher = (novo: Tema) => {
    setTema(novo);
    servico
      .pedir("config.definir", { tema: novo })
      .then((estado) => setTema(estado.config.tema))
      .catch(() => undefined);
  };

  return (
    <div className="barra-lateral-tema">
      <span className="barra-lateral-tema-rotulo">Tema</span>
      <Seletor
        rotulo="Tema"
        opcoes={conectado ? TEMAS : TEMAS.map((o) => ({ ...o, desativada: true }))}
        valor={tema}
        aoMudar={escolher}
      />
    </div>
  );
}
