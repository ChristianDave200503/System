param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$frontendDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\frontend"))
$script:countryCatalog = $null
$script:countryHivCache = @{}
$countryHivCacheMinutes = 360
$hivIndicators = @(
  @{
    id = "SH.HIV.TOTL"
    label = "Estimated people living with HIV"
    kind = "count"
  },
  @{
    id = "SH.HIV.INCD.TL"
    label = "Estimated new HIV infections"
    kind = "count"
  },
  @{
    id = "SH.DYN.AIDS.DH"
    label = "Estimated AIDS-related deaths"
    kind = "count"
  },
  @{
    id = "SH.DYN.AIDS.ZS"
    label = "HIV prevalence (ages 15-49)"
    kind = "percent"
  },
  @{
    id = "SH.HIV.ARTC.ZS"
    label = "Antiretroviral therapy coverage"
    kind = "percent"
  }
)
$statistics = @{
  year = 2025
  reportedIn = 2026
  items = @(
    @{
      value = "41.0m"
      description = "people were living with HIV worldwide at the end of 2025."
      sourceLabel = "UNAIDS"
      sourceUrl = "https://www.unaids.org/en/resources/fact-sheet"
    },
    @{
      value = "1.2m"
      description = "people acquired HIV globally during 2025."
      sourceLabel = "UNAIDS"
      sourceUrl = "https://www.unaids.org/en/resources/fact-sheet"
    },
    @{
      value = "570k"
      description = "people died from HIV-related causes in 2025."
      sourceLabel = "UNAIDS"
      sourceUrl = "https://www.unaids.org/en/resources/fact-sheet"
    },
    @{
      value = "32.1m"
      description = "people were accessing antiretroviral therapy in 2025."
      sourceLabel = "UNAIDS"
      sourceUrl = "https://www.unaids.org/en/resources/fact-sheet"
    }
  )
}
$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
}

function Get-WorldBankCountryCatalog {
  if ($null -eq $script:countryCatalog) {
    $uri = "https://api.worldbank.org/v2/country?format=json&per_page=400"
    $payload = Invoke-RestMethod -Uri $uri -TimeoutSec 20
    if ($payload.Count -lt 2 -or $null -eq $payload[1]) {
      throw "The World Bank country directory returned no countries."
    }

    $script:countryCatalog = @(
      $payload[1] |
        Where-Object {
          $_.region.id -ne "NA" -and $_.id -match "^[A-Z]{3}$" -and $_.iso2Code -match "^[A-Z]{2}$"
        } |
        ForEach-Object {
          [pscustomobject]@{
            code = $_.id
            iso2 = $_.iso2Code
            name = $_.name
            region = $_.region.value.Trim()
          }
        } |
        Sort-Object name
    )
  }

  return ,$script:countryCatalog
}

function Get-CountryHivEstimates {
  param(
    [pscustomobject]$Country
  )

  $cacheEntry = $script:countryHivCache[$Country.code]
  if ($null -ne $cacheEntry -and ((Get-Date) - $cacheEntry.fetchedAt).TotalMinutes -lt $countryHivCacheMinutes) {
    return $cacheEntry.data
  }

  $sourceLastUpdated = $null
  $metrics = @(
    foreach ($indicator in $hivIndicators) {
      $uri = "https://api.worldbank.org/v2/country/$($Country.code)/indicator/$($indicator.id)?format=json&per_page=5"
      $payload = Invoke-RestMethod -Uri $uri -TimeoutSec 20
      if ($null -eq $sourceLastUpdated -and $payload.Count -gt 0) {
        $sourceLastUpdated = $payload[0].lastupdated
      }
      $observation = $null

      if ($payload.Count -ge 2 -and $null -ne $payload[1]) {
        $observation = @($payload[1]) | Where-Object { $null -ne $_.value } | Select-Object -First 1
      }

      [pscustomobject]@{
        id = $indicator.id
        label = $indicator.label
        kind = $indicator.kind
        value = if ($null -ne $observation) { $observation.value } else { $null }
        year = if ($null -ne $observation) { [int]$observation.date } else { $null }
        sourceUrl = "https://data.worldbank.org/indicator/$($indicator.id)?locations=$($Country.iso2)"
      }
    }
  )

  $data = @{
    country = $Country
    metrics = $metrics
    source = "World Bank World Development Indicators, sourced from UNAIDS estimates"
    sourceLastUpdated = $sourceLastUpdated
  }
  $script:countryHivCache[$Country.code] = @{
    fetchedAt = Get-Date
    data = $data
  }

  return $data
}

function Send-JsonResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [object]$Data,
    [bool]$HeadRequest = $false
  )

  $body = [System.Text.Encoding]::UTF8.GetBytes(($Data | ConvertTo-Json -Compress -Depth 5))
  $Response.StatusCode = $StatusCode
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.Headers["Cache-Control"] = "no-store"
  $Response.Headers["X-Content-Type-Options"] = "nosniff"
  $Response.ContentLength64 = $body.Length
  if (-not $HeadRequest) {
    $Response.OutputStream.Write($body, 0, $body.Length)
  }
  $Response.Close()
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
  Write-Host "Beyond the Ribbon is running at http://localhost:$Port"
  Write-Host "Press Ctrl+C to stop the server."

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    if ($request.HttpMethod -notin @("GET", "HEAD")) {
      $response.Headers["Allow"] = "GET, HEAD"
      Send-JsonResponse -Response $response -StatusCode 405 -Data @{ error = "Method not allowed" }
      continue
    }

    $requestPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ($requestPath -eq "/api/health") {
      Send-JsonResponse -Response $response -StatusCode 200 -Data @{ status = "ok" } -HeadRequest ($request.HttpMethod -eq "HEAD")
      continue
    }
    if ($requestPath -eq "/api/stats") {
      Send-JsonResponse -Response $response -StatusCode 200 -Data $statistics -HeadRequest ($request.HttpMethod -eq "HEAD")
      continue
    }
    if ($requestPath -eq "/api/countries") {
      $countryQuery = $request.QueryString["q"]
      if ([string]::IsNullOrWhiteSpace($countryQuery) -or $countryQuery.Trim().Length -lt 2) {
        Send-JsonResponse -Response $response -StatusCode 400 -Data @{ error = "Enter at least two letters to search for a country." } -HeadRequest ($request.HttpMethod -eq "HEAD")
        continue
      }
      if ($countryQuery.Trim().Length -gt 80) {
        Send-JsonResponse -Response $response -StatusCode 400 -Data @{ error = "Country search must be 80 characters or fewer." } -HeadRequest ($request.HttpMethod -eq "HEAD")
        continue
      }

      try {
        $catalog = Get-WorldBankCountryCatalog
        $matchingCountries = @(
          $catalog |
            Where-Object { $_.name.IndexOf($countryQuery.Trim(), [System.StringComparison]::CurrentCultureIgnoreCase) -ge 0 } |
            Sort-Object @{
              Expression = {
                if ($_.name.Equals($countryQuery.Trim(), [System.StringComparison]::CurrentCultureIgnoreCase)) {
                  0
                } elseif ($_.name.StartsWith($countryQuery.Trim(), [System.StringComparison]::CurrentCultureIgnoreCase)) {
                  1
                } else {
                  2
                }
              }
            }, name |
            Select-Object -First 10
        )
        Send-JsonResponse -Response $response -StatusCode 200 -Data @{ countries = $matchingCountries } -HeadRequest ($request.HttpMethod -eq "HEAD")
      } catch {
        Write-Warning "Unable to load country directory from the World Bank API: $_"
        Send-JsonResponse -Response $response -StatusCode 502 -Data @{ error = "Country search is temporarily unavailable. Please try again." } -HeadRequest ($request.HttpMethod -eq "HEAD")
      }
      continue
    }
    if ($requestPath -eq "/api/country-hiv") {
      $countryCode = $request.QueryString["code"]
      if ([string]::IsNullOrWhiteSpace($countryCode) -or $countryCode -notmatch "^[A-Za-z]{3}$") {
        Send-JsonResponse -Response $response -StatusCode 400 -Data @{ error = "Choose a country from the suggestions before searching." } -HeadRequest ($request.HttpMethod -eq "HEAD")
        continue
      }

      try {
        $catalog = Get-WorldBankCountryCatalog
        $country = $catalog | Where-Object { $_.code -eq $countryCode.ToUpperInvariant() } | Select-Object -First 1
        if ($null -eq $country) {
          Send-JsonResponse -Response $response -StatusCode 404 -Data @{ error = "That country is not available in the country directory." } -HeadRequest ($request.HttpMethod -eq "HEAD")
          continue
        }

        $countryData = Get-CountryHivEstimates -Country $country
        Send-JsonResponse -Response $response -StatusCode 200 -Data $countryData -HeadRequest ($request.HttpMethod -eq "HEAD")
      } catch {
        Write-Warning "Unable to load country HIV estimates: $_"
        Send-JsonResponse -Response $response -StatusCode 502 -Data @{ error = "Country HIV estimates are temporarily unavailable. Please try again later." } -HeadRequest ($request.HttpMethod -eq "HEAD")
      }
      continue
    }

    if ($requestPath -eq "/") {
      $requestPath = "/index.html"
    }

    $relativePath = $requestPath.TrimStart("/")
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $frontendDirectory $relativePath))
    if (-not $filePath.StartsWith($frontendDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      Send-JsonResponse -Response $response -StatusCode 403 -Data @{ error = "Forbidden" }
      continue
    }

    if (-not [System.IO.File]::Exists($filePath)) {
      Send-JsonResponse -Response $response -StatusCode 404 -Data @{ error = "Not found" }
      continue
    }

    try {
      $content = [System.IO.File]::ReadAllBytes($filePath)
      $extension = [System.IO.Path]::GetExtension($filePath)
      if ($contentTypes.ContainsKey($extension)) {
        $response.ContentType = $contentTypes[$extension]
      } else {
        $response.ContentType = "application/octet-stream"
      }
      $response.Headers["X-Content-Type-Options"] = "nosniff"
      $response.ContentLength64 = $content.Length
      $response.StatusCode = 200
      if ($request.HttpMethod -ne "HEAD") {
        $response.OutputStream.Write($content, 0, $content.Length)
      }
      $response.Close()
    } catch {
      Write-Error "Unable to serve $filePath`: $_"
      if ($response.OutputStream.CanWrite) {
        Send-JsonResponse -Response $response -StatusCode 500 -Data @{ error = "Unable to serve frontend file" }
      }
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
