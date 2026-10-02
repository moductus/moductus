namespace Moductus.Core.Text;

/// <summary>
/// Há quanto tempo, dito como gente diz: "há 5 s", "há 2 min". É o
/// "Atualizado há …" do rodapé do Ports.
/// </summary>
public static class Elapsed
{
    /// <summary>Abaixo disto, o número mudaria mais rápido do que se lê.</summary>
    private static readonly TimeSpan Agora = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Arredonda para baixo em cada degrau: "há 59 s" e depois "há 1 min",
    /// nunca "há 1 min" com 40 segundos. Tempo negativo — relógio acertado
    /// para trás — é "agora", não um número com sinal.
    /// </summary>
    public static string Since(TimeSpan decorrido)
    {
        if (decorrido < Agora)
        {
            return "agora";
        }

        if (decorrido < TimeSpan.FromMinutes(1))
        {
            return $"há {(int)decorrido.TotalSeconds} s";
        }

        if (decorrido < TimeSpan.FromHours(1))
        {
            return $"há {(int)decorrido.TotalMinutes} min";
        }

        return $"há {(int)decorrido.TotalHours} h";
    }
}
