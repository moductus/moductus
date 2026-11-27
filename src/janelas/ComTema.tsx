import type { ComponentType } from "react";
import { AtalhoPrivacidadeContexto, PrivacidadeContexto } from "../componentes/privacidade.ts";
import { useAcessibilidade } from "../nativo/acessibilidade.ts";
import { usePrivacidadeDaJanela } from "../servico/privacidade.ts";
import { useTema } from "../tokens/tema.ts";

/**
 * Toda janela segue o tema da configuração, a animação do Windows e o modo privacidade; os
 * componentes só leem os tokens e o `PrivacidadeContexto` (todo `Valor` mascara junto); o atalho
 * do modo vai junto, para o selo do dock.
 */
export function ComTema({ Tela }: { Tela: ComponentType }) {
  useTema();
  useAcessibilidade();
  const { ativo, atalho } = usePrivacidadeDaJanela();
  return (
    <PrivacidadeContexto value={ativo}>
      <AtalhoPrivacidadeContexto value={atalho}>
        <Tela />
      </AtalhoPrivacidadeContexto>
    </PrivacidadeContexto>
  );
}
