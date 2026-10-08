/**
 * Navegação por teclado dentro do dock (modo teclado do Ctrl+Alt+D): setas e Tab andam em
 * círculo, Home e End vão às pontas. Devolve o índice do próximo botão, ou `null` quando a
 * tecla não é de navegação. `atual` é -1 quando nenhum botão do dock tem o foco.
 */
export function proximoIndice(tecla: string, shift: boolean, atual: number, total: number): number | null {
  if (total <= 0) return null;
  const frente = (atual + 1) % total;
  const tras = atual < 0 ? total - 1 : (atual - 1 + total) % total;
  switch (tecla) {
    case "ArrowDown":
      return frente;
    case "ArrowUp":
      return tras;
    case "Tab":
      return shift ? tras : frente;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
