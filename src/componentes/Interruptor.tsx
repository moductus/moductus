import { propsAlternavel, type PropsAlternavel } from "./alternavel.ts";
import "./Interruptor.css";

interface PropsInterruptor extends PropsAlternavel {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
}

/** Switch: liga e desliga na hora (sem "salvar"). Espaço e Enter alternam. */
export function Interruptor({ ligado, aoMudar, ...props }: PropsInterruptor) {
  const atributos = propsAlternavel(ligado, aoMudar, [" ", "Enter"], props);
  return (
    <span
      role="switch"
      {...atributos}
      className={["interruptor", atributos.className].filter(Boolean).join(" ")}
    >
      <span className="interruptor-trilho" aria-hidden="true">
        <span className="interruptor-pino" />
      </span>
      {props.children != null && <span className="interruptor-texto">{props.children}</span>}
    </span>
  );
}
