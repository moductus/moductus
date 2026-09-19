using System.Windows;
using System.Windows.Media;
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
/// <para>
/// A estrutura (tipografia, espaço, raio) é carregada uma vez. Só três
/// dicionários são trocados em tempo de execução — a paleta, o movimento e os
/// pincéis ajustáveis — e todo consumidor usa <c>DynamicResource</c>, então a
/// troca propaga sem reconstruir janela nenhuma.
/// </para>
/// <para>
/// É essa propagação que faz a opacidade das superfícies valer na hora: não
/// existe observador de configuração neste app, e empurrar o valor para cada
/// janela viva alcançaria as de agora e esqueceria as de depois.
/// </para>
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
    private ResourceDictionary? _tinta;

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

    /// <summary>
    /// Quanto das superfícies que ficam na tela — a pastilha e o Panel — se
    /// pinta, em porcentagem do que a paleta já define. Só tem efeito onde o
    /// DWM aceitou pintar material atrás da janela: sem material a superfície
    /// continua opaca de propósito, senão sobraria o fundo da própria janela
    /// aparecendo por baixo.
    /// </summary>
    public int Opacity { get; private set; } = Opacidade.Padrao;

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

            // Os pincéis ajustáveis saem das cores da paleta: paleta nova,
            // pincéis novos.
            Tingir();
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

    /// <summary>
    /// Troca a opacidade das superfícies que ficam. Aplica de imediato nas
    /// janelas já abertas e nas que ainda vão nascer, porque quem muda é o
    /// recurso, não a instância.
    /// </summary>
    public void ApplyOpacity(int porcento)
    {
        porcento = Opacidade.Faixa(porcento);

        if (porcento == Opacity && _tinta is not null)
        {
            return;
        }

        Opacity = porcento;
        Tingir();
    }

    /// <summary>
    /// Reconstrói os pincéis que dependem da opacidade escolhida, a partir das
    /// cores da paleta em vigor.
    /// </summary>
    /// <remarks>
    /// A transparência vai no canal alfa do pincel, nunca em
    /// <see cref="UIElement.Opacity"/>: aquela cascateia para a árvore inteira
    /// e levaria junto o texto, a dica, o glifo e o ponto colorido. E nunca em
    /// <c>Window.Opacity</c> ou <c>AllowsTransparency</c>, que ligam
    /// <c>WS_EX_LAYERED</c> e custam a sombra, os cantos e o material — o
    /// motivo está escrito em <see cref="Dwm"/>.
    /// </remarks>
    private void Tingir()
    {
        if (_paleta is null)
        {
            return;
        }

        // Alto contraste não se dilui: lá os dois "tint" são cores opacas do
        // sistema, e deixar ver o desktop através delas desfaz exatamente o
        // contraste que a pessoa pediu.
        var porcento = Mode == ThemeMode.HighContrast ? Opacidade.Maximo : Opacity;

        var baseTint = Cor("bg.base.tint");
        var raisedTint = Cor("bg.raised.tint");

        Swap(ref _tinta, new ResourceDictionary
        {
            ["bg.base.tint.ajustada"] = Pincel(baseTint, baseTint.A, porcento),
            ["bg.raised.tint.ajustada"] = Pincel(raisedTint, raisedTint.A, porcento),

            // O hover da paleta é opaco. Sem um par ajustado, o primeiro passe
            // do mouse devolveria a pastilha ao opaco e comeria a opacidade.
            ["bg.hover.tint.ajustada"] = Pincel(Cor("bg.hover"), raisedTint.A, porcento),
        });
    }

    private Color Cor(string chave) => ((SolidColorBrush)_paleta![chave]).Color;

    private static SolidColorBrush Pincel(Color cor, byte referencia, int porcento)
    {
        var pincel = new SolidColorBrush(Color.FromArgb(Opacidade.Alfa(referencia, porcento), cor.R, cor.G, cor.B));
        pincel.Freeze();
        return pincel;
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
