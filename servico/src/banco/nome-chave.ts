/**
 * A chave de um nome que não se repete sem diferença de caixa (`etiquetas.nome_chave`): sem espaço
 * nas pontas, com os acentos numa forma só (NFC) e em minúsculas do português. O serviço grava a
 * chave junto com o nome, e o índice único fica nela, porque o `COLLATE NOCASE` do SQLite só iguala
 * A-Z: `Ônibus` e `ônibus` passariam como nomes diferentes.
 */
export function nomeChave(nome: string): string {
  return nome.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}
