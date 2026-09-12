using System.Globalization;

namespace Moductus.Core.Text;

/// <summary>
/// Avaliador aritmético recursivo descendente: <c>+ - * / %</c>, parênteses,
/// precedência, sinal unário e decimal com ponto ou com vírgula.
/// </summary>
/// <remarks>
/// Escrito à mão de propósito. As alternativas prontas do .NET para isto
/// (<c>DataTable.Compute</c>, ScriptControl) carregam um motor inteiro para
/// somar dois números, e o projeto não aceita dependência nova.
/// </remarks>
public static class Expression
{
    /// <summary>Teto de entrada: a Palette chama isto a cada tecla digitada.</summary>
    private const int MaxCaracteres = 256;

    /// <summary>Impede que <c>((((((…</c> estoure a pilha do processo.</summary>
    private const int MaxProfundidade = 32;

    /// <summary>
    /// Resolve <paramref name="entrada"/>. Devolve <c>false</c>, sem lançar,
    /// para o que não é expressão aritmética completa — incluindo resultado
    /// infinito ou indefinido, como divisão por zero.
    /// </summary>
    public static bool TryEvaluate(string entrada, out double resultado)
    {
        resultado = 0;

        if (string.IsNullOrWhiteSpace(entrada) || entrada.Length > MaxCaracteres)
        {
            return false;
        }

        var leitor = new Leitor(entrada);

        if (!leitor.Avaliar(out var valor) || !double.IsFinite(valor))
        {
            return false;
        }

        resultado = valor;
        return true;
    }

    private sealed class Leitor(string texto)
    {
        private int _i;

        private bool Fim => _i >= texto.Length;

        public bool Avaliar(out double valor)
        {
            if (!Soma(0, out valor))
            {
                return false;
            }

            PularEspaco();
            return Fim;
        }

        private void PularEspaco()
        {
            while (_i < texto.Length && char.IsWhiteSpace(texto[_i]))
            {
                _i++;
            }
        }

        private bool Soma(int profundidade, out double valor)
        {
            if (!Produto(profundidade, out valor))
            {
                return false;
            }

            while (true)
            {
                PularEspaco();

                if (Fim || (texto[_i] != '+' && texto[_i] != '-'))
                {
                    return true;
                }

                var operador = texto[_i];
                _i++;

                if (!Produto(profundidade, out var direita))
                {
                    return false;
                }

                valor = operador == '+' ? valor + direita : valor - direita;
            }
        }

        private bool Produto(int profundidade, out double valor)
        {
            if (!Unario(profundidade, out valor))
            {
                return false;
            }

            while (true)
            {
                PularEspaco();

                if (Fim || (texto[_i] != '*' && texto[_i] != '/' && texto[_i] != '%'))
                {
                    return true;
                }

                var operador = texto[_i];
                _i++;

                if (!Unario(profundidade, out var direita))
                {
                    return false;
                }

                valor = operador switch
                {
                    '*' => valor * direita,
                    '/' => valor / direita,
                    _ => valor % direita,
                };
            }
        }

        private bool Unario(int profundidade, out double valor)
        {
            PularEspaco();

            if (!Fim && (texto[_i] == '+' || texto[_i] == '-'))
            {
                var negativo = texto[_i] == '-';
                _i++;

                if (!Unario(profundidade + 1, out valor))
                {
                    return false;
                }

                valor = negativo ? -valor : valor;
                return true;
            }

            return Primario(profundidade, out valor);
        }

        private bool Primario(int profundidade, out double valor)
        {
            valor = 0;

            if (profundidade > MaxProfundidade)
            {
                return false;
            }

            PularEspaco();

            if (Fim)
            {
                return false;
            }

            if (texto[_i] != '(')
            {
                return Numero(out valor);
            }

            _i++;

            if (!Soma(profundidade + 1, out valor))
            {
                return false;
            }

            PularEspaco();

            if (Fim || texto[_i] != ')')
            {
                return false;
            }

            _i++;
            return true;
        }

        private bool Numero(out double valor)
        {
            valor = 0;

            var inicio = _i;
            var separadores = 0;

            while (_i < texto.Length)
            {
                var c = texto[_i];

                if (char.IsAsciiDigit(c))
                {
                    _i++;
                    continue;
                }

                if ((c == '.' || c == ',') && separadores == 0)
                {
                    separadores++;
                    _i++;
                    continue;
                }

                break;
            }

            if (_i == inicio)
            {
                return false;
            }

            // Vírgula é separador decimal aqui; o parse sempre roda invariante.
            var bruto = texto[inicio.._i].Replace(',', '.');
            return double.TryParse(bruto, NumberStyles.Float, CultureInfo.InvariantCulture, out valor);
        }
    }
}
