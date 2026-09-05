using System.IO;
using System.Windows;
using System.Windows.Controls;
using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Interop;
using Moductus.Core.Startup;
using Moductus.Core.Tray;

namespace Moductus.App;

/// <summary>
/// A raiz de composição. O único lugar que sabe como as peças se encaixam.
/// </summary>
/// <remarks>
/// A ordem no construtor é o caminho crítico do startup, com orçamento de
/// 300ms até o ícone aparecer. Nada aqui faz I/O grande nem constrói janela.
/// </remarks>
internal sealed class Host : IDisposable
{
    private const uint VkSpace = 0x20;

    private static readonly HotkeyBinding LeaderDefault =
        new(HotkeyModifiers.Control | HotkeyModifiers.Alt, VkSpace);

    private readonly Application _app;
    private readonly ConfigLocation _location;
    private readonly ConfigStore _config;
    private readonly string? _configWarning;
    private readonly MessageWindow _messages;
    private readonly HotkeyRegistry _hotkeys;
    private readonly TrayIcon _tray;
    private readonly Autostart _autostart;

    private SettingsWindow? _settings;

    public Host(Application app)
    {
        _app = app;

        // 1. Config — tudo depende dela.
        _location = ConfigLocation.Resolve(
            AppContext.BaseDirectory,
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
        (_config, _configWarning) = LoadConfig(_location);

        // 2. A janela oculta que recebe tudo do Windows.
        _messages = new MessageWindow();
        _messages.AddHandler(OnMessage);

        // 3. Hotkeys. Só a líder por padrão; conflito fica visível na configuração.
        _hotkeys = new HotkeyRegistry(new Win32HotkeySink(_messages.Handle));
        _hotkeys.Register("leader", LeaderDefault, OnLeader);

        // 4. Bandeja. O ícone é o genérico do sistema até o mark existir
        //    (ponto em aberto no apêndice 13 do PRODUCT.md).
        _tray = new TrayIcon(_messages, StockIcons.Application, "Moductus");
        _tray.LeftClick += OpenSettings;
        _tray.RightClick += ShowMenu;

        // 5. Autostart. Estado vem do registro; não é duplicado na config.
        _autostart = new Autostart(new Win32AutostartRegistry(), Environment.ProcessPath!);

        // Utilizável a partir daqui.
    }

    private static (ConfigStore, string?) LoadConfig(ConfigLocation location)
    {
        var file = new PhysicalConfigFile(location.Path);

        try
        {
            return (ConfigStore.Load(file), null);
        }
        catch (ConfigCorruptException)
        {
            // Política do host: nunca apagar. Guarda o original e começa do
            // zero, avisando na configuração.
            var backup = $"{location.Path}.corrompido-{DateTime.Now:yyyyMMdd-HHmmss}";
            File.Move(location.Path, backup);

            return (ConfigStore.Load(file),
                $"A configuração estava ilegível. O arquivo original foi guardado em {backup} e uma nova foi criada.");
        }
    }

    private bool OnMessage(uint message, nint wParam, nint lParam)
    {
        if (message == HotkeyRegistry.WindowsMessage)
        {
            return _hotkeys.Dispatch((int)wParam);
        }

        if (message == SingleInstance.ActivateMessage)
        {
            OpenSettings();
            return true;
        }

        return false;
    }

    // Provisório: até o LeaderOverlay existir (passo 7), a tecla líder alterna
    // a configuração. Serve para provar o caminho WM_HOTKEY de ponta a ponta.
    private void OnLeader()
    {
        if (_settings is { IsVisible: true })
        {
            _settings.Close();
        }
        else
        {
            OpenSettings();
        }
    }

    private void OpenSettings()
    {
        if (_settings is null || !_settings.IsLoaded)
        {
            _settings = new SettingsWindow(_autostart, _hotkeys, _location, _configWarning);
            _settings.Closed += (_, _) => _settings = null;
        }

        _settings.Show();
        _settings.Activate();
    }

    private void ShowMenu()
    {
        var menu = new ContextMenu();

        var configuracoes = new MenuItem { Header = "Configurações" };
        configuracoes.Click += (_, _) => OpenSettings();

        var sair = new MenuItem { Header = "Sair" };
        sair.Click += (_, _) => _app.Shutdown();

        menu.Items.Add(configuracoes);
        menu.Items.Add(new Separator());
        menu.Items.Add(sair);

        // A dança do foreground. Sem isto o menu não fecha ao clicar fora.
        _tray.PrepareForMenu();
        menu.IsOpen = true;
    }

    public void Dispose()
    {
        _settings?.Close();
        _tray.Dispose();
        _hotkeys.UnregisterAll();
        _messages.Dispose();
    }
}
