import { useEffect, useState } from "react";
import { TAMANHO_PERSONAGEM, type TamanhoPersonagem } from "../../tokens/personagens.ts";
import type { TemaConcreto } from "../../tokens/tema.ts";
import { AGENTES, DADOS_AGENTES, ESTADOS_PERSONAGEM, ROTULO_ESTADO } from "./agentes.ts";
import { Personagem } from "./Personagem.tsx";
import "./galeria.css";

const TEMAS: TemaConcreto[] = ["grafite", "papel", "vidro"];
const TAMANHOS_CABECA: TamanhoPersonagem[] = ["mini", "lista", "dock", "painel"];

/**
 * Página de revisão dos personagens, para comparar com Personagem.dc.html, Time.dc.html e
 * Estados.dc.html. Abre no navegador com `?personagens`; não faz parte de nenhuma janela.
 */
export function Galeria() {
  const [tema, setTema] = useState<TemaConcreto>("grafite");
  // Só troca o atributo: a galeria roda no navegador, sem casca nem serviço por trás.
  useEffect(() => {
    document.documentElement.dataset.tema = tema;
  }, [tema]);

  return (
    <main className="galeria" aria-label="Galeria dos personagens">
      <header className="galeria-topo">
        <h1>Personagens</h1>
        <div role="group" aria-label="Tema" className="galeria-temas">
          {TEMAS.map((t) => (
            <button key={t} type="button" aria-pressed={t === tema} onClick={() => setTema(t)}>
              {t}
            </button>
          ))}
        </div>
      </header>

      <section aria-labelledby="g-inteiro">
        <h2 id="g-inteiro">Corpo inteiro, {TAMANHO_PERSONAGEM.cartao} px, ocioso</h2>
        <div className="galeria-linha">
          {AGENTES.map((a) => (
            <figure key={a} className="galeria-cartao">
              <Personagem agente={a} modo="inteiro" tamanho="cartao" />
              <figcaption>
                <strong>{DADOS_AGENTES[a].nome}</strong> <code>{DADOS_AGENTES[a].apelido}</code>
                <span>{DADOS_AGENTES[a].funcao}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section aria-labelledby="g-estados">
        <h2 id="g-estados">Estados, corpo inteiro</h2>
        <table className="galeria-tabela">
          <thead>
            <tr>
              <th scope="col">Agente</th>
              {ESTADOS_PERSONAGEM.map((e) => (
                <th key={e} scope="col">
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGENTES.map((a) => (
              <tr key={a}>
                <th scope="row">{DADOS_AGENTES[a].nome}</th>
                {ESTADOS_PERSONAGEM.map((e) => (
                  <td key={e}>
                    <Personagem agente={a} modo="inteiro" estado={e} tamanho={120} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="g-moldura">
        <h2 id="g-moldura">Cabeça com moldura de estado (como em Time.dc.html)</h2>
        <table className="galeria-tabela">
          <thead>
            <tr>
              <th scope="col">Agente</th>
              {ESTADOS_PERSONAGEM.map((e) => (
                <th key={e} scope="col">
                  {ROTULO_ESTADO[e]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGENTES.map((a) => (
              <tr key={a}>
                <th scope="row">{DADOS_AGENTES[a].nome}</th>
                {ESTADOS_PERSONAGEM.map((e) => (
                  <td key={e}>
                    <Personagem agente={a} estado={e} tamanho={40} moldura />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="g-cabeca">
        <h2 id="g-cabeca">Modo cabeça nos tamanhos do produto</h2>
        <table className="galeria-tabela">
          <thead>
            <tr>
              <th scope="col">Agente</th>
              {TAMANHOS_CABECA.map((t) => (
                <th key={t} scope="col">
                  {TAMANHO_PERSONAGEM[t]} px
                </th>
              ))}
              <th scope="col">dock dormindo</th>
            </tr>
          </thead>
          <tbody>
            {AGENTES.map((a) => (
              <tr key={a}>
                <th scope="row">{DADOS_AGENTES[a].nome}</th>
                {TAMANHOS_CABECA.map((t) => (
                  <td key={t}>
                    <Personagem agente={a} tamanho={t} />
                  </td>
                ))}
                <td>
                  <Personagem agente={a} tamanho="dock" estado="dormindo" moldura />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
