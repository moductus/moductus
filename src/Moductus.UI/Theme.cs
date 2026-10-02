using System.Windows;
using System.Windows.Media;
using Moductus.Core.Interop;
using Moductus.Core.Theme;

// O WPF do .NET 9+ trouxe System.Windows.ThemeMode (tema Fluent). O nosso é o do Core.
using ThemeMode = Moductus.Core.Theme.ThemeMode;

namespace Moductus.UI;

/// <summary>
/// Aplica os tokens e mantém a paleta e o movimento sincronizados com o
/// sistema e com a escolha da pessoa: tema, claro ou escuro, alto contraste e
/// animações reduzidas.
/// </summary>
/// <remarks>
/// <para>
/// A estrutura (espaço, raio, tamanho) é carregada uma vez. Só três
/// dicionários são trocados em tempo de execução — o tema, o movimento e os
/// pincéis ajustáveis — e todo consumidor usa <c>DynamicResource</c>, então a
/// troca propaga sem reconstruir janela nenhuma.
/// </para>
/// <para>
/// É essa propagação que faz a opacidade das superfícies e a troca de tema
/// valerem na hora: não existe observador de configuração neste app, e
/// empurrar o valor para cada janela viva alcançaria as de agora e esqueceria
/// as de depois.
/// </para>
/// <para>
/// O estado tem três eixos independentes: o tema (<see cref="ThemeId"/>), a
/// preferência de modo (<see cref="ModePreference"/>) e a opacidade. O modo
/// em vigor (<see cref="Mode"/>) não é escolhido, é resolvido: alto contraste
/// ganha de tudo, e só depois vale a preferência.
/// </para>
/// </remarks>
public sealed class Theme : IDisposable
{
    private const string Pacote = "pack://application:,,,/Moductus.UI;component/";

    /// <summary>
    /// O sufixo das cores de um tema. Toda chave <c>X.color</c> ganha o
    /// pincel <c>X</c> no carregamento; ver <see cref="Carregar"/>.
    /// </summary>
    private const string SufixoCor = ".color";

    private static readonly Uri Tokens = new(Pacote + "Tokens/Tokens.xaml");
    private static readonly Uri Controles = new(Pacote + "Tokens/Controls.xaml");
    private static readonly Uri Movimento = new(Pacote + "Tokens/Motion.xaml");
    private static readonly Uri MovimentoReduzido = new(Pacote + "Tokens/Motion.Reduced.xaml");
    private static readonly Uri AltoContraste = new(Pacote + "Tokens/Palette.HighContrast.xaml");

    /// <summary>
    /// O <see cref="Mode"/> em vigor, publicado como recurso ao lado das cores.
    /// </summary>
    /// <remarks>
    /// Existe para janela que não recebe o <see cref="Theme"/> — os arquétipos
    /// nascem no <c>Moductus.UI</c>, sem host nenhum —, mas precisa contar ao
    /// DWM se é clara ou escura. Pelo recurso ela segue o modo como segue as
    /// cores: as janelas de agora e as que ainda vão nascer, sem ninguém
    /// empurrar o valor para cada uma.
    /// </remarks>
    public const string ModeKey = "theme.mode";

    private readonly ISystemThemeSource _source;
    private readonly MessageWindow _messages;
    private readonly ResourceDictionary _target;
    private readonly WindowMessageHandler _handler;

    private ThemeDefinition _tema;
    private ThemeDefinition? _temaCarregado;

    private ResourceDictionary? _paleta;
    private ResourceDictionary? _motion;
    private ResourceDictionary? _tinta;

    /// <param name="themeId">
    /// O tema da config. Desconhecido ou ausente cai no padrão, sem erro.
    /// </param>
    /// <param name="modePreference">A preferência de modo da config.</param>
    /// <remarks>
    /// Tema e modo entram pelo construtor, e não por <see cref="ApplyTheme"/>
    /// logo depois, para que o startup carregue um dicionário de cor só —
    /// carregar o padrão e trocá-lo em seguida seria pagar XAML duas vezes
    /// num caminho que tem orçamento.
    /// </remarks>
    public Theme(
        ISystemThemeSource source,
        MessageWindow messages,
        ResourceDictionary target,
        string? themeId = null,
        ThemeModePreference modePreference = ThemeModePreference.System)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        _messages = messages ?? throw new ArgumentNullException(nameof(messages));
        _target = target ?? throw new ArgumentNullException(nameof(target));

        _tema = ThemeCatalog.Resolver(themeId);
        ModePreference = modePreference;

        // Ordem importa: Controls referencia chaves de Tokens via StaticResource.
        _target.MergedDictionaries.Add(new ResourceDictionary { Source = Tokens });
        _target.MergedDictionaries.Add(new ResourceDictionary { Source = Controles });

        Apply();

        _handler = OnMessage;
        _messages.AddHandler(_handler);
    }

    /// <summary>O id do tema escolhido, já resolvido pelo catálogo.</summary>
    /// <remarks>
    /// Em alto contraste continua dizendo o tema escolhido, embora as cores
    /// na tela sejam do sistema: a escolha da pessoa não se perde só porque o
    /// sistema a está sobrepondo agora.
    /// </remarks>
    public string ThemeId => _tema.Id;

    /// <summary>O que a pessoa escolheu: seguir o sistema, claro ou escuro.</summary>
    public ThemeModePreference ModePreference { get; private set; }

    /// <summary>O modo em vigor, depois de alto contraste e preferência.</summary>
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

    /// <summary>
    /// Disparado depois que o tema, a preferência de modo, a paleta ou o
    /// movimento mudam. A opacidade não dispara: ela troca só os pincéis
    /// ajustáveis, e quem os usa já os recebe pelo <c>DynamicResource</c>.
    /// </summary>
    public event Action? Changed;

    /// <summary>Relê o sistema e troca o que mudou.</summary>
    public void Apply() => Aplicar(escolhaMudou: false);

    /// <summary>
    /// Troca o tema. Id desconhecido vira o padrão, como na config. Vale na
    /// hora para as janelas abertas e para as que ainda vão nascer.
    /// </summary>
    public void ApplyTheme(string? id)
    {
        var tema = ThemeCatalog.Resolver(id);

        if (tema == _tema)
        {
            return;
        }

        _tema = tema;
        Aplicar(escolhaMudou: true);
    }

    /// <summary>
    /// Troca a preferência de modo. Mesmo quando o modo em vigor não muda —
    /// "Escuro" escolhido com o sistema já escuro — <see cref="Changed"/>
    /// dispara, porque a escolha mudou e quem a mostra precisa saber.
    /// </summary>
    public void ApplyModePreference(ThemeModePreference preference)
    {
        if (preference == ModePreference)
        {
            return;
        }

        ModePreference = preference;
        Aplicar(escolhaMudou: true);
    }

    private void Aplicar(bool escolhaMudou)
    {
        var mode = ThemeResolver.Resolve(_source, ModePreference);
        var reduced = !_source.ClientAreaAnimation;

        var mudou = escolhaMudou;

        // Alto contraste é sempre reaplicado, porque as cores são snapshot do
        // sistema e podem ter mudado sem o modo mudar.
        if (_paleta is null || mode != Mode || _tema != _temaCarregado || mode == ThemeMode.HighContrast)
        {
            var paleta = Carregar(PaletaDe(_tema, mode));
            paleta[ModeKey] = mode;
            Swap(ref _paleta, paleta);
            Mode = mode;
            _temaCarregado = _tema;

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
    /// Carrega um dicionário de cor e completa o que ele não declara: o
    /// pincel de cada cor e os véus.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Os temas declaram só <c>Color</c>. Escrever à mão, em cada um dos onze
    /// arquivos, o mesmo bloco de <c>SolidColorBrush</c> apontando para a cor
    /// de cima era a receita para um deles esquecer uma chave — e chave
    /// faltando não dá erro: o <c>DynamicResource</c> não resolve e o elemento
    /// some. Gerado aqui, todo tema tem todos os pincéis por construção.
    /// </para>
    /// <para>
    /// Os pincéis são congelados: ninguém os altera depois, e congelado o WPF
    /// não precisa vigiá-los por mudança.
    /// </para>
    /// </remarks>
    private ResourceDictionary Carregar(Uri origem)
    {
        var paleta = new ResourceDictionary { Source = origem };

        var cores = paleta.Keys
            .OfType<string>()
            .Where(chave => chave.EndsWith(SufixoCor, StringComparison.Ordinal))
            .ToList();

        foreach (var chave in cores)
        {
            if (paleta[chave] is Color cor)
            {
                paleta[chave[..^SufixoCor.Length]] = Pincel(cor);
            }
        }

        // Véus: a cor cheia, rala, para o miolo de seleção e o fundo de chip.
        // Derivados, e não declarados, para que nenhum tema consiga ter um véu
        // de uma cor e o accent de outra — era assim que o Freeze ficava com a
        // borda seguindo o tema e o preenchimento preso ao âmbar.
        var accent = Token("veil.accent.opacity");
        var semantico = Token("veil.semantic.opacity");

        paleta["accent.veil"] = Veu(CorDe(paleta, "accent"), accent);
        paleta["success.veil"] = Veu(CorDe(paleta, "success"), semantico);
        paleta["danger.veil"] = Veu(CorDe(paleta, "danger"), semantico);

        return paleta;
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

        var baseTint = CorDe(_paleta, "bg.base.tint");
        var raisedTint = CorDe(_paleta, "bg.raised.tint");
        var raised = CorDe(_paleta, "bg.raised");

        Swap(ref _tinta, new ResourceDictionary
        {
            ["bg.base.tint.ajustada"] = Pincel(baseTint, baseTint.A, porcento),
            ["bg.raised.tint.ajustada"] = Pincel(raisedTint, raisedTint.A, porcento),

            // Este parte do pincel opaco, não do "tint": quem o usa — a barra
            // de título do Panel — usa hoje o opaco, e escalar a partir do
            // "tint" mudaria a aparência de quem deixou a opção no máximo.
            ["bg.raised.ajustada"] = Pincel(raised, raised.A, porcento),

            // O hover da paleta é opaco, e a pastilha em repouso não é: hoje
            // ela pisca fechada ao primeiro passe do mouse. O par ajustado
            // acerta isso e impede que o hover coma a opacidade escolhida.
            ["bg.hover.tint.ajustada"] = Pincel(CorDe(_paleta, "bg.hover"), raisedTint.A, porcento),
        });
    }

    private static Color CorDe(ResourceDictionary paleta, string token) => (Color)paleta[token + SufixoCor];

    /// <summary>Um número de <c>Tokens.xaml</c>, já mesclado no destino.</summary>
    private double Token(string chave) => (double)_target[chave];

    private static SolidColorBrush Pincel(Color cor)
    {
        var pincel = new SolidColorBrush(cor);
        pincel.Freeze();
        return pincel;
    }

    private static SolidColorBrush Pincel(Color cor, byte referencia, int porcento) =>
        Pincel(Color.FromArgb(Opacidade.Alfa(referencia, porcento), cor.R, cor.G, cor.B));

    /// <summary>
    /// A opacidade vai no pincel, e não no alfa da cor, para que o véu de um
    /// accent que já venha translúcido continue proporcional a ele.
    /// </summary>
    private static SolidColorBrush Veu(Color cor, double opacidade)
    {
        var pincel = new SolidColorBrush(cor) { Opacity = opacidade };
        pincel.Freeze();
        return pincel;
    }

    /// <summary>
    /// O arquivo de cor do momento. Alto contraste não é tema: ignora a
    /// escolha e usa as cores do sistema.
    /// </summary>
    private static Uri PaletaDe(ThemeDefinition tema, ThemeMode mode) => mode switch
    {
        ThemeMode.HighContrast => AltoContraste,
        ThemeMode.Light => new(Pacote + $"Themes/{tema.Arquivo}.Light.xaml"),
        _ => new(Pacote + $"Themes/{tema.Arquivo}.Dark.xaml"),
    };

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
