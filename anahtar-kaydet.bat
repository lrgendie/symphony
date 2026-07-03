@echo off
rem Symphony — API anahtarini Windows kasasina kaydetme araci.
rem Kullanim: Bu dosyaya cift tikla, anahtari yapistir (sag tik = yapistir), Enter'a bas.
rem Anahtar hicbir dosyaya yazilmaz; Windows Credential Manager'a gider.
cd /d "%~dp0"
echo.
echo  === Symphony Anahtar Kaydi ===
echo.
set /p SYMPHONY_KEY="Anthropic API anahtarini yapistir ve Enter'a bas: "
echo.
call pnpm --filter @symphony/core key:set anthropic
set SYMPHONY_KEY=
echo.
pause
