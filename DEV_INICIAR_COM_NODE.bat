@echo off
setlocal
cd /d "%~dp0"
title PokeDeck 4 - Iniciar
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERRO: Node.js nao esta instalado.
  echo Baixe a versao LTS em https://nodejs.org/
  echo Instale e execute este arquivo novamente.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo Instalando dependencias na primeira execucao...
  call npm install
  if errorlevel 1 (
    echo Erro ao instalar as dependencias. Confira sua conexao.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
