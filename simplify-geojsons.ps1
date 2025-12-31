# PowerShell script to simplify all GeoJSON files using mapshaper
# This reduces file sizes by ~90% while maintaining visual quality

$sourceDir = "geojsons"
$outputDir = "geojsons_simplified"

# Get all GeoJSON files
$files = Get-ChildItem -Path $sourceDir -Filter "*.json"

Write-Host "Found $($files.Count) GeoJSON files to simplify" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$totalOriginal = 0
$totalSimplified = 0

foreach ($file in $files) {
    $inputPath = $file.FullName
    $outputPath = Join-Path $outputDir $file.Name
    
    $originalSize = [math]::Round($file.Length / 1MB, 2)
    $totalOriginal += $file.Length
    
    Write-Host "`nProcessing: $($file.Name)" -ForegroundColor Yellow
    Write-Host "  Original size: $originalSize MB"
    
    # Simplify using Visvalingam algorithm with 2% of vertices retained
    # This provides excellent visual quality at web map zoom levels
    mapshaper $inputPath -simplify 2% keep-shapes -clean -o format=geojson $outputPath
    
    if (Test-Path $outputPath) {
        $newSize = [math]::Round((Get-Item $outputPath).Length / 1MB, 2)
        $totalSimplified += (Get-Item $outputPath).Length
        $reduction = [math]::Round((1 - ($newSize / $originalSize)) * 100, 1)
        Write-Host "  Simplified size: $newSize MB ($reduction% reduction)" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Failed to create simplified file" -ForegroundColor Red
    }
}

Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Total original size: $([math]::Round($totalOriginal / 1MB, 2)) MB"
Write-Host "Total simplified size: $([math]::Round($totalSimplified / 1MB, 2)) MB"
Write-Host "Overall reduction: $([math]::Round((1 - ($totalSimplified / $totalOriginal)) * 100, 1))%"
Write-Host "`nSimplified files saved to: $outputDir" -ForegroundColor Green
