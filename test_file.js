/**
 * Test File for Tool Evaluation
 */

const config = {
  api_endpoint: "https://api.example.com/v2",
  timeout: 3000,
  retries: 5,
  features: [
    "logging",
    "caching",
    "metrics",
    "telemetry"
  ]
};

function initializeSystem(options) {
  console.log("Initializing system with:", options);
  
  if (options.verbose) {
    console.log("Verbose mode enabled");
  }

  return {
    status: "active",
    timestamp: Date.now()
  };
}

async function fetchData(url) {
  try {
    console.log("Attempting fetch from:", url);
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch data:", error);
    return null;
  }
}

export { config, initializeSystem, fetchData };
