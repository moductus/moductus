namespace Moductus.Core.Clipboard;

/// <summary>A seção de um item na lista do Clips.</summary>
public enum ClipPeriod
{
    Hoje,
    Ontem,
    Antes,
}

public static class ClipPeriods
{
    /// <summary>
    /// Em que dia do calendário, e não há quantas horas: o que se copiou às
    /// 23h59 é "ontem" à meia-noite e um, que é como a pessoa lembra.
    /// </summary>
    /// <remarks>
    /// O fuso é o de <paramref name="now"/>. Quem chama passa o relógio local;
    /// o teste passa um fuso fixo e não depende da máquina em que roda.
    /// </remarks>
    public static ClipPeriod Of(DateTimeOffset when, DateTimeOffset now)
    {
        var dia = when.ToOffset(now.Offset).Date;
        var hoje = now.Date;

        if (dia >= hoje)
        {
            return ClipPeriod.Hoje;
        }

        return dia == hoje.AddDays(-1) ? ClipPeriod.Ontem : ClipPeriod.Antes;
    }
}
