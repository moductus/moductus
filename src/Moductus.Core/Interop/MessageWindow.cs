using System.Windows.Interop;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace Moductus.Core.Interop;

/// <summary>Trata uma mensagem do Windows. Devolve <c>true</c> se consumiu.</summary>
public delegate bool WindowMessageHandler(uint message, nint wParam, nint lParam);

/// <summary>
/// A única janela <c>HWND_MESSAGE</c> do processo: invisível, fora do Alt+Tab,
/// e alvo de tudo que o Windows manda para o app — <c>WM_HOTKEY</c>, o
/// callback da bandeja, <c>TaskbarCreated</c>, <c>WM_SETTINGCHANGE</c> e o
/// pedido de ativação de uma segunda instância.
/// </summary>
public sealed class MessageWindow : IDisposable
{
    /// <summary>Título fixo, para que uma segunda instância consiga encontrá-la.</summary>
    public const string Title = "Moductus.Messages";

    private const int HwndMessage = -3;

    private readonly HwndSource _source;
    private readonly List<WindowMessageHandler> _handlers = [];

    public MessageWindow()
    {
        _source = new HwndSource(new HwndSourceParameters(Title)
        {
            ParentWindow = new IntPtr(HwndMessage),
            HwndSourceHook = Hook,
        });
    }

    public nint Handle => _source.Handle;

    /// <summary>Registra uma mensagem nomeada, válida entre processos.</summary>
    public static uint RegisterMessage(string name) => PInvoke.RegisterWindowMessage(name);

    /// <summary>
    /// Procura a janela de mensagens de outra instância. Zero se não houver.
    /// </summary>
    public static unsafe nint FindExisting() =>
        (nint)PInvoke.FindWindowEx(new HWND(HwndMessage), HWND.Null, null, Title).Value;

    public static void Post(nint window, uint message) =>
        PInvoke.PostMessage((HWND)window, message, default, default);

    public void AddHandler(WindowMessageHandler handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _handlers.Add(handler);
    }

    public void RemoveHandler(WindowMessageHandler handler) => _handlers.Remove(handler);

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        var message = unchecked((uint)msg);

        // Cópia, porque um handler pode se remover durante o despacho.
        foreach (var handler in _handlers.ToArray())
        {
            if (handler(message, wParam, lParam))
            {
                handled = true;
                break;
            }
        }

        return IntPtr.Zero;
    }

    public void Dispose()
    {
        _handlers.Clear();
        _source.Dispose();
    }
}
