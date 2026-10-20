@echo off
setlocal
cd /d "%~dp0"
title PokeDeck 4 - Gerar Executavel Windows
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js LTS em https://nodejs.org/
  pause
  exit /b 1
)
call npm install
if errorlevel 1 (
  echo Falha no npm install
  pause
  exit /b 1
)
call npm run dist:win
if errorlevel 1 (
  echo Falha na compilacao
  pause
  exit /b 1
)
echo.
echo Os instaladores e executaveis estao na pasta dist.
pause
