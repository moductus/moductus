using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Power;
using Windows.Win32.System.Threading;

namespace Moductus.Core.Interop;

/// <summary>Impede o sistema de hibernar e a tela de desligar.</summary>
/// <remarks>
/// Usa requisição de energia — <c>PowerCreateRequest</c> e <c>PowerSetRequest</c> —
/// e não <c>SetThreadExecutionState</c>. A API antiga só reseta contadores de
/// ociosidade, e numa máquina com Modern Standby, que é o padrão em notebook
/// novo, ela entra em connected standby minutos depois de a tela apagar: o caso
/// de uso mais pedido, "deixe a tela dormir mas segure meu download", é
/// justamente o que falhava. A requisição de energia é respeitada em S0 e ainda
/// aparece nominalmente em <c>powercfg /requests</c>, o que torna o estado
/// auditável de fora do app. Ver docs/PRODUCT.md §10, "Awake".
///
/// Sistema e tela são duas requisições separadas no mesmo handle, porque
/// segurar a máquina e segurar a tela são pedidos independentes.
/// </remarks>
public static class Power
{
    private static SafeHandle? _pedido;
    private static bool _sistema;
    private static bool _tela;

    public static bool KeepAwake(bool keepDisplayOn)
    {
        var pedido = Abrir();

        if (pedido is null)
        {
            return false;
        }

        var ok = Ligar(pedido, POWER_REQUEST_TYPE.PowerRequestSystemRequired, ref _sistema, true);
        ok &= Ligar(pedido, POWER_REQUEST_TYPE.PowerRequestDisplayRequired, ref _tela, keepDisplayOn);

        return ok;
    }

    public static void AllowSleep()
    {
        if (_pedido is null)
        {
            return;
        }

        Ligar(_pedido, POWER_REQUEST_TYPE.PowerRequestSystemRequired, ref _sistema, false);
        Ligar(_pedido, POWER_REQUEST_TYPE.PowerRequestDisplayRequired, ref _tela, false);

        _pedido.Dispose();
        _pedido = null;

        // Zerado mesmo se o PowerClearRequest tiver falhado: as requisições
        // morrem com o handle de qualquer forma, e um flag que sobrevive faria
        // o próximo KeepAwake achar que já está ligado e não pedir nada — o
        // Awake acenderia na tela com a máquina livre para dormir.
        _sistema = false;
        _tela = false;
    }

    /// <summary>
    /// O handle vive enquanto o Awake estiver ligado. O texto vai junto e é o
    /// que <c>powercfg /requests</c> mostra ao lado do nome do processo.
    /// </summary>
    private static unsafe SafeHandle? Abrir()
    {
        if (_pedido is not null)
        {
            return _pedido;
        }

        fixed (char* motivo = "Moductus: Awake ligado")
        {
            var contexto = new REASON_CONTEXT
            {
                Version = PInvoke.POWER_REQUEST_CONTEXT_VERSION,
                Flags = POWER_REQUEST_CONTEXT_FLAGS.POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason = new REASON_CONTEXT._Reason_e__Union { SimpleReasonString = motivo },
            };

            var handle = PInvoke.PowerCreateRequest(contexto);
            _pedido = handle.IsInvalid ? null : handle;
        }

        return _pedido;
    }

    /// <summary>Liga ou desliga uma requisição, e só quando o estado muda.</summary>
    private static bool Ligar(SafeHandle pedido, POWER_REQUEST_TYPE tipo, ref bool ligado, bool querLigado)
    {
        if (ligado == querLigado)
        {
            return true;
        }

        var ok = querLigado
            ? PInvoke.PowerSetRequest(pedido, tipo)
            : PInvoke.PowerClearRequest(pedido, tipo);

        if (ok)
        {
            ligado = querLigado;
        }

        return ok;
    }
}
