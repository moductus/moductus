using System.Windows.Interop;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace Moductus.Core.Interop;

/// <summary>Trata uma mensagem do Windows. Devolve <c>true</c> se consumiu.</summary>
public delegate bool WindowMessageHandler(uint message, nint wParam, nint lParam);

/// <summary>
/// A única janela oculta do processo: alvo de tudo que o Windows manda para
/// o app — <c>WM_HOTKEY</c>, o callback da bandeja, <c>TaskbarCreated</c>,
/// <c>WM_SETTINGCHANGE</c> e o pedido de ativação de uma segunda instância.
/// </summary>
/// <remarks>
/// <para>
/// <b>Não é uma janela <c>HWND_MESSAGE</c>, de propósito.</b> Janela
/// message-only não recebe broadcast, e dois dos itens acima são broadcast:
/// <c>WM_SETTINGCHANGE</c> (tema mudou) e <c>TaskbarCreated</c> (o Explorer
/// reiniciou e levou o ícone). Com <c>HWND_MESSAGE</c> o tema nunca
/// acompanharia o sistema e o ícone nunca voltaria.
/// </para>
/// <para>
/// Então é uma janela top-level comum, só que nunca exibida: <c>WS_POPUP</c>
/// sem <c>WS_VISIBLE</c>, e <c>WS_EX_TOOLWINDOW</c> para ficar fora do Alt+Tab
/// e da barra de tarefas.
/// </para>
/// </remarks>
public sealed class MessageWindow : IDisposable
{
    /// <summary>Título fixo, para que uma segunda instância consiga encontrá-la.</summary>
    public const string Title = "Moductus.Messages";

    private const int WsPopup = unchecked((int)0x80000000);
    private const int WsExToolWindow = 0x00000080;
    private const int WsExNoActivate = 0x08000000;

    private readonly HwndSource _source;
    private readonly List<WindowMessageHandler> _handlers = [];

    public MessageWindow()
    {
        _source = new HwndSource(new HwndSourceParameters(Title)
        {
            WindowStyle = WsPopup,
            ExtendedWindowStyle = WsExToolWindow | WsExNoActivate,
            Width = 0,
            Height = 0,
            PositionX = 0,
            PositionY = 0,
            HwndSourceHook = Hook,
        });
    }

    public nint Handle => _source.Handle;

    /// <summary>Broadcast do sistema: tema, acessibilidade, métricas.</summary>
    public static uint SettingChangeMessage => PInvoke.WM_SETTINGCHANGE;

    /// <summary>Registra uma mensagem nomeada, válida entre processos.</summary>
    public static uint RegisterMessage(string name) => PInvoke.RegisterWindowMessage(name);

    /// <summary>
    /// Procura a janela de mensagens de outra instância. Zero se não houver.
    /// </summary>
    public static unsafe nint FindExisting() =>
        (nint)PInvoke.FindWindowEx(HWND.Null, HWND.Null, null, Title).Value;

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
