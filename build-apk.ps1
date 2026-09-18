# Builds the Android app and puts the finished APK next to this file as PocketPDF.apk
# Usage (PowerShell, from this folder):   .\build-apk.ps1
$ErrorActionPreference = 'Continue'  # native tools print warnings on stderr; success is judged by exit code below
$root = $PSScriptRoot
$tools = Join-Path $env:USERPROFILE 'dev-tools'

$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory | Where-Object Name -like 'jdk-21*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$tools\node;$env:JAVA_HOME\bin;$env:PATH"

Set-Location $root
Write-Host '1/3  Copying the web app into the Android project...'
npx cap sync android
if ($LASTEXITCODE) { throw 'cap sync failed' }

Write-Host '2/3  Building the APK (the first run downloads a few things and takes a few minutes)...'
Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug --console=plain
if ($LASTEXITCODE) { throw 'Gradle build failed' }

Write-Host '3/3  Copying the APK...'
Copy-Item (Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk') (Join-Path $root 'PocketPDF.apk') -Force
Write-Host "Done: $(Join-Path $root 'PocketPDF.apk')"
Set-Location $root
