@echo off
title Cafe POS - El Constructor
cd /d "%~dp0"

echo Iniciando servidor de impresion...
start "Servidor Impresion" /min node print-server\server.cjs

echo Iniciando POS...
start "" "http://localhost:3000"
node serve-pos.cjs
pause
