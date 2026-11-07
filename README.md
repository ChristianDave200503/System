# Beyond the Ribbon

- `frontend/` contains the HTML, CSS, and browser JavaScript.
- `backend/server.ps1` serves the frontend and provides the HIV statistics API.

## Run locally

Run this command from the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\server.ps1
```

Open [http://localhost:3000](http://localhost:3000). To use a different port, pass it as an argument, for example `.\backend\server.ps1 -Port 8080`.

## API endpoints

- `GET /api/health` returns the backend health status.
- `GET /api/stats` returns the global HIV statistics displayed on the site.
- `GET /api/countries?q=phil` returns matching World Bank country suggestions.
- `GET /api/country-hiv?code=PHL` returns the latest available HIV estimates for a country. Estimates are cached in memory for six hours.

Country estimates are served from the World Bank World Development Indicators API, which sources these HIV measures from UNAIDS estimates. Each indicator is labeled with its own latest available year; country data availability varies. People living with HIV and new infections are estimates, not counts of confirmed diagnoses.
