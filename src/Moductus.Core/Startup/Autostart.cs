namespace Moductus.Core.Startup;

public enum AutostartState
{
    /// <summary>Não há entrada de inicialização.</summary>
    Off,

    /// <summary>Entrada presente e aprovada: o app sobe no logon.</summary>
    On,

    /// <summary>
    /// A entrada existe, mas o usuário a desligou pela aba Inicializar do
    /// Gerenciador de Tarefas. O app <b>não</b> sobe.
    /// </summary>
    DisabledByUser,

    /// <summary>
    /// A entrada aponta para outro caminho — o executável foi movido, ou há
    /// duas cópias. Quem sobe no logon não é este binário.
    /// </summary>
    PointsElsewhere,
}

/// <summary>
/// Os dois valores de registro que, juntos, dizem se o app sobe no logon.
/// </summary>
/// <remarks>
/// São dois porque o Windows não apaga a chave <c>Run</c> quando o usuário
/// desliga a entrada pela aba Inicializar: ele grava um veto separado em
/// <c>StartupApproved</c>. Ler só a chave <c>Run</c> faz a configuração
/// afirmar "ligado" enquanto o app não sobe, e o usuário conclui que o
/// Moductus quebrou.
/// </remarks>
public interface IAutostartRegistry
{
    string? ReadRunCommand();

    void WriteRunCommand(string command);

    void DeleteRunCommand();

    byte[]? ReadStartupApproved();

    void DeleteStartupApproved();
}

/// <summary>Iniciar com o Windows, via chave <c>Run</c> do usuário atual.</summary>
/// <remarks>
/// Chave <c>Run</c> em vez de Task Scheduler por decisão registrada: é o
/// mecanismo mais auditável, aparece na aba Inicializar onde o usuário já
/// sabe desligar, e não exige elevação nem dependência. Ver a decisão 21 do
/// PRODUCT.md.
/// </remarks>
public sealed class Autostart(IAutostartRegistry registry, string executablePath)
{
    private readonly IAutostartRegistry _registry = registry ?? throw new ArgumentNullException(nameof(registry));
    private readonly string _command = Quote(executablePath);

    public AutostartState State
    {
        get
        {
            var atual = _registry.ReadRunCommand();

            if (string.IsNullOrWhiteSpace(atual))
            {
                return AutostartState.Off;
            }

            if (!string.Equals(atual.Trim(), _command, StringComparison.OrdinalIgnoreCase))
            {
                return AutostartState.PointsElsewhere;
            }

            return IsApproved(_registry.ReadStartupApproved())
                ? AutostartState.On
                : AutostartState.DisabledByUser;
        }
    }

    /// <summary>
    /// Liga. Também limpa o veto do Gerenciador de Tarefas, para que "ligar"
    /// signifique ligar mesmo quando o usuário tinha desligado por lá.
    /// </summary>
    public void Enable()
    {
        _registry.WriteRunCommand(_command);
        _registry.DeleteStartupApproved();
    }

    public void Disable()
    {
        _registry.DeleteRunCommand();
        _registry.DeleteStartupApproved();
    }

    /// <summary>
    /// Interpreta o valor binário de <c>StartupApproved</c>.
    /// </summary>
    /// <remarks>
    /// O formato não é documentado. O que se observa: 12 bytes, o primeiro
    /// vale <c>0x02</c> ou <c>0x06</c> quando habilitado e <c>0x03</c> quando
    /// desabilitado, e o restante é timestamp. A regra "primeiro byte ímpar
    /// significa desligado" cobre todas as variantes vistas. Valor ausente
    /// significa que o usuário nunca mexeu, portanto habilitado.
    /// </remarks>
    internal static bool IsApproved(byte[]? value) =>
        value is null || value.Length == 0 || (value[0] & 0x01) == 0;

    private static string Quote(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return $"\"{path.Trim().Trim('"')}\"";
    }
}
