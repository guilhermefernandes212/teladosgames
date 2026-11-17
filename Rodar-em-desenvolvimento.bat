@echo off
chcp 65001 > nul
title TelaDosGames - modo desenvolvimento
cd /d "%~dp0app"

if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm install || goto :erro
)

echo.
echo Servidor do TelaDosGames rodando a partir da pasta app\
echo Abra http://localhost:3000 no navegador. Feche esta janela para parar.
echo.
node server.js
goto :eof

:erro
echo.
echo Nao foi possivel instalar as dependencias. Confira se o Node.js esta instalado.
pause
