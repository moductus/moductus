using Moductus.Core.Interop;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace Moductus.Core.Clipboard;

/// <summary>
/// Avisa quando o clipboard muda, via <c>AddClipboardFormatListener</c> na
/// janela oculta. Só avisa: quem lê o conteúdo é quem assinou, e só se
/// estiver ativo — o listener existe apenas enquanto o Clips existe.
/// </summary>
public sealed class ClipboardWatcher : IDisposable
{
    private readonly MessageWindow _window;
    private readonly WindowMessageHandler _handler;

    public ClipboardWatcher(MessageWindow window)
    {
        _window = window ?? throw new ArgumentNullException(nameof(window));
        _handler = OnMessage;
        _window.AddHandler(_handler);
        PInvoke.AddClipboardFormatListener((HWND)_window.Handle);
    }

    public event Action? Changed;

    private bool OnMessage(uint message, nint wParam, nint lParam)
    {
        if (message != PInvoke.WM_CLIPBOARDUPDATE)
        {
            return false;
        }

        Changed?.Invoke();
        return true;
    }

    public void Dispose()
    {
        PInvoke.RemoveClipboardFormatListener((HWND)_window.Handle);
        _window.RemoveHandler(_handler);
    }
}
