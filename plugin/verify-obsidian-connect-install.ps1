param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web.Extensions

$pluginId = "obsidian-connect"
$jsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$jsonSerializer.MaxJsonLength = [int]::MaxValue

function New-Dictionary {
    return ,(New-Object "System.Collections.Generic.Dictionary[string,object]")
}

function Read-JsonFile {
    param(
        [string]$Path,
        $DefaultValue
    )

    if (-not (Test-Path $Path)) {
        return ,$DefaultValue
    }

    $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return ,$DefaultValue
    }

    try {
        return ,($jsonSerializer.DeserializeObject($raw))
    }
    catch {
        throw "No se pudo leer el JSON de $Path"
    }
}

function Test-Dictionary {
    param($Value)
    return $Value -is [System.Collections.IDictionary]
}

function Test-HasKey {
    param(
        $Dictionary,
        [string]$Key
    )

    return (Test-Dictionary $Dictionary) -and $Dictionary.ContainsKey($Key)
}

function Ensure-StringList {
    param($Value)
    $result = New-Object System.Collections.ArrayList
    if ($null -eq $Value) {
        return ,$result
    }
    foreach ($item in $Value) {
        if ($null -ne $item) {
            [void]$result.Add([string]$item)
        }
    }
    return ,$result
}

function Resolve-VaultRoot {
    param([string]$SelectedPath)

    $normalized = [System.IO.Path]::GetFullPath($SelectedPath.Trim())
    $leaf = Split-Path -Leaf $normalized
    $parent = Split-Path -Parent $normalized
    $parentLeaf = if ($parent) { Split-Path -Leaf $parent } else { "" }
    $grandParent = if ($parent) { Split-Path -Parent $parent } else { "" }
    $grandParentLeaf = if ($grandParent) { Split-Path -Leaf $grandParent } else { "" }

    if ($leaf -ieq $pluginId -and $parentLeaf -eq "plugins" -and $grandParentLeaf -eq ".obsidian") {
        return Split-Path -Parent $grandParent
    }
    if ($leaf -ieq "plugins" -and $parentLeaf -eq ".obsidian") {
        return Split-Path -Parent $parent
    }
    if ($leaf -ieq ".obsidian") {
        return $parent
    }
    return $normalized
}

function Get-RestrictedModeState {
    param($AppConfig)

    if (-not (Test-Dictionary $AppConfig)) {
        return "unknown"
    }

    $containers = @($AppConfig)
    if ((Test-HasKey $AppConfig "config") -and (Test-Dictionary $AppConfig["config"])) {
        $containers += $AppConfig["config"]
    }

    foreach ($container in $containers) {
        if ((Test-HasKey $container "safeMode") -and [bool]$container["safeMode"]) {
            return "active"
        }
        if ((Test-HasKey $container "restrictedMode") -and [bool]$container["restrictedMode"]) {
            return "active"
        }
        if ((Test-HasKey $container "communityPluginEnabled") -and (-not [bool]$container["communityPluginEnabled"])) {
            return "active"
        }
    }

    return "inactive"
}

$vaultRoot = Resolve-VaultRoot -SelectedPath $VaultPath
$obsidianDir = Join-Path $vaultRoot ".obsidian"
$pluginDir = Join-Path (Join-Path $obsidianDir "plugins") $pluginId
$manifestPath = Join-Path $pluginDir "manifest.json"
$communityPluginsPath = Join-Path $obsidianDir "community-plugins.json"
$appConfigPath = Join-Path $obsidianDir "app.json"

$issues = New-Object System.Collections.ArrayList

if (-not (Test-Path $obsidianDir)) {
    [void]$issues.Add("La ruta indicada no pertenece a un vault de Obsidian con carpeta .obsidian.")
}

foreach ($fileName in @("manifest.json", "main.js", "versions.json")) {
    if (-not (Test-Path (Join-Path $pluginDir $fileName))) {
        [void]$issues.Add("Falta el archivo del plugin: $fileName")
    }
}

$manifestId = ""
if (Test-Path $manifestPath) {
    $manifest = Read-JsonFile -Path $manifestPath -DefaultValue (New-Dictionary)
    if ((Test-Dictionary $manifest) -and (Test-HasKey $manifest "id")) {
        $manifestId = [string]$manifest["id"]
        if ($manifestId -ne $pluginId) {
            [void]$issues.Add("El id del manifest es '$manifestId' y deberia ser '$pluginId'.")
        }
    } else {
        [void]$issues.Add("manifest.json no tiene un id valido.")
    }
}

$communityPlugins = Ensure-StringList (Read-JsonFile -Path $communityPluginsPath -DefaultValue @())
$listedAsEnabled = $communityPlugins -contains $pluginId
if (-not $listedAsEnabled) {
    [void]$issues.Add("community-plugins.json no incluye '$pluginId'.")
}

$appConfig = Read-JsonFile -Path $appConfigPath -DefaultValue (New-Dictionary)
$restrictedMode = Get-RestrictedModeState -AppConfig $appConfig
if ($restrictedMode -eq "active") {
    [void]$issues.Add("Restricted mode sigue activo en este vault.")
}

$status = "installed-and-activated"
if (-not (Test-Path $pluginDir)) {
    $status = "missing"
} elseif ($issues.Count -gt 0) {
    if ($listedAsEnabled -and $restrictedMode -eq "active") {
        $status = "installed-but-blocked"
    } else {
        $status = "installed-but-invalid"
    }
}

Write-Host "Vault root: $vaultRoot"
Write-Host "Plugin dir: $pluginDir"
Write-Host "Manifest id: " $(if ($manifestId) { $manifestId } else { "n/a" })
Write-Host "Enabled in community-plugins.json: $listedAsEnabled"
Write-Host "Restricted mode: $restrictedMode"
Write-Host "Status: $status"

if ($issues.Count) {
    Write-Host ""
    Write-Host "Problemas detectados:"
    foreach ($issue in $issues) {
        Write-Host "- $issue"
    }
}

switch ($status) {
    "installed-and-activated" { exit 0 }
    "installed-but-blocked" { exit 1 }
    default { exit 2 }
}
