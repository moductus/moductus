using Windows.Win32;
using Windows.Win32.System.Power;

namespace Moductus.Core.Interop;

/// <summary>Impede o sistema de hibernar e a tela de desligar.</summary>
/// <remarks>
/// <c>ES_CONTINUOUS</c> é por thread: o estado vale até a mesma thread
/// chamar de novo. Chame sempre da thread de UI.
/// </remarks>
public static class Power
{
    public static bool KeepAwake(bool keepDisplayOn)
    {
        var estado = EXECUTION_STATE.ES_CONTINUOUS | EXECUTION_STATE.ES_SYSTEM_REQUIRED;

        if (keepDisplayOn)
        {
            estado |= EXECUTION_STATE.ES_DISPLAY_REQUIRED;
        }

        return PInvoke.SetThreadExecutionState(estado) != 0;
    }

    public static void AllowSleep() => PInvoke.SetThreadExecutionState(EXECUTION_STATE.ES_CONTINUOUS);
}
