using System.Windows.Controls;
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

    public string Id => "palette";

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

    private IEnumerable<PaletteItem> Procurar(string consulta) => context.Commands
        .Search(consulta)
        .Select(c => new PaletteItem(c.Text, c.Detail, c.Hint, c.Execute));

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
