const express = require("express");
const path = require("node:path");

const app = express();
const frontendDirectory = path.join(__dirname, "..", "frontend");
const countryHivCache = new Map();
const countryHivCacheMilliseconds = 6 * 60 * 60 * 1000;
let countryCatalog;

const hivIndicators = [
  { id: "SH.HIV.TOTL", label: "Estimated people living with HIV", kind: "count" },
  { id: "SH.HIV.INCD.TL", label: "Estimated new HIV infections", kind: "count" },
  { id: "SH.DYN.AIDS.DH", label: "Estimated AIDS-related deaths", kind: "count" },
  { id: "SH.DYN.AIDS.ZS", label: "HIV prevalence (ages 15-49)", kind: "percent" },
  { id: "SH.HIV.ARTC.ZS", label: "Antiretroviral therapy coverage", kind: "percent" },
];

const statistics = {
  year: 2025,
  reportedIn: 2026,
  items: [
    {
      value: "41.0m",
      description: "people were living with HIV worldwide at the end of 2025.",
      sourceLabel: "UNAIDS",
      sourceUrl: "https://www.unaids.org/en/resources/fact-sheet",
    },
    {
      value: "1.2m",
      description: "people acquired HIV globally during 2025.",
      sourceLabel: "UNAIDS",
      sourceUrl: "https://www.unaids.org/en/resources/fact-sheet",
    },
    {
      value: "570k",
      description: "people died from HIV-related causes in 2025.",
      sourceLabel: "UNAIDS",
      sourceUrl: "https://www.unaids.org/en/resources/fact-sheet",
    },
    {
      value: "32.1m",
      description: "people were accessing antiretroviral therapy in 2025.",
      sourceLabel: "UNAIDS",
      sourceUrl: "https://www.unaids.org/en/resources/fact-sheet",
    },
  ],
};

async function fetchWorldBankJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`World Bank request failed with status ${response.status}`);
  }
  return response.json();
}

async function getWorldBankCountryCatalog() {
  if (countryCatalog) {
    return countryCatalog;
  }

  const payload = await fetchWorldBankJson(
    "https://api.worldbank.org/v2/country?format=json&per_page=400",
  );
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    throw new Error("The World Bank country directory returned no countries.");
  }

  countryCatalog = payload[1]
    .filter(
      (country) =>
        country.region?.id !== "NA" &&
        /^[A-Z]{3}$/.test(country.id) &&
        /^[A-Z]{2}$/.test(country.iso2Code),
    )
    .map((country) => ({
      code: country.id,
      iso2: country.iso2Code,
      name: country.name,
      region: country.region.value.trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return countryCatalog;
}

async function getCountryHivEstimates(country) {
  const cached = countryHivCache.get(country.code);
  if (cached && Date.now() - cached.fetchedAt < countryHivCacheMilliseconds) {
    return cached.data;
  }

  let sourceLastUpdated = null;
  const metrics = await Promise.all(
    hivIndicators.map(async (indicator) => {
      const url = `https://api.worldbank.org/v2/country/${country.code}/indicator/${indicator.id}?format=json&per_page=5`;
      const payload = await fetchWorldBankJson(url);
      if (!Array.isArray(payload)) {
        throw new Error(`World Bank returned invalid data for ${indicator.id}.`);
      }
      if (sourceLastUpdated === null && payload[0]?.lastupdated) {
        sourceLastUpdated = payload[0].lastupdated;
      }

      const observations = Array.isArray(payload[1]) ? payload[1] : [];
      const observation = observations.find((item) => item?.value !== null && item?.value !== undefined);
      const year = observation ? Number.parseInt(observation.date, 10) : null;

      return {
        id: indicator.id,
        label: indicator.label,
        kind: indicator.kind,
        value: observation?.value ?? null,
        year: Number.isFinite(year) ? year : null,
        sourceUrl: `https://data.worldbank.org/indicator/${indicator.id}?locations=${country.iso2}`,
      };
    }),
  );

  const data = {
    country,
    metrics,
    source: "World Bank World Development Indicators, sourced from UNAIDS estimates",
    sourceLastUpdated,
  };
  countryHivCache.set(country.code, { fetchedAt: Date.now(), data });
  return data;
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.use((request, response, next) => {
  response.set("X-Content-Type-Options", "nosniff");
  if (request.path.startsWith("/api/")) {
    response.set("Cache-Control", "no-store");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.set("Allow", "GET, HEAD");
    return response.status(405).json({ error: "Method not allowed" });
  }
  next();
});

app.get("/api/health", (request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/stats", (request, response) => {
  response.json(statistics);
});

app.get(
  "/api/countries",
  asyncHandler(async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 2) {
      return response.status(400).json({
        error: "Enter at least two letters to search for a country.",
      });
    }
    if (query.length > 80) {
      return response.status(400).json({
        error: "Country search must be 80 characters or fewer.",
      });
    }

    try {
      const catalog = await getWorldBankCountryCatalog();
      const normalizedQuery = query.toLocaleLowerCase();
      const countries = catalog
        .filter((country) => country.name.toLocaleLowerCase().includes(normalizedQuery))
        .sort((left, right) => {
          const rank = (name) =>
            name.toLocaleLowerCase() === normalizedQuery
              ? 0
              : name.toLocaleLowerCase().startsWith(normalizedQuery)
                ? 1
                : 2;
          return rank(left.name) - rank(right.name) || left.name.localeCompare(right.name);
        })
        .slice(0, 10);
      return response.json({ countries });
    } catch (error) {
      console.warn("Unable to load country directory from the World Bank API:", error);
      return response.status(502).json({
        error: "Country search is temporarily unavailable. Please try again.",
      });
    }
  }),
);

app.get(
  "/api/country-hiv",
  asyncHandler(async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : "";
    if (!/^[A-Za-z]{3}$/.test(code)) {
      return response.status(400).json({
        error: "Choose a country from the suggestions before searching.",
      });
    }

    try {
      const catalog = await getWorldBankCountryCatalog();
      const country = catalog.find((item) => item.code === code.toUpperCase());
      if (!country) {
        return response.status(404).json({
          error: "That country is not available in the country directory.",
        });
      }

      return response.json(await getCountryHivEstimates(country));
    } catch (error) {
      console.warn("Unable to load country HIV estimates:", error);
      return response.status(502).json({
        error: "Country HIV estimates are temporarily unavailable. Please try again later.",
      });
    }
  }),
);

app.use(express.static(frontendDirectory, { index: "index.html" }));

app.use((request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error, request, response, next) => {
  console.error("Unhandled backend error:", error);
  if (response.headersSent) {
    return next(error);
  }
  return response.status(500).json({ error: "Internal server error" });
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

app.listen(port, () => {
  console.log(`Beyond the Ribbon is running at http://localhost:${port}`);
  console.log("Press Ctrl+C to stop the server.");
});
