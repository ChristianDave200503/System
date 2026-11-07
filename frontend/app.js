const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
const statsGrid = document.querySelector("#stats-grid");
const statsStatus = document.querySelector("#stats-status");
const countryForm = document.querySelector("#country-search-form");
const countryInput = document.querySelector("#country-search-input");
const countryOptions = document.querySelector("#country-options");
const countryStatus = document.querySelector("#country-search-status");
const countryResults = document.querySelector("#country-results");
const countryMetrics = document.querySelector("#country-metrics");
const countriesByName = new Map();
let suggestionsController;
let suggestionTimer;

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
  navLinks.classList.toggle("open", !isOpen);
});

navLinks.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    navLinks.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation menu");
  }
});

document.querySelectorAll(".fact-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    document.getElementById(button.getAttribute("aria-controls")).hidden = expanded;
  });
});

function renderStatistics(items) {
  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "stat-card";

    const value = document.createElement("span");
    value.className = "stat-value";
    value.textContent = item.value;

    const description = document.createElement("p");
    description.textContent = item.description;

    const source = document.createElement("span");
    source.className = "stat-source";
    source.append(document.createTextNode(`${item.sourceLabel} · `));

    const link = document.createElement("a");
    link.href = item.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Global HIV statistics";
    source.append(link);

    card.append(value, description, source);
    fragment.append(card);
  });

  statsGrid.replaceChildren(fragment);
}

async function loadStatistics() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) {
      throw new Error(`Statistics request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Statistics response did not contain any items");
    }

    renderStatistics(data.items);
    statsStatus.textContent = `Global estimates for ${data.year}, reported by UNAIDS in ${data.reportedIn}. Figures are rounded.`;
  } catch (error) {
    statsStatus.textContent = "Statistics could not be loaded. Please try again later.";
    console.error("Unable to load HIV statistics:", error);
  }
}

loadStatistics();

function setCountryStatus(message, state = "") {
  countryStatus.textContent = message;
  countryStatus.dataset.state = state;
}

async function fetchCountries(query, signal) {
  const response = await fetch(`/api/countries?q=${encodeURIComponent(query)}`, { signal });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Country search failed with status ${response.status}`);
  }
  return data.countries;
}

async function loadCountrySuggestions(query, signal) {
  const countries = await fetchCountries(query, signal);
  countriesByName.clear();
  countryOptions.replaceChildren();

  const fragment = document.createDocumentFragment();
  countries.forEach((country) => {
    const option = document.createElement("option");
    option.value = country.name;
    fragment.append(option);
    countriesByName.set(country.name.toLocaleLowerCase(), country);
  });
  countryOptions.append(fragment);
  return countries;
}

countryInput.addEventListener("input", () => {
  window.clearTimeout(suggestionTimer);
  if (suggestionsController) {
    suggestionsController.abort();
  }

  const query = countryInput.value.trim();
  if (query.length < 2) {
    countryOptions.replaceChildren();
    countriesByName.clear();
    setCountryStatus("Type at least two letters to search.");
    return;
  }

  suggestionTimer = window.setTimeout(async () => {
    suggestionsController = new AbortController();
    setCountryStatus("Searching countries…");
    try {
      const countries = await loadCountrySuggestions(query, suggestionsController.signal);
      setCountryStatus(
        countries.length
          ? `${countries.length} matching ${countries.length === 1 ? "country" : "countries"} found. Choose one from the suggestions.`
          : "No matching countries found. Check the spelling and try again.",
        countries.length ? "" : "error"
      );
    } catch (error) {
      if (error.name !== "AbortError") {
        setCountryStatus(error.message, "error");
        console.error("Unable to search for countries:", error);
      }
    }
  }, 250);
});

function formatCountryMetric(metric) {
  if (metric.value === null || metric.value === undefined) {
    return "Not reported";
  }

  const value = Number(metric.value);
  if (!Number.isFinite(value)) {
    return "Not reported";
  }

  if (metric.kind === "percent") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
  }

  return `≈${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}`;
}

function renderCountryData(data) {
  document.querySelector("#country-result-name").textContent = data.country.name;
  document.querySelector("#country-result-region").textContent = data.country.region;
  const countrySource = document.querySelector("#country-result-source");
  countrySource.href = `https://data.worldbank.org/country/${encodeURIComponent(data.country.iso2.toLowerCase())}`;

  const fragment = document.createDocumentFragment();
  data.metrics.forEach((metric) => {
    const card = document.createElement("article");
    card.className = "country-metric";

    const value = document.createElement("span");
    value.className = "country-metric-value";
    value.textContent = formatCountryMetric(metric);

    const label = document.createElement("span");
    label.className = "country-metric-label";
    label.textContent = metric.label;

    const year = document.createElement("span");
    year.className = "country-metric-year";
    year.textContent = metric.year ? `Latest estimate: ${metric.year}` : "No recent estimate available";

    const source = document.createElement("a");
    source.className = "country-metric-source";
    source.href = metric.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = "View source";

    card.append(value, label, year, source);
    fragment.append(card);
  });

  countryMetrics.replaceChildren(fragment);
  document.querySelector("#country-result-note").textContent =
    `Counts are approximate modeled estimates, not a tally of confirmed diagnoses. Years may differ between measures. “Not reported” means the source has no recent estimate for that measure.${data.sourceLastUpdated ? ` World Bank source data last updated: ${data.sourceLastUpdated}.` : ""}`;
  countryResults.hidden = false;
}

countryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = countryInput.value.trim();
  if (query.length < 2) {
    setCountryStatus("Enter at least two letters to search for a country.", "error");
    countryInput.focus();
    return;
  }

  const submitButton = countryForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  countryResults.hidden = true;
  setCountryStatus("Finding the country and loading its HIV estimates…");

  try {
    let country = countriesByName.get(query.toLocaleLowerCase());
    if (!country) {
      const matches = await loadCountrySuggestions(query);
      country = matches.find((item) => item.name.toLocaleLowerCase() === query.toLocaleLowerCase());
    }

    if (!country) {
      throw new Error("Choose an exact country name from the suggestions, then search again.");
    }

    const response = await fetch(`/api/country-hiv?code=${encodeURIComponent(country.code)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Country estimates request failed with status ${response.status}`);
    }

    renderCountryData(data);
    setCountryStatus(`Showing the latest available HIV estimates for ${data.country.name}.`, "success");
  } catch (error) {
    countryResults.hidden = true;
    setCountryStatus(error.message, "error");
    console.error("Unable to load country HIV estimates:", error);
  } finally {
    submitButton.disabled = false;
  }
});
