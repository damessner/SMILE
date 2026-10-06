@echo off
chcp 65001 >nul
title SMILE Cloud-Backup - Microsoft 365 Autorisierung

echo =======================================================================
echo          SMILE Cloud-Backup: Microsoft 365 / OneDrive Setup
echo =======================================================================
echo.
echo Dieser Assistent richtet das automatische Cloud-Backup fuer SMILE ein.
echo.
echo SCHRITT 1: Ihr Standard-Webbrowser oeffnet sich gleich automatisch.
echo           Melden Sie sich mit Ihrem Microsoft 365 / Schul-Konto an
echo           und bestaetigen Sie den Zugriff ("Zustimmen" / "Akzeptieren").
echo.
echo SCHRITT 2: Im Terminal waehlen Sie danach Ihr gewuenschtes Laufwerk:
echo           - Druecken Sie in der Regel einfach [1] fuer OneDrive
echo           - Druecken Sie danach bei der Bestaetigung [y] (Ja)
echo.
echo =======================================================================
echo.
pause

set RCLONE_EXE=%~dp0tools\rclone.exe
if not exist "%RCLONE_EXE%" (
    set RCLONE_EXE=C:\Users\dames\.gemini\antigravity\brain\c690f771-163d-4e33-976c-23cfb6400f44\scratch\rclone_win\rclone-v1.75.1-windows-amd64\rclone.exe
)

echo.
echo Starte Verbindung... Bitte im Browser anmelden:
echo.

"%RCLONE_EXE%" config create m365 onedrive

echo.
if exist "%APPDATA%\rclone\rclone.conf" (
    copy /Y "%APPDATA%\rclone\rclone.conf" "%~dp0m365_rclone.conf" >nul
    echo =======================================================================
    echo [ERFOLG] Die Verbindung mit Microsoft 365 wurde erfolgreich autorisiert!
    echo Die Konfiguration wurde in m365_rclone.conf gesichert.
    echo.
    echo Sie koennen dieses Fenster schliessen.
    echo =======================================================================
) else (
    echo [HINWEIS] Einrichtung wurde abgebrochen oder noch nicht fertiggestellt.
)
echo.
pause
