param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDirectory = Join-Path $scriptDirectory "obsidian-connect"
$installerScriptPath = Join-Path $scriptDirectory "install-obsidian-connect.ps1"
$distDirectory = Join-Path $scriptDirectory "dist"
$outputFile = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Join-Path $distDirectory "obsidianConnect-installer.exe"
} else {
    [System.IO.Path]::GetFullPath($OutputPath)
}

$requiredFiles = @(
    @{ Path = $installerScriptPath; RelativePath = "install-obsidian-connect.ps1" },
    @{ Path = (Join-Path $pluginDirectory "manifest.json"); RelativePath = "obsidian-connect\manifest.json" },
    @{ Path = (Join-Path $pluginDirectory "main.js"); RelativePath = "obsidian-connect\main.js" },
    @{ Path = (Join-Path $pluginDirectory "versions.json"); RelativePath = "obsidian-connect\versions.json" },
    @{ Path = (Join-Path $pluginDirectory "README.md"); RelativePath = "obsidian-connect\README.md" }
)

foreach ($item in $requiredFiles) {
    if (-not (Test-Path $item.Path)) {
        throw "Falta el archivo requerido para construir el .exe: $($item.Path)"
    }
}

New-Item -ItemType Directory -Path $distDirectory -Force | Out-Null

$payloadLines = foreach ($item in $requiredFiles) {
    $content = [System.IO.File]::ReadAllBytes($item.Path)
    $base64 = [Convert]::ToBase64String($content)
    '            {{ "{0}", "{1}" }},' -f $item.RelativePath.Replace("\", "\\"), $base64
}

$source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

public static class ObsidianConnectInstallerWrapper
{
    private static readonly Dictionary<string, string> Payloads = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
__PAYLOAD_LINES__
    };

    [STAThread]
    public static void Main(string[] args)
    {
        string stagingRoot = Path.Combine(Path.GetTempPath(), "obsidian-connect-installer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stagingRoot);

        try
        {
            foreach (KeyValuePair<string, string> entry in Payloads)
            {
                string relativePath = entry.Key.Replace("\\\\", "\\");
                string targetPath = Path.Combine(stagingRoot, relativePath);
                string targetDirectory = Path.GetDirectoryName(targetPath);
                if (!string.IsNullOrEmpty(targetDirectory))
                {
                    Directory.CreateDirectory(targetDirectory);
                }
                File.WriteAllBytes(targetPath, Convert.FromBase64String(entry.Value));
            }

            string installerPath = Path.Combine(stagingRoot, "install-obsidian-connect.ps1");
            string arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File " + Quote(installerPath) + " " + JoinArgs(args);

            ProcessStartInfo startInfo = new ProcessStartInfo("powershell.exe", arguments);
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;

            using (Process process = Process.Start(startInfo))
            {
                process.WaitForExit();
                Environment.ExitCode = process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message,
                "obsidianConnect Installer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            Environment.ExitCode = 1;
        }
        finally
        {
            TryDeleteDirectory(stagingRoot);
        }
    }

    private static string JoinArgs(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return string.Empty;
        }

        StringBuilder builder = new StringBuilder();
        foreach (string arg in args)
        {
            if (builder.Length > 0)
            {
                builder.Append(" ");
            }
            builder.Append(Quote(arg));
        }
        return builder.ToString();
    }

    private static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch
        {
            // Ignore cleanup errors in the wrapper.
        }
    }
}
"@

$source = $source.Replace("__PAYLOAD_LINES__", ($payloadLines -join "`r`n"))

if (Test-Path $outputFile) {
    Remove-Item $outputFile -Force
}

Add-Type `
    -TypeDefinition $source `
    -Language CSharp `
    -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") `
    -OutputAssembly $outputFile `
    -OutputType WindowsApplication

if (-not (Test-Path $outputFile)) {
    throw "No se pudo generar el instalador .exe en $outputFile"
}

Write-Host ""
Write-Host "Instalador .exe generado correctamente." -ForegroundColor Green
Write-Host "Archivo: $outputFile"
