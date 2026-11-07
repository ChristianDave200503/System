# Beyond the Ribbon

- `frontend/` contains the HTML, CSS, and browser JavaScript.
- `backend/server.js` serves the frontend and provides the HIV statistics API using Express.

## Run locally

Install dependencies and start the server from the project root:

```powershell
npm install
npm start
```

Set the `PORT` environment variable to use a port other than `3000`.


Open [http://localhost:3000]

## API endpoints

- `GET /api/health` returns the backend health status.
- `GET /api/stats` returns the global HIV statistics displayed on the site.
- `GET /api/countries?q=phil` returns matching World Bank country suggestions.
- `GET /api/country-hiv?code=PHL` returns the latest available HIV estimates for a country. Estimates are cached in memory for six hours.

Country estimates are served from the World Bank World Development Indicators API, which sources these HIV measures from UNAIDS estimates. Each indicator is labeled with its own latest available year; country data availability varies. People living with HIV and new infections are estimates, not counts of confirmed diagnoses.
