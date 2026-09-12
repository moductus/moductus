using System.Diagnostics;

namespace Moductus.Core.Interop;

/// <summary>Perguntas sobre processo alheio que podem simplesmente não ter resposta.</summary>
public static class Processes
{
    /// <summary>
    /// O nome do processo de um pid, ou <c>null</c> quando não dá para saber.
    /// </summary>
    /// <remarks>
    /// Falha por dois motivos que o app não controla e não distingue: o
    /// processo morreu entre a enumeração e a pergunta, ou é serviço do sistema
    /// e ler exige elevação. Quem chama escolhe o que dizer na interface —
    /// "processo desconhecido" quando a lista é de janelas do usuário,
    /// "requer elevação" quando a lista é de portas —, porque esconder a
    /// limitação gera mais desconfiança que admiti-la.
    /// </remarks>
    public static string? NameOf(uint pid)
    {
        try
        {
            return Process.GetProcessById((int)pid).ProcessName;
        }
        catch
        {
            return null;
        }
    }
}
