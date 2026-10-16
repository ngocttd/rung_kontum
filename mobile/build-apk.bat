@echo off
rem Vi du: build-apk.bat https://webgis.kontum.gov.vn
if "%~1"=="" (echo Cach dung: build-apk.bat ^<dia-chi-may-chu^> & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" -ApiUrl %1 %2 %3
