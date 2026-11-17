; Instalador do TelaDosGames (Inno Setup 6)
; Gerado por build-installer.ps1, que prepara a pasta "staging" antes de compilar.

#define AppName "TelaDosGames"
#define AppVersion "1.0.0"
#define AppExe "TelaDosGames.exe"

[Setup]
AppId={{6E4B2C1A-8F3D-4B7E-9A51-2D7C0E5F3A91}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppName}
DefaultDirName={localappdata}\Programs\TelaDosGames
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Instala só para o usuário atual: não pede permissão de administrador
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=TelaDosGames-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Abrir o {#AppName} agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Encerra o servidor e o túnel se ainda estiverem rodando
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#AppExe} /T /F"; Flags: runhidden; RunOnceId: "KillApp"
