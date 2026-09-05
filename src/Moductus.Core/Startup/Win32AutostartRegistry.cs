using Microsoft.Win32;

namespace Moductus.Core.Startup;

/// <summary>O registro de verdade, sob <c>HKEY_CURRENT_USER</c>.</summary>
public sealed class Win32AutostartRegistry : IAutostartRegistry
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private const string ValueName = "Moductus";

    public string? ReadRunCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) as string;
    }

    public void WriteRunCommand(string command)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(ValueName, command, RegistryValueKind.String);
    }

    public void DeleteRunCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    public byte[]? ReadStartupApproved()
    {
        using var key = Registry.CurrentUser.OpenSubKey(ApprovedKey);
        return key?.GetValue(ValueName) as byte[];
    }

    public void DeleteStartupApproved()
    {
        using var key = Registry.CurrentUser.OpenSubKey(ApprovedKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
