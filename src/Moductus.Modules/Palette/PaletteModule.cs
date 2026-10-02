using System.Windows.Controls;
using Moductus.Core.Commands;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Palette;

/// <summary>
/// O hub. Busca de comandos: abrir módulos, transformar o clipboard,
/// executar um comando e ser avisado quando terminar. Não conhece ninguém —
/// lê o <c>CommandRegistry</c>, onde host e módulos registram o que oferecem.
/// </summary>
/// <remarks>
/// Além dos comandos estáticos, ela consulta provedores dinâmicos: conta
/// resolvida, app instalado e arquivo do perfil, que só existem em função do
/// que foi digitado.
/// </remarks>
public sealed class PaletteModule(ModuleContext context) : IModule
{
    private readonly PasteFlow _pasteFlow = new(context);
    private readonly RunNotify _runNotify = new(context);
    private readonly QrCommand _qr = new(context);
    private readonly Calculator _calculadora = new(context);
    private readonly AppLauncher _apps = new(context);
    private readonly FileFinder _arquivos = new(context);

    /// <summary>Constante porque o AppLauncher grava na mesma gaveta de configuração.</summary>
    public const string Id = "palette";

    string IModule.Id => Id;

    public string Name => "Palette";

    public string Description => "Busca de comandos e ações";

    public ModuleArchetype Archetype => ModuleArchetype.Palette;

    public char SuggestedLeaderKey => 'p';

    public bool HasSurface => true;

    public void Enable()
    {
        _pasteFlow.Register();
        _runNotify.Register();
        _qr.Register();
        _calculadora.Register();
        _apps.Register();
        _arquivos.Register();

        _apps.Atualizou = Refrescar;
        _arquivos.Atualizou = Refrescar;
    }

    public void Disable()
    {
        context.Commands.Unregister(PasteFlow.Owner);
        context.Commands.Unregister(RunNotify.Owner);
        context.Commands.Unregister(QrCommand.Owner);
        context.Commands.UnregisterProvider(Calculator.Owner);
        context.Commands.UnregisterProvider(AppLauncher.Owner);
        context.Commands.UnregisterProvider(FileFinder.Owner);
    }

    public void Invoke()
    {
        var palette = context.Archetypes.Palette;

        if (palette.IsVisible)
        {
            palette.Dismiss();
            return;
        }

        // Índice do Menu Iniciar: I/O, e por isso só aqui, nunca no Enable.
        _apps.Aquecer();

        palette.Placeholder = "Comando, app, arquivo ou conta…";
        palette.EmptyText = "Nada com esse nome. Tente um app, um arquivo, uma conta como 12*7, ou \"abrir\".";
        palette.SetProvider(Procurar);
        palette.Present();
    }

    public UserControl? BuildSettings() => null;

    private IEnumerable<PaletteItem> Procurar(string consulta)
    {
        // Sem texto, o que vem de aplicativo é a lista dos abertos por último,
        // não o resultado de uma busca, e o cabeçalho diz isso.
        var vazia = consulta.Trim().Length == 0;

        return context.Commands
            .Search(consulta)
            .Select(c =>
            {
                var (secao, tipo, icone) = Aparencia(c.Category, vazia);
                return new PaletteItem(c.Text, c.Detail, c.Hint, c.Execute) { Section = secao, Kind = tipo, Icon = icone };
            });
    }

    /// <summary>
    /// Cabeçalho da seção, nome do tipo no chip e glifo do quadrado, por
    /// categoria. Os glifos são do Segoe Fluent Icons e existem com o mesmo
    /// ponto de código no Segoe MDL2 Assets do Windows 10.
    /// </summary>
    private static (string Secao, string Tipo, string Icone) Aparencia(CommandCategory categoria, bool vazia) => categoria switch
    {
        CommandCategory.Calculadora => ("CALCULADORA", "Conta", ""),
        CommandCategory.Aplicativo => (vazia ? "RECENTES" : "APLICATIVOS", "Aplicativo", ""),
        CommandCategory.Arquivo => ("ARQUIVOS", "Arquivo", ""),
        CommandCategory.Pasta => ("ARQUIVOS", "Pasta", ""),
        _ => ("COMANDOS", "Comando", ""),
    };

    /// <summary>
    /// App e arquivo chegam depois do texto digitado. Reaplicar o provedor
    /// refaz a lista sem que a Palette precise de um evento próprio.
    /// </summary>
    private void Refrescar()
    {
        var palette = context.Archetypes.Palette;

        if (palette.IsVisible)
        {
            palette.SetProvider(Procurar);
        }
    }
}
