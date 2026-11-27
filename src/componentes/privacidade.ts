import { createContext, useContext } from "react";

/**
 * O modo privacidade (ADR-0047) como os componentes de dinheiro o veem: ligado, `Valor` e
 * `TextoSensivel` mascaram. Quem lê `privacidade.ativo` da configuração e ouve
 * `privacidade.mudou` põe o estado no provedor da janela; sem provedor, fica desligado.
 */
export const PrivacidadeContexto = createContext(false);

export const usePrivacidade = () => useContext(PrivacidadeContexto);
