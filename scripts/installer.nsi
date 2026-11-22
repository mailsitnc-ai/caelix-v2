; CAELIX Windows installer (per-user, no administrator rights needed). Built by scripts/release.js with makensis.
Unicode true
!include "MUI2.nsh"
Name "CAELIX"
OutFile "@OUT@"
InstallDir "$LOCALAPPDATA\Programs\CAELIX"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "CAELIX @VERSION@"
!define MUI_ICON "@ICON@"
!define MUI_UNICON "@ICON@"
!define MUI_FINISHPAGE_RUN "$INSTDIR\CAELIX.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start CAELIX"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "@VERSION@.0"
VIAddVersionKey "ProductName" "CAELIX"
VIAddVersionKey "FileDescription" "CAELIX installer"
VIAddVersionKey "FileVersion" "@VERSION@"

Section "CAELIX"
  SetOutPath "$INSTDIR"
  File /r "@SRC@\*.*"
  WriteUninstaller "$INSTDIR\Uninstall CAELIX.exe"
  CreateDirectory "$SMPROGRAMS\CAELIX"
  CreateShortcut "$SMPROGRAMS\CAELIX\CAELIX.lnk" "$INSTDIR\CAELIX.exe"
  CreateShortcut "$DESKTOP\CAELIX.lnk" "$INSTDIR\CAELIX.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX" "DisplayName" "CAELIX"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX" "DisplayVersion" "@VERSION@"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX" "UninstallString" '"$INSTDIR\Uninstall CAELIX.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX" "DisplayIcon" "$INSTDIR\CAELIX.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX" "NoModify" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\CAELIX.lnk"
  RMDir /r "$SMPROGRAMS\CAELIX"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CAELIX"
SectionEnd
