namespace Moductus.UI.Archetypes;

/// <summary>
/// O arquétipo que é disputado: uma janela só, vários módulos, e nenhum deles
/// dono permanente. Panel e Canvas herdam daqui.
/// </summary>
/// <remarks>
/// <para>
/// Sem dono declarado, a hotkey do Peek fecharia o Scratch — os dois ocupam o
/// mesmo Panel. Quem ocupa a superfície carimba o próprio <see cref="Owner"/>,
/// e as duas perguntas que todo módulo faz antes de agir viram
/// <see cref="IsShowingFor"/> e <see cref="DismissIfShowing"/>.
/// </para>
/// <para>
/// A diferença entre as duas é o que acontece com a fixação: alternar pela
/// hotkey respeita o Fixar, desligar o módulo não. Painel fixado de um módulo
/// desligado continuaria na tela aceitando clique.
/// </para>
/// </remarks>
public abstract class OwnedWindow(bool stealsFocus) : ArchetypeWindow(stealsFocus)
{
    /// <summary>
    /// O <c>Id</c> do módulo que está com a superfície. <c>Window.Owner</c> do
    /// WPF é outra coisa — janela dona — e não serve aqui.
    /// </summary>
    public new string? Owner { get; set; }

    /// <summary>Só o Panel tem Fixar; no Canvas isto é sempre falso.</summary>
    public virtual bool IsPinned => false;

    /// <summary>
    /// Está na tela e é deste módulo. É o que separa "atualizo o que estou
    /// mostrando" de "escrevo por cima do módulo vizinho".
    /// </summary>
    public bool IsShowingFor(string owner) => IsVisible && Owner == owner;

    /// <summary>
    /// O primeiro passo de todo <c>Invoke</c>: a hotkey é toggle, então repetir
    /// o atalho fecha — mas só o que é meu e só se não estiver fixado.
    /// </summary>
    /// <returns>
    /// <c>true</c> quando fechou, e aí o módulo retorna sem montar nada.
    /// </returns>
    public bool DismissIfShowing(string owner)
    {
        if (!IsShowingFor(owner) || IsPinned)
        {
            return false;
        }

        Dismiss();
        return true;
    }
}
