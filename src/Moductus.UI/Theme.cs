using System.Windows;
using Moductus.Core.Interop;
using Moductus.Core.Theme;

// O WPF do .NET 9+ trouxe System.Windows.ThemeMode (tema Fluent). O nosso é o do Core.
using ThemeMode = Moductus.Core.Theme.ThemeMode;

namespace Moductus.UI;

/// <summary>
/// Aplica os tokens e mantém a paleta e o movimento sincronizados com o
/// sistema: claro, escuro, alto contraste e animações reduzidas.
/// </summary>
/// <remarks>
/// A estrutura (tipografia, espaço, raio) é carregada uma vez. Só dois
/// dicionários são trocados em tempo de execução — a paleta e o movimento —
/// e todo consumidor usa <c>DynamicResource</c>, então a troca propaga sem
/// reconstruir janela nenhuma.
/// </remarks>
public sealed class Theme : IDisposable
{
    private const string Pacote = "pack://application:,,,/Moductus.UI;component/Tokens/";

    private static readonly Uri Tokens = new(Pacote + "Tokens.xaml");
    private static readonly Uri Controles = new(Pacote + "Controls.xaml");
    private static readonly Uri Movimento = new(Pacote + "Motion.xaml");
    private static readonly Uri MovimentoReduzido = new(Pacote + "Motion.Reduced.xaml");

    private readonly ISystemThemeSource _source;
    private readonly MessageWindow _messages;
    private readonly ResourceDictionary _target;
    private readonly WindowMessageHandler _handler;

    private ResourceDictionary? _paleta;
    private ResourceDictionary? _motion;

    public Theme(ISystemThemeSource source, MessageWindow messages, ResourceDictionary target)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        _messages = messages ?? throw new ArgumentNullException(nameof(messages));
        _target = target ?? throw new ArgumentNullException(nameof(target));

        // Ordem importa: Controls referencia chaves de Tokens via StaticResource.
        _target.MergedDictionaries.Add(new ResourceDictionary { Source = Tokens });
        _target.MergedDictionaries.Add(new ResourceDictionary { Source = Controles });

        Apply();

        _handler = OnMessage;
        _messages.AddHandler(_handler);
    }

    public ThemeMode Mode { get; private set; }

    public bool ReducedMotion { get; private set; }

    /// <summary>Disparado depois que a paleta ou o movimento mudam.</summary>
    public event Action? Changed;

    /// <summary>Relê o sistema e troca o que mudou.</summary>
    public void Apply()
    {
        var mode = ThemeResolver.Resolve(_source);
        var reduced = !_source.ClientAreaAnimation;

        var mudou = false;

        // Alto contraste é sempre reaplicado, porque as cores são snapshot do
        // sistema e podem ter mudado sem o modo mudar.
        if (mode != Mode || _paleta is null || mode == ThemeMode.HighContrast)
        {
            Swap(ref _paleta, new ResourceDictionary { Source = PaletaDe(mode) });
            Mode = mode;
            mudou = true;
        }

        if (reduced != ReducedMotion || _motion is null)
        {
            Swap(ref _motion, new ResourceDictionary { Source = reduced ? MovimentoReduzido : Movimento });
            ReducedMotion = reduced;
            mudou = true;
        }

        if (mudou)
        {
            Changed?.Invoke();
        }
    }

    private static Uri PaletaDe(ThemeMode mode) => new(Pacote + mode switch
    {
        ThemeMode.Light => "Palette.Light.xaml",
        ThemeMode.HighContrast => "Palette.HighContrast.xaml",
        _ => "Palette.Dark.xaml",
    });

    private void Swap(ref ResourceDictionary? atual, ResourceDictionary novo)
    {
        if (atual is not null)
        {
            _target.MergedDictionaries.Remove(atual);
        }

        _target.MergedDictionaries.Add(novo);
        atual = novo;
    }

    private bool OnMessage(uint message, nint wParam, nint lParam)
    {
        if (message == MessageWindow.SettingChangeMessage)
        {
            Apply();
        }

        // Nunca consome: outros interessados no WM_SETTINGCHANGE precisam vê-lo.
        return false;
    }

    public void Dispose() => _messages.RemoveHandler(_handler);
}
