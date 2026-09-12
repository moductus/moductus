using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;
using System.Windows.Controls;
using Moductus.Core.Commands;
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
    // M de Moductus. Ctrl+Alt+Space era o padrão e colide com o Claude Code —
    // o público-alvo exato. Ver a tabela de combinações a evitar no PRODUCT.md.
    private const uint VkM = 0x4D;

    private static readonly HotkeyBinding LeaderDefault =
        new(HotkeyModifiers.Control | HotkeyModifiers.Alt, VkM);

    private readonly Application _app;
    private readonly ConfigLocation _location;
    private readonly ConfigStore _config;
    private readonly string? _configWarning;
    private readonly MessageWindow _messages;
    private readonly HotkeyRegistry _hotkeys;
    private readonly LeaderRegistry _letters = new();
    private readonly CommandRegistry _commands = new();
    private readonly TrayHost _tray;
    private readonly Autostart _autostart;
    private readonly Theme _theme;
    private readonly ArchetypeHost _archetypes;
    private readonly IReadOnlyList<IModule> _modules;
    private readonly HashSet<string> _enabled = [];

    private HotkeyRegistration _leader;
    private LeaderOverlay? _overlay;
    private SettingsWindow? _settings;
    private HelpWindow? _help;

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

        // 4. Bandeja. O mark é desenhado em código, no tamanho que a bandeja
        //    pedir — placeholder até o mark de verdade existir (apêndice 13).
        var sistema = new Win32SystemThemeSource();
        _tray = new TrayHost(_messages, sistema, "Moductus");
        _tray.LeftClick += OpenSettings;
        _tray.RightClick += ShowMenu;

        // 5. Autostart. Estado vem do registro; não é duplicado na config.
        _autostart = new Autostart(new Win32AutostartRegistry(), Environment.ProcessPath!);

        // Utilizável a partir daqui.

        // 6. Tokens e tema. Depois do ícone de propósito: carregar XAML não
        //    pertence ao caminho crítico, e nenhuma janela existe ainda.
        _theme = new Theme(sistema, _messages, _app.Resources);

        // Barra de tarefas clara pede mark escuro: o ícone acompanha o tema.
        _theme.Changed += _tray.Invalidate;

        // 7. Os quatro arquétipos, pré-aquecidos quando o app estiver ocioso.
        _archetypes = new ArchetypeHost();

        // 8. Módulos: Enable() de cada um ativo, e a letra no registro central.
        //    O host oferece à Palette o que é dele: configurações e sair.
        _commands.Register("host", new PaletteCommand("settings", "Configurações", "Abrir a janela de configurações", null, OpenSettings));
        _commands.Register("host", new PaletteCommand("quit", "Sair do Moductus", null, null, () => _app.Shutdown()));

        _modules = ModuleCatalog.Create(new ModuleContext(
            _archetypes,
            _config.ModuleScope,
            _config.Save,
            Path.GetDirectoryName(_location.Path)!,
            _theme,
            _commands,
            _messages,
            _tray));

        foreach (var module in _modules.Where(IsEnabledInConfig))
        {
            EnableModule(module);
        }

        _archetypes.Prewarm(_app.Dispatcher);
        OpenHelpOnFirstRun();
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
        _config.ModuleScope(module.Id)[EnabledKey]?.GetValue<bool>() ?? module.EnabledByDefault;

    private char LetterFor(IModule module)
    {
        var configurada = _config.ModuleScope(module.Id)[LeaderLetterKey]?.GetValue<string>();
        return !string.IsNullOrEmpty(configurada) ? configurada[0] : module.SuggestedLeaderKey;
    }

    private void EnableModule(IModule module)
    {
        module.Enable();
        var letra = _letters.Register(LetterFor(module), module.Id, module.Name, module.Description, module.Invoke);
        _enabled.Add(module.Id);

        // Todo módulo ativo vira "Abrir X" na Palette — menos a própria Palette.
        if (module.Archetype != ModuleArchetype.Palette)
        {
            _commands.Register($"module:{module.Id}", new PaletteCommand(
                $"open:{module.Id}",
                $"Abrir {module.Name}",
                module.Description,
                letra.Active ? letra.Key.ToString().ToUpperInvariant() : null,
                module.Invoke));
        }
    }

    private void DisableModule(IModule module)
    {
        _commands.Unregister($"module:{module.Id}");
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

    /// <summary>
    /// O menu da bandeja é a única superfície permanente do produto, e era só
    /// "Configurações" e "Sair" — não dava para chegar a nenhum módulo por ali.
    /// Agora cada módulo ativo tem entrada própria: a principal abre o módulo e
    /// o submenu expõe os comandos que ele registrou na Palette. É a rota de
    /// descoberta para quem ainda não decorou as letras, e a saída para quando
    /// a tecla líder colide com outro app.
    /// </summary>
    private const string AjudaVistaKey = "helpSeen";

    /// <summary>
    /// Abre a ajuda uma vez, na primeira execução. Um app sem janela
    /// principal, acionado por uma combinação que ninguém adivinha, é
    /// indistinguível de um app quebrado se ninguém explicar.
    /// </summary>
    private void OpenHelpOnFirstRun()
    {
        if (_config.Root[AjudaVistaKey]?.GetValue<bool>() == true)
        {
            return;
        }

        // Fora do caminho crítico: o ícone da bandeja aparece primeiro.
        _app.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, OpenHelp);
    }

    private void OpenHelp()
    {
        if (_help is null || !_help.IsLoaded)
        {
            _help = new HelpWindow(
                _theme,
                _hotkeys.All.FirstOrDefault(h => h.Owner == LeaderOwner)?.Binding.ToString() ?? "Ctrl+Alt+M",
                [.. _modules.Where(m => _enabled.Contains(m.Id))],
                _letters.All,
                _config.Root[AjudaVistaKey]?.GetValue<bool>() != true,
                abrirNoInicio =>
                {
                    _config.Root[AjudaVistaKey] = !abrirNoInicio;
                    _config.Save();
                });

            _help.Closed += (_, _) => _help = null;

            // Ter aberto já conta como visto: quem fechou sem marcar a caixa
            // não quer isso na cara toda vez que a máquina liga.
            _config.Root[AjudaVistaKey] = true;
            _config.Save();
        }

        _help.Show();
        _help.Activate();
    }

    private void ShowMenu()
    {
        var menu = new ContextMenu();

        foreach (var module in _modules.Where(m => _enabled.Contains(m.Id)))
        {
            menu.Items.Add(MenuDoModulo(module));
        }

        if (menu.Items.Count > 0)
        {
            menu.Items.Add(new Separator());
        }

        var ajuda = new MenuItem { Header = "Como usar" };
        ajuda.Click += (_, _) => OpenHelp();

        var configuracoes = new MenuItem { Header = "Configurações" };
        configuracoes.Click += (_, _) => OpenSettings();

        var sair = new MenuItem { Header = "Sair" };
        sair.Click += (_, _) => _app.Shutdown();

        menu.Items.Add(ajuda);
        menu.Items.Add(configuracoes);
        menu.Items.Add(new Separator());
        menu.Items.Add(sair);

        // A dança do foreground. Sem isto o menu não fecha ao clicar fora.
        _tray.PrepareForMenu();
        menu.IsOpen = true;
    }

    private MenuItem MenuDoModulo(IModule module)
    {
        var letra = _letters.All.FirstOrDefault(r => r.ModuleId == module.Id);

        var item = new MenuItem
        {
            Header = module.Name,
            // A letra aparece no lugar do atalho: quem usa o menu duas vezes
            // aprende a tecla e para de precisar do menu.
            InputGestureText = letra is { Active: true } ? letra.Key.ToString().ToUpperInvariant() : null,
            ToolTip = module.Description,
        };

        // Módulo sem superfície (Awake, Mic, Timer) age no clique; os outros
        // abrem a própria janela. Nos dois casos é o mesmo Invoke da hotkey.
        item.Click += (_, _) => module.Invoke();

        foreach (var comando in _commands.Of(module.Id))
        {
            var sub = new MenuItem { Header = comando.Text, ToolTip = comando.Detail };
            sub.Click += (_, _) => comando.Execute();
            item.Items.Add(sub);
        }

        return item;
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
