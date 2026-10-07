import { useTelaCheia } from "../../nativo/eventos.ts";

export function Dock() {
  const telaCheia = useTelaCheia();
  return (
    <main aria-label="Dock" data-tela-cheia={telaCheia}>
      Dock
    </main>
  );
}
