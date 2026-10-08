import { useId, type InputHTMLAttributes } from "react";
import { Icone, type NomeIcone } from "./Icone.tsx";
import "./Campo.css";

interface PropsCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Sempre existe, para o leitor de tela; `rotuloOculto` só o tira da tela. */
  rotulo: string;
  rotuloOculto?: boolean;
  icone?: NomeIcone;
  /** Texto de apoio abaixo do campo, ligado por aria-describedby. */
  dica?: string;
  /** Força o estado visual (só o catálogo usa). */
  "data-estado"?: "hover" | "foco";
}

export function Campo({
  rotulo,
  rotuloOculto,
  icone,
  dica,
  className,
  "data-estado": estado,
  ...resto
}: PropsCampo) {
  const id = useId();
  const idDica = `${id}-dica`;
  return (
    <div className={["campo", className].filter(Boolean).join(" ")} data-estado={estado}>
      <label htmlFor={id} className={rotuloOculto ? "so-leitor" : "campo-rotulo"}>
        {rotulo}
      </label>
      <div className="campo-caixa" data-desativado={resto.disabled || undefined}>
        {icone && <Icone nome={icone} />}
        <input id={id} className="campo-entrada" aria-describedby={dica ? idDica : undefined} {...resto} />
      </div>
      {dica && (
        <span id={idDica} className="campo-dica">
          {dica}
        </span>
      )}
    </div>
  );
}
