using System.Windows;

namespace Moductus.App;

public partial class App : Application
{
    private SingleInstance? _instance;
    private Host? _host;

    private void OnStartup(object sender, StartupEventArgs e)
    {
        // Antes de qualquer outra coisa. Uma segunda instância falharia em
        // registrar toda hotkey e ficaria visivelmente rodando e inerte.
        _instance = new SingleInstance();

        if (!_instance.IsFirst)
        {
            SingleInstance.SignalExisting();
            Shutdown();
            return;
        }

        _host = new Host(this);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _host?.Dispose();
        _instance?.Dispose();
        base.OnExit(e);
    }
}
