import { createContext, useContext } from "react";

/**
 * O modo privacidade (ADR-0047) como os componentes de dinheiro o veem: ligado, `Valor` e
 * `TextoSensivel` mascaram. Quem lê `privacidade.ativo` da configuração e ouve
 * `privacidade.mudou` põe o estado no provedor da janela; sem provedor, fica desligado.
 */
export const PrivacidadeContexto = createContext(false);

export const usePrivacidade = () => useContext(PrivacidadeContexto);

/**
 * O atalho que liga e desliga o modo, como está na configuração ("Ctrl+Alt+H"; vazio é sem atalho),
 * para o selo do dock dizer a tecla certa. O mesmo provedor da janela põe aqui.
 */
export const AtalhoPrivacidadeContexto = createContext("");

export const useAtalhoPrivacidade = () => useContext(AtalhoPrivacidadeContexto);
