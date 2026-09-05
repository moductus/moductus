using Windows.Win32;
using Windows.Win32.Foundation;

namespace Moductus.Core.Interop;

/// <summary>
/// Guarda e devolve o foco. É o segundo dos três problemas do ARCHITECTURE.md.
/// </summary>
/// <remarks>
/// O Windows bloqueia mudança de foreground vinda de processo que não é o
/// foreground atual. Aqui não precisamos do contorno com
/// <c>AttachThreadInput</c>: a restauração acontece no fechamento da nossa
/// superfície, momento em que <b>nós</b> somos o foreground e temos o direito
/// de passar o foco adiante. Essa é a razão de restaurar no fechamento e não
/// em qualquer outro momento.
/// </remarks>
public static class ForegroundWindow
{
    public static unsafe nint Capture() => (nint)PInvoke.GetForegroundWindow().Value;

    /// <summary>
    /// Toma o foreground para a nossa janela. Devolve <c>false</c> se o
    /// Windows não deixou.
    /// </summary>
    /// <remarks>
    /// A regra do Windows: um processo só pode tomar o foreground se for o
    /// foreground atual, ou se tiver recebido o último evento de entrada. Uma
    /// hotkey registrada deveria contar como isso, e na prática não basta
    /// sempre. O contorno clássico é anexar a fila de entrada da nossa thread
    /// à da thread que tem o foreground, chamar <c>SetForegroundWindow</c>, e
    /// desanexar — por um instante somos "a mesma" thread para o Windows.
    /// </remarks>
    public static unsafe bool Take(nint window)
    {
        var alvo = (HWND)window;

        if (PInvoke.SetForegroundWindow(alvo) && PInvoke.GetForegroundWindow() == alvo)
        {
            return true;
        }

        var atual = PInvoke.GetForegroundWindow();
        if (atual.IsNull)
        {
            return false;
        }

        var threadDoForeground = PInvoke.GetWindowThreadProcessId(atual, null);
        var nossaThread = PInvoke.GetCurrentThreadId();

        if (threadDoForeground == nossaThread)
        {
            return false;
        }

        PInvoke.AttachThreadInput(nossaThread, threadDoForeground, true);

        try
        {
            PInvoke.BringWindowToTop(alvo);
            PInvoke.SetForegroundWindow(alvo);
            PInvoke.SetFocus(alvo);
        }
        finally
        {
            PInvoke.AttachThreadInput(nossaThread, threadDoForeground, false);
        }

        return PInvoke.GetForegroundWindow() == alvo;
    }

    /// <summary>
    /// Devolve o foco. O handle pode ter morrido enquanto a superfície estava
    /// aberta; nesse caso não faz nada e deixa o Windows decidir.
    /// </summary>
    public static void Restore(nint window)
    {
        if (window == 0)
        {
            return;
        }

        var hwnd = (HWND)window;

        if (PInvoke.IsWindow(hwnd))
        {
            PInvoke.SetForegroundWindow(hwnd);
        }
    }
}
