@echo off
cd /d C:\wamp64\www\trading-command-suite
npm --prefix nest run build:api > logs\build-981.log 2>&1
