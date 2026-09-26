; Keep a copy of the installer that installed this version, so the first
; update can be a delta. tauri-plugin-updater-delta looks for it at
; <install dir>\delta-seed\installer.exe and uses it only if its size and
; BLAKE3 equal the base a published patch declares. Every install, including
; the silent one the updater runs, replaces it with the installer that just
; ran, so it always describes the installed version.

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\delta-seed"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\delta-seed\installer.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$INSTDIR\delta-seed"
!macroend
