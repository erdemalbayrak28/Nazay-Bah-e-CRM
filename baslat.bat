@echo off
echo Sunucu baslatiliyor... Lutfen bu siyah pencereyi KAPATMAYIN!
echo Uygulamaniz tarayicida aciliyor...

start http://127.0.0.1:8000

if exist "venv\Scripts\uvicorn.exe" (
    venv\Scripts\uvicorn main:app --host 0.0.0.0 --reload
) else (
    uvicorn main:app --host 0.0.0.0 --reload
)
pause
