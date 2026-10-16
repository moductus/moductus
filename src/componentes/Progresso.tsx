import "./Progresso.css";

/** `neutro`: a barra que só mede, sem chamar atenção (contexto de uma sessão abaixo dos 80%). */
export type TomProgresso = "destaque" | "neutro" | "sucesso" | "aviso" | "perigo";

interface PropsProgresso {
  valor: number;
  maximo?: number;
  /** Nome acessível ("Foco de hoje", "Orçamento do mês"). */
  rotulo: string;
  /** Texto lido pelo leitor de tela no lugar do número ("3 de 4 tarefas"). */
  textoValor?: string;
  tom?: TomProgresso;
}

/** Barra de progresso; o valor fora do intervalo é preso entre 0 e o máximo. */
export function Progresso({ valor, maximo = 100, rotulo, textoValor, tom = "destaque" }: PropsProgresso) {
  const preso = Math.min(maximo, Math.max(0, valor));
  const fracao = maximo > 0 ? preso / maximo : 0;
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={maximo}
      aria-valuenow={preso}
      aria-valuetext={textoValor}
      className={`progresso progresso--${tom}`}
    >
      <div className="progresso-barra" style={{ width: `${fracao * 100}%` }} />
    </div>
  );
}
