$src = "C:\Users\Scrappykong20\Desktop\PROYECTO CAFETERIA APPS\cafe-pos\dist"
$dst = "C:\Program Files\Cafe POS\resources\app\dist"
Remove-Item -Path "$dst\*" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$src\*" -Destination "$dst" -Recurse -Force
Write-Host "Deploy OK - $(Get-Date)"
