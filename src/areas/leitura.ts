/**
 * O que uma área leu do serviço: ainda esperando a resposta, falhou (a área diz isso e oferece
 * tentar de novo, nunca fica esperando para sempre) ou pronta, com os dados.
 */
export type Leitura<T> =
  { estado: "esperando" } | { estado: "falhou"; tentarDeNovo: () => void } | { estado: "pronta"; dados: T };
