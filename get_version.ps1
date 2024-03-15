Get-Content manifest.json | Select-String -Pattern '\"version\": \"([^\"]+)\"' | Select-Object -First 1 | ForEach-Object { $_.Matches.Groups[1].Value }