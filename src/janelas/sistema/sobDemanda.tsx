import { use, type ComponentType, type JSX } from "react";

export interface SobDemanda<P> {
  (props: P): JSX.Element;
  /** Baixa o código antes de a tela aparecer; o mesmo pedido vale para todas as chamadas. */
  carregar: () => Promise<ComponentType<P>>;
}

/**
 * Tela cujo código só vem na primeira vez que ela aparece: o Sistema guarda na memória só as áreas
 * abertas. Enquanto baixa, suspende (o `Suspense` de cima decide o que mostrar); depois de
 * carregada, desenha direto. Se o import falha, o erro sobe e o pedido é esquecido: só uma nova
 * chamada a `carregar()` tenta de novo.
 */
export function sobDemanda<P extends object>(importar: () => Promise<ComponentType<P>>): SobDemanda<P> {
  let pedido: Promise<ComponentType<P>> | null = null;
  const carregar = () => {
    if (!pedido) {
      const novo = importar().then(
        (componente) => {
          // Marcado como cumprido, o `use` lê o componente na hora, sem suspender de novo.
          Object.assign(novo, { status: "fulfilled", value: componente });
          return componente;
        },
        (erro: unknown) => {
          pedido = null;
          throw erro;
        },
      );
      pedido = novo;
    }
    return pedido;
  };
  function Tela(props: P) {
    // Sempre pelo `use`: a tela que suspendeu precisa chamá-lo de novo ao retomar, ou o React em dev
    // acusa uso condicional. Um import que falhou chega aqui como erro: sem fronteira acima, a tela cai.
    const Componente = use(carregar());
    return <Componente {...props} />;
  }
  return Object.assign(Tela, { carregar });
}
