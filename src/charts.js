import Chart from "chart.js/auto";

/**
 * Extract financial metrics from text using regex patterns
 */
export function extractFinancialMetrics(text) {
  const metrics = {
    revenue: [],
    profit: [],
    growth: [],
    percentages: [],
  };

  // Revenue patterns: $X.XB, $X.XM, X billion, X million
  const revenueMatches = text.match(/\$[\d.]+[BM]|[\d.]+\s*(?:billion|million)\s*(?:revenue|sales)/gi);
  if (revenueMatches) metrics.revenue = revenueMatches;

  // Profit patterns: net income, EBITDA, profit margin
  const profitMatches = text.match(/(?:net\s+)?income|EBITDA|profit\s+(?:margin)?|earnings/gi);
  if (profitMatches) metrics.profit = profitMatches;

  // Growth patterns: X% growth, Y/Y, QoQ
  const growthMatches = text.match(/[\d.]+%\s*(?:growth|increase|decline|drop)/gi);
  if (growthMatches) metrics.growth = growthMatches;

  // All percentages
  const percentMatches = text.match(/[\d.]+%/g);
  if (percentMatches) metrics.percentages = percentMatches.slice(0, 10);

  return metrics;
}

/**
 * Create a Bloomberg-style revenue chart
 */
export function createRevenueChart(canvasId, labels = [], data = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  // Default demo data if none provided
  if (data.length === 0) {
    labels = ["Q1", "Q2", "Q3", "Q4"];
    data = [45, 52, 48, 61];
  }

  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue ($M)",
          data,
          borderColor: "#1e5a96",
          backgroundColor: "rgba(30, 90, 150, 0.08)",
          borderWidth: 2.5,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: "#1e5a96",
          pointBorderColor: "white",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#4b5563",
            font: { size: 12, family: "Consolas, monospace" },
          },
        },
        tooltip: {
          backgroundColor: "#1e5a96",
          padding: 12,
          titleColor: "white",
          bodyColor: "white",
          borderColor: "#1e5a96",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: "#4b5563" },
          grid: { color: "rgba(203, 213, 225, 0.3)" },
        },
        y: {
          ticks: { color: "#4b5563" },
          grid: { color: "rgba(203, 213, 225, 0.3)" },
        },
      },
    },
  });
}

/**
 * Create a Bloomberg-style pie chart for metrics distribution
 */
export function createMetricsChart(canvasId, labels = [], data = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  if (data.length === 0) {
    labels = ["Operating Expenses", "COGS", "R&D", "Admin"];
    data = [35, 28, 22, 15];
  }

  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: [
            "#1e5a96",
            "#d97706",
            "#059669",
            "#7c3aed",
          ],
          borderColor: "white",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#4b5563",
            font: { size: 11, family: "Consolas, monospace" },
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: "#1e5a96",
          padding: 10,
          titleColor: "white",
          bodyColor: "white",
          callbacks: {
            label: (context) => {
              const label = context.label || "";
              const value = context.parsed || 0;
              return `${label}: ${value}%`;
            },
          },
        },
      },
    },
  });
}

/**
 * Create a Bloomberg-style bar chart for comparison
 */
export function createComparisonChart(canvasId, labels = [], data1 = [], data2 = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  if (data1.length === 0) {
    labels = ["2021", "2022", "2023", "2024"];
    data1 = [42, 48, 55, 62];
    data2 = [38, 45, 50, 58];
  }

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "This Year",
          data: data1,
          backgroundColor: "#1e5a96",
          borderRadius: 4,
        },
        {
          label: "Last Year",
          data: data2,
          backgroundColor: "#cbd5e1",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: {
            color: "#4b5563",
            font: { size: 12, family: "Consolas, monospace" },
          },
        },
        tooltip: {
          backgroundColor: "#1e5a96",
          padding: 12,
          titleColor: "white",
          bodyColor: "white",
        },
      },
      scales: {
        x: {
          ticks: { color: "#4b5563" },
          grid: { display: false },
        },
        y: {
          ticks: { color: "#4b5563" },
          grid: { color: "rgba(203, 213, 225, 0.3)" },
        },
      },
    },
  });
}
