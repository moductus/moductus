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
public sealed class PaletteModule(ModuleContext context) : IModule
{
    private readonly PasteFlow _pasteFlow = new(context);
    private readonly RunNotify _runNotify = new(context);

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
    }

    public void Disable()
    {
        context.Commands.Unregister(PasteFlow.Owner);
        context.Commands.Unregister(RunNotify.Owner);
    }

    public void Invoke()
    {
        var palette = context.Archetypes.Palette;

        if (palette.IsVisible)
        {
            palette.Dismiss();
            return;
        }

        palette.Placeholder = "Comando…";
        palette.EmptyText = "Nada com esse nome. Tente \"abrir\", \"json\", \"slug\" ou \"executar\".";
        palette.SetProvider(q => context.Commands
            .Search(q)
            .Select(c => new PaletteItem(c.Text, c.Detail, c.Hint, c.Execute)));
        palette.Present();
    }

    public UserControl? BuildSettings() => null;
}
