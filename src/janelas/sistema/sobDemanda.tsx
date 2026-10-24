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
  let pronto: ComponentType<P> | null = null;
  let pedido: Promise<ComponentType<P>> | null = null;
  const carregar = () =>
    (pedido ??= importar().then(
      (componente) => (pronto = componente),
      (erro: unknown) => {
        pedido = null;
        throw erro;
      },
    ));
  function Tela(props: P) {
    // Um import que falhou chega aqui como erro: sem fronteira de erro acima, a tela cai.
    const Componente = pronto ?? use(carregar());
    return <Componente {...props} />;
  }
  return Object.assign(Tela, { carregar });
}
