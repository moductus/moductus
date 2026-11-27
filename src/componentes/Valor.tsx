import { formatarCentavos, MOEDA_PADRAO, simboloDaMoeda } from "@moductus/contrato";
import { usePrivacidade } from "./privacidade.ts";
import { Sensivel } from "./TextoSensivel.tsx";
import "./Valor.css";

interface FalaDinheiro {
  moeda?: string;
  /** Entrada com "mais", como o "+" da tela. */
  sinal?: boolean;
  semCentavos?: boolean;
}

/** O nome da moeda no singular ou no plural ("dólar americano", "euros"); sem nome, o código. */
function nomeDaMoeda(moeda: string, plural: boolean): string {
  try {
    const partes = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda,
      currencyDisplay: "name",
    }).formatToParts(plural ? 2 : 1);
    return partes.find((p) => p.type === "currency")?.value.toLocaleLowerCase("pt-BR") ?? moeda;
  } catch {
    return moeda;
  }
}

/**
 * O valor como o leitor de tela deve dizer: "menos 45 reais", "mais 1.234 reais e 56 centavos",
 * "1 real". O "R$" e o "−" da tela viram palavras, porque o leitor lê "R$" letra por letra e
 * pode calar o sinal. Os números saem do formato do contrato, sem ponto flutuante.
 */
export function falarCentavos(centavos: number, fala: FalaDinheiro = {}): string {
  const moeda = (fala.moeda ?? MOEDA_PADRAO).toUpperCase();
  // O formato do contrato arredonda o "sem centavos"; daqui só sai a decomposição dele.
  const numero = formatarCentavos(centavos, { semSimbolo: true, semCentavos: fala.semCentavos });
  const negativo = numero.startsWith("−");
  const absoluto = negativo ? numero.slice(1) : numero;
  const [inteiro = "0", fracao = "00"] = absoluto.split(",");
  const unidades = Number(inteiro.replaceAll(".", ""));
  const restantes = Number(fracao);
  const prefixo = negativo ? "menos " : fala.sinal && (unidades > 0 || restantes > 0) ? "mais " : "";
  if (moeda !== MOEDA_PADRAO) {
    const texto = fala.semCentavos ? inteiro : absoluto;
    return `${prefixo}${texto} ${nomeDaMoeda(moeda, unidades !== 1 || restantes > 0)}`;
  }
  const partes: string[] = [];
  if (unidades > 0 || restantes === 0) partes.push(`${inteiro} ${unidades === 1 ? "real" : "reais"}`);
  if (restantes > 0) partes.push(`${restantes} ${restantes === 1 ? "centavo" : "centavos"}`);
  return prefixo + partes.join(" e ");
}

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
