param(
    [string]$VaultPath = "",
    [switch]$Force,
    [ValidateSet("Prompt", "Enable", "Keep")]
    [string]$RestrictedModeAction = "Prompt",
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions

$script:PluginId = "obsidian-connect"
$script:RequiredFiles = @(
    "manifest.json",
    "main.js",
    "versions.json"
)
$script:JsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:JsonSerializer.MaxJsonLength = [int]::MaxValue

function New-Dictionary {
    return ,(New-Object "System.Collections.Generic.Dictionary[string,object]")
}

function New-StringList {
    return ,(New-Object System.Collections.ArrayList)
}

function Write-Status {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    if (-not $Silent) {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Show-Dialog {
    param(
        [string]$Message,
        [string]$Title = "obsidianConnect Installer",
        [System.Windows.Forms.MessageBoxButtons]$Buttons = [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
    )

    if ($Silent) {
        return [System.Windows.Forms.DialogResult]::OK
    }

    return [System.Windows.Forms.MessageBox]::Show($Message, $Title, $Buttons, $Icon)
}

function Select-VaultPath {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Selecciona la carpeta raiz de tu vault de Obsidian"
    $dialog.UseDescriptionForTitle = $true
    $dialog.ShowNewFolderButton = $true
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        return $dialog.SelectedPath
    }
    return ""
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
        return ,($script:JsonSerializer.DeserializeObject($raw))
    }
    catch {
        throw "No se pudo leer el JSON de $Path"
    }
}

function Write-JsonFile {
    param(
        [string]$Path,
        $Value
    )

    $json = $script:JsonSerializer.Serialize($Value)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $encoding)
}

function Ensure-StringList {
    param($Value)

    $list = New-StringList
    if ($null -eq $Value) {
        return ,$list
    }

    foreach ($item in $Value) {
        if ($null -ne $item) {
            [void]$list.Add([string]$item)
        }
    }
    return ,$list
}

function Add-UniqueString {
    param(
        [System.Collections.ArrayList]$List,
        [string]$Value
    )

    if (-not ($List -contains $Value)) {
        [void]$List.Add($Value)
        return $true
    }
    return $false
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

function Resolve-InstallContext {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SelectedPath
    )

    $trimmedPath = $SelectedPath.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedPath)) {
        throw "No se ha indicado una ruta valida."
    }

    $normalized = [System.IO.Path]::GetFullPath($trimmedPath)
    $leaf = Split-Path -Leaf $normalized
    $parentPath = Split-Path -Parent $normalized
    $parentLeaf = if ($parentPath) { Split-Path -Leaf $parentPath } else { "" }
    $grandParentPath = if ($parentPath) { Split-Path -Parent $parentPath } else { "" }
    $grandParentLeaf = if ($grandParentPath) { Split-Path -Leaf $grandParentPath } else { "" }

    if ($leaf -ieq $script:PluginId) {
        if ($parentLeaf -ne "plugins" -or $grandParentLeaf -ne ".obsidian") {
            throw "La carpeta del plugin debe estar dentro de <vault>/.obsidian/plugins/$script:PluginId"
        }
        $vaultRoot = Split-Path -Parent $grandParentPath
    }
    elseif ($leaf -ieq "plugins") {
        if ($parentLeaf -ne ".obsidian") {
            throw "La carpeta plugins seleccionada no pertenece a un vault de Obsidian."
        }
        $vaultRoot = Split-Path -Parent $parentPath
    }
    elseif ($leaf -ieq ".obsidian") {
        $vaultRoot = $parentPath
    }
    else {
        $vaultRoot = $normalized
    }

    if ([string]::IsNullOrWhiteSpace($vaultRoot)) {
        throw "No se pudo resolver la raiz del vault."
    }

    $obsidianDir = Join-Path $vaultRoot ".obsidian"
    if (-not (Test-Path $obsidianDir)) {
        throw "No se encontro la carpeta .obsidian. Selecciona la raiz de un vault existente."
    }

    $pluginsDir = Join-Path $obsidianDir "plugins"
    $installDirectory = Join-Path $pluginsDir $script:PluginId

    return [pscustomobject]@{
        VaultRoot = $vaultRoot
        ObsidianDir = $obsidianDir
        PluginsDir = $pluginsDir
        InstallDirectory = $installDirectory
    }
}

function Validate-PluginPackage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory
    )

    foreach ($fileName in $script:RequiredFiles) {
        $sourceFile = Join-Path $SourceDirectory $fileName
        if (-not (Test-Path $sourceFile)) {
            throw "Falta el archivo requerido del plugin: $sourceFile"
        }
    }

    $manifestPath = Join-Path $SourceDirectory "manifest.json"
    $manifest = Read-JsonFile -Path $manifestPath -DefaultValue (New-Dictionary)
    if (-not (Test-Dictionary $manifest)) {
        throw "El manifest del plugin no es valido."
    }

    $manifestId = if (Test-HasKey $manifest "id") { [string]$manifest["id"] } else { "" }
    if ($manifestId -ne $script:PluginId) {
        throw "El id del manifest debe ser '$script:PluginId' y actualmente es '$manifestId'."
    }

    return $manifest
}

function New-BackupDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ObsidianDir
    )

    $baseDirectory = Join-Path $ObsidianDir "obsidian-connect-backups"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDirectory = Join-Path $baseDirectory $timestamp
    $suffix = 0

    while (Test-Path $backupDirectory) {
        $suffix += 1
        $backupDirectory = Join-Path $baseDirectory ($timestamp + "-" + $suffix)
    }

    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    return $backupDirectory
}

function Backup-ConfigFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ObsidianDir,
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    $existingPaths = @($Paths | Where-Object { Test-Path $_ })
    if (-not $existingPaths.Count) {
        return $null
    }

    $backupDirectory = New-BackupDirectory -ObsidianDir $ObsidianDir
    foreach ($path in $existingPaths) {
        Copy-Item -Path $path -Destination (Join-Path $backupDirectory (Split-Path -Leaf $path)) -Force
    }
    return $backupDirectory
}

function Ensure-PluginFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,
        [Parameter(Mandatory = $true)]
        [string]$InstallDirectory
    )

    New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null

    $filesToCopy = @(
        "manifest.json",
        "main.js",
        "versions.json",
        "README.md"
    )

    foreach ($fileName in $filesToCopy) {
        $sourceFile = Join-Path $SourceDirectory $fileName
        if (Test-Path $sourceFile) {
            Copy-Item $sourceFile (Join-Path $InstallDirectory $fileName) -Force
        }
    }

    $dataFile = Join-Path $InstallDirectory "data.json"
    if ($Force -or -not (Test-Path $dataFile)) {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($dataFile, "{}", $encoding)
    }
}

function Get-RestrictedModeState {
    param($AppConfig)

    $sources = New-StringList
    $isRestricted = $false
    if (-not (Test-Dictionary $AppConfig)) {
        return [pscustomobject]@{
            IsRestricted = $false
            Sources = $sources
        }
    }

    $containers = @($AppConfig)
    if ((Test-HasKey $AppConfig "config") -and (Test-Dictionary $AppConfig["config"])) {
        $containers += $AppConfig["config"]
    }

    foreach ($container in $containers) {
        if ((Test-HasKey $container "safeMode") -and [bool]$container["safeMode"]) {
            $isRestricted = $true
            [void]$sources.Add("safeMode")
        }
        if ((Test-HasKey $container "restrictedMode") -and [bool]$container["restrictedMode"]) {
            $isRestricted = $true
            [void]$sources.Add("restrictedMode")
        }
        if ((Test-HasKey $container "communityPluginEnabled") -and (-not [bool]$container["communityPluginEnabled"])) {
            $isRestricted = $true
            [void]$sources.Add("communityPluginEnabled=false")
        }
    }

    return [pscustomobject]@{
        IsRestricted = $isRestricted
        Sources = $sources
    }
}

function Disable-RestrictedMode {
    param($AppConfig)

    if (-not (Test-Dictionary $AppConfig)) {
        $AppConfig = New-Dictionary
    }

    $AppConfig["safeMode"] = $false
    $AppConfig["restrictedMode"] = $false
    $AppConfig["communityPluginEnabled"] = $true

    if ((Test-HasKey $AppConfig "config") -and (Test-Dictionary $AppConfig["config"])) {
        $AppConfig["config"]["safeMode"] = $false
        $AppConfig["config"]["restrictedMode"] = $false
        $AppConfig["config"]["communityPluginEnabled"] = $true
    }

    return $AppConfig
}

function Update-AppPluginLists {
    param(
        [Parameter(Mandatory = $true)]
        $AppConfig,
        [Parameter(Mandatory = $true)]
        [string]$PluginId
    )

    if (-not (Test-Dictionary $AppConfig)) {
        return $AppConfig
    }

    if (Test-HasKey $AppConfig "enabledPlugins") {
        $rootList = Ensure-StringList $AppConfig["enabledPlugins"]
        [void](Add-UniqueString -List $rootList -Value $PluginId)
        $AppConfig["enabledPlugins"] = $rootList
    }

    if ((Test-HasKey $AppConfig "plugins") -and (Test-Dictionary $AppConfig["plugins"])) {
        $pluginConfig = $AppConfig["plugins"]
        $pluginList = Ensure-StringList $pluginConfig["enabledPlugins"]
        [void](Add-UniqueString -List $pluginList -Value $PluginId)
        $pluginConfig["enabledPlugins"] = $pluginList
    }

    return $AppConfig
}

function Confirm-DisableRestrictedMode {
    param([string]$VaultRoot)

    switch ($RestrictedModeAction) {
        "Enable" { return $true }
        "Keep" { return $false }
    }

    $result = Show-Dialog `
        -Message ("El vault seleccionado sigue con Restricted mode activo.`n`n" +
            "Para autoactivar el plugin, obsidianConnect necesita desactivar ese modo de seguridad en la configuracion del vault:`n" +
            $VaultRoot + "`n`n" +
            "¿Quieres desactivarlo y activar el plugin automaticamente?") `
        -Buttons ([System.Windows.Forms.MessageBoxButtons]::YesNo) `
        -Icon ([System.Windows.Forms.MessageBoxIcon]::Question)

    return $result -eq [System.Windows.Forms.DialogResult]::Yes
}

function Test-ObsidianRunning {
    return [bool](Get-Process | Where-Object { $_.ProcessName -like "Obsidian*" } | Select-Object -First 1)
}

function Ensure-CommunityPluginEnabled {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommunityPluginsPath,
        [Parameter(Mandatory = $true)]
        [string]$PluginId
    )

    $plugins = Ensure-StringList (Read-JsonFile -Path $CommunityPluginsPath -DefaultValue @())
    $changed = Add-UniqueString -List $plugins -Value $PluginId
    Write-JsonFile -Path $CommunityPluginsPath -Value $plugins
    return $changed
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDirectory = Join-Path $scriptDirectory "obsidian-connect"

if (-not (Test-Path $sourceDirectory)) {
    throw "No se encontro la carpeta del plugin en $sourceDirectory"
}

if ([string]::IsNullOrWhiteSpace($VaultPath)) {
    $VaultPath = Select-VaultPath
}

if ([string]::IsNullOrWhiteSpace($VaultPath)) {
    throw "No se selecciono ninguna ruta de vault."
}

try {
    $manifest = Validate-PluginPackage -SourceDirectory $sourceDirectory
    $context = Resolve-InstallContext -SelectedPath $VaultPath

    Write-Status "Vault detectado: $($context.VaultRoot)" Green
    Write-Status "Ruta final del plugin: $($context.InstallDirectory)" Green

    $communityPluginsPath = Join-Path $context.ObsidianDir "community-plugins.json"
    $appConfigPath = Join-Path $context.ObsidianDir "app.json"

    $backupDirectory = Backup-ConfigFiles -ObsidianDir $context.ObsidianDir -Paths @(
        $communityPluginsPath,
        $appConfigPath
    )

    Ensure-PluginFiles -SourceDirectory $sourceDirectory -InstallDirectory $context.InstallDirectory

    $pluginEnabledInList = Ensure-CommunityPluginEnabled -CommunityPluginsPath $communityPluginsPath -PluginId $script:PluginId

    $appConfigExisted = Test-Path $appConfigPath
    $appConfig = if ($appConfigExisted) {
        Read-JsonFile -Path $appConfigPath -DefaultValue (New-Dictionary)
    } else {
        New-Dictionary
    }

    $restrictedState = Get-RestrictedModeState -AppConfig $appConfig
    $restrictedDisabled = $false
    $autoActivated = $true

    if ($restrictedState.IsRestricted) {
        if (Confirm-DisableRestrictedMode -VaultRoot $context.VaultRoot) {
            $appConfig = Disable-RestrictedMode -AppConfig $appConfig
            $restrictedDisabled = $true
        } else {
            $autoActivated = $false
        }
    }

    $appConfig = Update-AppPluginLists -AppConfig $appConfig -PluginId $script:PluginId

    if ($appConfigExisted -or $restrictedDisabled) {
        Write-JsonFile -Path $appConfigPath -Value $appConfig
    }

    $obsidianRunning = Test-ObsidianRunning

    $summaryLines = @(
        "Plugin instalado en:",
        $context.InstallDirectory,
        "",
        "Vault:",
        $context.VaultRoot,
        ""
    )

    if ($autoActivated) {
        $summaryLines += "El plugin ha quedado marcado como habilitado para este vault."
    } else {
        $summaryLines += "El plugin se ha instalado, pero no quedara activo hasta desactivar Restricted mode."
    }

    if ($restrictedDisabled) {
        $summaryLines += "Restricted mode se ha desactivado con tu confirmacion."
    } elseif ($restrictedState.IsRestricted) {
        $summaryLines += "Restricted mode sigue activo en este vault."
    }

    if ($backupDirectory) {
        $summaryLines += ""
        $summaryLines += "Se ha creado backup de configuracion en:"
        $summaryLines += $backupDirectory
    }

    if ($obsidianRunning) {
        $summaryLines += ""
        $summaryLines += "Obsidian parece estar abierto. Recarga los plugins o reinicia la app para que el cambio se refleje."
    }

    Write-Status ""
    foreach ($line in $summaryLines) {
        if ($line -ne "") {
            Write-Status $line Green
        } else {
            Write-Status ""
        }
    }

    [void](Show-Dialog -Message ($summaryLines -join "`n"))
}
catch {
    Write-Status $_.Exception.Message Red
    [void](Show-Dialog -Message $_.Exception.Message -Icon ([System.Windows.Forms.MessageBoxIcon]::Error))
    throw
}
