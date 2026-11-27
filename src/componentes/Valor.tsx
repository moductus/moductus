import { falarCentavos, formatarCentavos, MOEDA_PADRAO, simboloDaMoeda } from "@moductus/contrato";
import { usePrivacidade } from "./privacidade.ts";
import { Sensivel } from "./TextoSensivel.tsx";
import "./Valor.css";

/** Saída leva "−", entrada com `sinal` leva "+" e o tom de sucesso; transferência fica apagada. */
type TomValor = "neutro" | "saida" | "entrada" | "transferencia";

interface PropsValor {
  /** Centavos inteiros com sinal: negativo é saída (DATA §1). */
  centavos: number;
  /** Moeda da conta; padrão, real. */
  moeda?: string;
  /** Entrada com "+" e no tom de sucesso; sem isso, positivo sai sem sinal e no tom do texto. */
  sinal?: boolean;
  /** "R$ 1.235": totais e orçamento. */
  semCentavos?: boolean;
  /** Transferência entre contas próprias: sem sinal e apagada, porque não é entrada nem saída. */
  transferencia?: boolean;
  className?: string;
}

/**
 * Dinheiro na tela: o texto do contrato (`formatarCentavos`), o sentido no sinal e não só na cor,
 * o leitor de tela dizendo "menos 45 reais", e "R$ •••" no mesmo tamanho com o modo privacidade.
 */
export function Valor({ centavos, moeda, sinal, semCentavos, transferencia, className }: PropsValor) {
  const mascarado = usePrivacidade();
  const quantia = transferencia ? Math.abs(centavos) : centavos;
  const comSinal = Boolean(sinal) && !transferencia;
  const texto = formatarCentavos(quantia, { moeda, sinal: comSinal, semCentavos });
  const tom: TomValor = transferencia
    ? "transferencia"
    : texto.startsWith("−")
      ? "saida"
      : texto.startsWith("+")
        ? "entrada"
        : "neutro";
  const classes = ["valor", className].filter(Boolean).join(" ");
  return (
    <Sensivel
      className={classes}
      data-tom={tom}
      mascarado={mascarado}
      mascara={`${simboloDaMoeda(moeda ?? MOEDA_PADRAO)} •••`}
      lido={mascarado ? "valor escondido" : falarCentavos(quantia, { moeda, sinal: comSinal, semCentavos })}
    >
      {texto}
    </Sensivel>
  );
}
