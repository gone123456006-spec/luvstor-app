@echo off
echo Clearing space so npm can run...
rd /s /q "%LOCALAPPDATA%\npm-cache" 2>nul
rd /s /q "%TEMP%\npm-*" 2>nul
del /q /f "%TEMP%\*" 2>nul
for /d %%D in ("%TEMP%\*") do rd /s /q "%%D" 2>nul
rd /s /q "%LOCALAPPDATA%\Temp" 2>nul
echo Done. Check free space, then run: npm run dev
pause
