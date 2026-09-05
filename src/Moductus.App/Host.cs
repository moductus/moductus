using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Interop;
using Moductus.Core.Leader;
using Moductus.Core.Modules;
using Moductus.Core.Startup;
using Moductus.Core.Theme;
using Moductus.Core.Tray;
using Moductus.UI;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

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
    private const string LeaderOwner = "leader";
    private const string LeaderKey = "leader";
    private const string LeaderHotkeyKey = "hotkey";
    private const string EnabledKey = "enabled";
    private const string LeaderLetterKey = "leaderKey";
    private const uint VkSpace = 0x20;

    private static readonly HotkeyBinding LeaderDefault =
        new(HotkeyModifiers.Control | HotkeyModifiers.Alt, VkSpace);

    private readonly Application _app;
    private readonly ConfigLocation _location;
    private readonly ConfigStore _config;
    private readonly string? _configWarning;
    private readonly MessageWindow _messages;
    private readonly HotkeyRegistry _hotkeys;
    private readonly LeaderRegistry _letters = new();
    private readonly TrayIcon _tray;
    private readonly Autostart _autostart;
    private readonly Theme _theme;
    private readonly ArchetypeHost _archetypes;
    private readonly IReadOnlyList<IModule> _modules;
    private readonly HashSet<string> _enabled = [];

    private HotkeyRegistration _leader;
    private LeaderOverlay? _overlay;
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
        _leader = _hotkeys.Register(LeaderOwner, LeaderBindingFromConfig(), OnLeader);

        // 4. Bandeja. O ícone é o genérico do sistema até o mark existir
        //    (ponto em aberto no apêndice 13 do PRODUCT.md).
        _tray = new TrayIcon(_messages, StockIcons.Application, "Moductus");
        _tray.LeftClick += OpenSettings;
        _tray.RightClick += ShowMenu;

        // 5. Autostart. Estado vem do registro; não é duplicado na config.
        _autostart = new Autostart(new Win32AutostartRegistry(), Environment.ProcessPath!);

        // Utilizável a partir daqui.

        // 6. Tokens e tema. Depois do ícone de propósito: carregar XAML não
        //    pertence ao caminho crítico, e nenhuma janela existe ainda.
        _theme = new Theme(new Win32SystemThemeSource(), _messages, _app.Resources);

        // 7. Os quatro arquétipos, pré-aquecidos quando o app estiver ocioso.
        _archetypes = new ArchetypeHost();

        // 8. Módulos: Enable() de cada um ativo, e a letra no registro central.
        _modules = ModuleCatalog.Create(new ModuleContext(
            _archetypes,
            _config.ModuleScope,
            _config.Save,
            _theme));

        foreach (var module in _modules.Where(IsEnabledInConfig))
        {
            EnableModule(module);
        }

        _archetypes.Prewarm(_app.Dispatcher);
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

    // ---- Módulos -----------------------------------------------------------

    private bool IsEnabledInConfig(IModule module) =>
        _config.ModuleScope(module.Id)[EnabledKey]?.GetValue<bool>() ?? true;

    private char LetterFor(IModule module)
    {
        var configurada = _config.ModuleScope(module.Id)[LeaderLetterKey]?.GetValue<string>();
        return !string.IsNullOrEmpty(configurada) ? configurada[0] : module.SuggestedLeaderKey;
    }

    private void EnableModule(IModule module)
    {
        module.Enable();
        _letters.Register(LetterFor(module), module.Id, module.Name, module.Description, module.Invoke);
        _enabled.Add(module.Id);
    }

    private void DisableModule(IModule module)
    {
        _letters.Unregister(module.Id);
        module.Disable();
        _enabled.Remove(module.Id);
    }

    private void SetModuleEnabled(string id, bool enabled)
    {
        var module = _modules.First(m => m.Id == id);

        if (enabled && !_enabled.Contains(id))
        {
            EnableModule(module);
        }
        else if (!enabled && _enabled.Contains(id))
        {
            DisableModule(module);
        }

        _config.ModuleScope(id)[EnabledKey] = enabled;
        _config.Save();
    }

    // ---- Tecla líder -------------------------------------------------------

    private HotkeyBinding LeaderBindingFromConfig()
    {
        var texto = _config.Root[LeaderKey]?[LeaderHotkeyKey]?.GetValue<string>();
        return HotkeyBinding.TryParse(texto, out var binding) ? binding : LeaderDefault;
    }

    /// <summary>
    /// Troca a tecla líder. Nunca deixa o usuário sem líder: se a nova
    /// combinação conflita, a anterior é mantida e o pedido falho é devolvido
    /// para a tela mostrar o motivo.
    /// </summary>
    private HotkeyRegistration RebindLeader(HotkeyBinding binding)
    {
        if (binding == _leader.Binding)
        {
            return _leader;
        }

        var tentativa = _hotkeys.Register(LeaderOwner, binding, OnLeader);

        if (!tentativa.Active)
        {
            _hotkeys.Unregister(tentativa.Id);
            return tentativa;
        }

        _hotkeys.Unregister(_leader.Id);
        _leader = tentativa;

        if (_config.Root[LeaderKey] is not JsonObject leader)
        {
            leader = [];
            _config.Root[LeaderKey] = leader;
        }

        leader[LeaderHotkeyKey] = binding.ToString();
        _config.Save();

        return _leader;
    }

    private void OnLeader()
    {
        _overlay ??= new LeaderOverlay(_letters.TryInvoke);

        if (_overlay.IsVisible)
        {
            _overlay.Dismiss();
            return;
        }

        _overlay.SetEntries(_letters.All
            .Where(r => r.Active)
            .Select(r => new LeaderEntry(r.Key, r.Name, r.Description)));
        _overlay.Present();
    }

    // ---- Mensagens e superfícies do host -----------------------------------

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

    private void OpenSettings()
    {
        if (_settings is null || !_settings.IsLoaded)
        {
            _settings = new SettingsWindow(new SettingsModel(
                _autostart,
                _hotkeys,
                _letters,
                _location,
                _theme,
                _configWarning,
                Leader: () => _leader,
                RebindLeader: RebindLeader,
                Modules: _modules,
                IsModuleEnabled: id => _enabled.Contains(id),
                SetModuleEnabled: SetModuleEnabled));
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
        foreach (var module in _modules.Where(m => _enabled.Contains(m.Id)))
        {
            module.Disable();
        }

        _settings?.Close();
        _overlay?.Close();
        _archetypes.Dispose();
        _theme.Dispose();
        _tray.Dispose();
        _hotkeys.UnregisterAll();
        _messages.Dispose();
    }
}
