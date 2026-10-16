import type { Conexao, ItemGithub } from "@moductus/contrato";
import { useId } from "react";
import { Cartao } from "../../componentes/Cartao.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useServico } from "../../nativo/eventos.ts";
import { useCanal } from "../../servico/conexao.ts";
import { AbrirConexoes, FaixaNuno, LeituraPendente } from "../FaixaNuno.tsx";
import { EstadoVazio, Pagina } from "../Pagina.tsx";
import { useAgora } from "../tempo.ts";
import {
  colunasDoGithub,
  falaDoNuno,
  metaDoItem,
  referencia,
  seloDoItem,
  situacaoDaLeitura,
  useDadosDev,
  type ColunaDev,
  type IdColuna,
} from "./dev.ts";
import "./Dev.css";

const TITULO = "Dev";
const ROTULO = "Nuno · GitHub";

/**
 * Dev (AreaDev.dc.html): a fala do Nuno sobre o que mais precisa de você e as colunas do GitHub.
 * Sem a conexão do GitHub, o vazio diz como ligar; com erro, diz o que o `gh` respondeu.
 */
export function Dev() {
  const canal = useCanal(useServico({ silencioso: true }));
  const agora = useAgora();
  const leitura = useDadosDev(canal);

  if (leitura.estado !== "pronta") {
    return (
      <Pagina titulo={TITULO} rotulo={ROTULO}>
        <LeituraPendente
          oQue="o que o Nuno guardou do GitHub"
          tentarDeNovo={leitura.estado === "falhou" ? leitura.tentarDeNovo : undefined}
        />
      </Pagina>
    );
  }

  const { situacao, conexao } = leitura.dados;
  const colunas = colunasDoGithub(situacao.itens);
  const vazio = colunas.every((c) => c.itens.length === 0);
  const erro = conexao?.estado === "erro" ? conexao.ultimoErro : null;

  if (vazio) {
    return (
      <Pagina titulo={TITULO} rotulo={ROTULO}>
        <SemItens conexao={conexao} />
      </Pagina>
    );
  }

  const fala = erro ?? falaDoNuno(situacao.itens);
  return (
    <Pagina
      titulo={TITULO}
      rotulo={ROTULO}
      acao={<span className="dev-leitura">{situacaoDaLeitura(situacao, agora)}</span>}
    >
      {fala && <FaixaNuno texto={fala} erro={erro !== null} />}
      <div className="dev-colunas">
        {colunas.map((c) => (
          <Coluna key={c.id} coluna={c} agora={agora} />
        ))}
      </div>
    </Pagina>
  );
}

/** O vazio: sem conexão, como ligar; com erro, o que fazer; ligado, que não há nada esperando. */
function SemItens({ conexao }: { conexao: Conexao | null }) {
  if (conexao?.estado === "ligada") {
    return (
      <EstadoVazio
        agentes={["nuno"]}
        titulo="Nada esperando você no GitHub"
        texto="Nenhum PR esperando seu review, nenhum PR seu aberto e nenhuma issue atribuída a você. O Nuno olha de novo a cada 15 minutos."
      />
    );
  }
  if (conexao?.estado === "erro") {
    return (
      <EstadoVazio
        agentes={["nuno"]}
        titulo="Não consegui ler o GitHub"
        texto={conexao.ultimoErro ?? "O gh não respondeu. Confira a conexão em Configurações › Conexões."}
        acoes={<AbrirConexoes variante="primario" />}
      />
    );
  }
  return (
    <EstadoVazio
      agentes={["nuno"]}
      titulo="O GitHub ainda não está conectado"
      texto="Conecte em Configurações › Conexões, com o gh instalado e logado. O Nuno passa a juntar os PRs que esperam seu review, os seus e as issues atribuídas a você."
      acoes={<AbrirConexoes variante="primario" />}
    />
  );
}

function Coluna({ coluna, agora }: { coluna: ColunaDev; agora: Date }) {
  const idTitulo = useId();
  return (
    <section className="dev-coluna" aria-labelledby={idTitulo}>
      <header className="dev-coluna-cabecalho">
        <h2 id={idTitulo} className="dev-coluna-titulo">
          {coluna.nome}
        </h2>
        <Selo tom={coluna.tom}>
          <span aria-hidden="true">{coluna.itens.length}</span>
          <span className="so-leitor">{`${coluna.itens.length} ${coluna.itens.length === 1 ? "item" : "itens"}`}</span>
        </Selo>
      </header>
      {coluna.itens.length === 0 ? (
        <p className="dev-coluna-vazia">Nada aqui.</p>
      ) : (
        <ul className="dev-itens">
          {coluna.itens.map((item) => (
            <li key={item.id}>
              <CartaoItem item={item} coluna={coluna.id} agora={agora} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CartaoItem({ item, coluna, agora }: { item: ItemGithub; coluna: IdColuna; agora: Date }) {
  const selo = seloDoItem(item, coluna);
  const meta = metaDoItem(item, coluna, agora);
  return (
    <Cartao como="article" className="dev-item" aria-label={`${referencia(item)}: ${item.titulo}`}>
      <span className="dev-item-ref" title={`${item.repositorio} #${item.numero}`}>
        {referencia(item)}
      </span>
      <span className="dev-item-titulo">{item.titulo || "Sem título"}</span>
      <span className="dev-item-linha">
        <Selo tom={selo.tom}>{selo.texto}</Selo>
        {meta && <span className="dev-item-meta">{meta}</span>}
      </span>
    </Cartao>
  );
}
