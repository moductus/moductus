import type { ComponentType } from "react";
import { PrivacidadeContexto } from "../componentes/privacidade.ts";
import { useAcessibilidade } from "../nativo/acessibilidade.ts";
import { usePrivacidadeDaJanela } from "../servico/privacidade.ts";
import { useTema } from "../tokens/tema.ts";

/**
 * Toda janela segue o tema da configuração, a animação do Windows e o modo privacidade; os
 * componentes só leem os tokens e o `PrivacidadeContexto` (todo `Valor` mascara junto).
 */
export function ComTema({ Tela }: { Tela: ComponentType }) {
  useTema();
  useAcessibilidade();
  const privacidade = usePrivacidadeDaJanela();
  return (
    <PrivacidadeContexto value={privacidade}>
      <Tela />
    </PrivacidadeContexto>
  );
}
