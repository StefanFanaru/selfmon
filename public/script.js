$(document).ready(async function () {
  try {
    const response = await fetch("/api/agents");
    const responseJson = await response.json();

    // Populate agent status
    const agentStatusContainer = $("#agent-status-container");
    console.log(responseJson);

    const fragment = document.createDocumentFragment(); // For batch DOM updates

    for (const agent of responseJson) {
      const { name: hostName, data: agentData } = agent;
      const server = agentData?.server?.[0];
      const service = agentData?.service?.[0];

      if (!agentData) {
        fragment.appendChild(
          buildAgentDiv(hostName, "N/A", "N/A", "N/A", false)[0],
        );
        changeFavicon("red");
        continue;
      }

      const cpuTotal = calculateCpuTotal(service);
      const memoryPercent = service.system[0].memory[0].percent[0]; // Memory percent
      const uptime = formatUptime(server.uptime[0]);

      const agentDiv = buildAgentDiv(
        hostName,
        cpuTotal,
        memoryPercent,
        uptime,
        true,
      );
      fragment.appendChild(agentDiv[0]); // Append the first element of jQuery object

      // Add click event listener to the Details button
      agentDiv.find(".details-button").on("click", async function () {
        await handleDetailsButtonClick(agentDiv, hostName);
      });
    }

    agentStatusContainer.append(fragment); // Append all at once
  } catch (error) {
    console.error("Error fetching data:", error);
    alert("Failed to load agent data. Please try again later."); // User feedback
  }
});

function changeFavicon(color) {
  const favicon = document.getElementById("favicon");
  if (color === "red") {
    favicon.href = "favicon-red.ico"; // Path to your red favicon
  } else {
    favicon.href = "favicon-green.ico"; // Path to your green favicon
  }
}

function calculateCpuTotal(service) {
  const cpuData = service.system[0].cpu[0];
  const userCpu = parseFloat(cpuData.user[0]) || 0;
  const guestCpu = parseFloat(cpuData.guest?.[0]) || 0;
  const systemCpu = parseFloat(cpuData.system[0]) || 0;

  return (userCpu + guestCpu + systemCpu).toFixed(2);
}

async function handleDetailsButtonClick(agentDiv, hostName) {
  const chartsDiv = agentDiv.find(".charts");
  chartsDiv.toggle(); // Toggle visibility of charts

  if (chartsDiv.is(":visible")) {
    const encodedName = encodeURIComponent(hostName);
    const [dataLastHour, dataToday] = await Promise.all([
      fetch(`/api/agents/${encodedName}/last_hour`).then((res) => res.json()),
      fetch(`/api/agents/${encodedName}/today`).then((res) => res.json()),
    ]);

    await createUptimeChart(dataToday, hostName, chartsDiv);
    await createChart(
      dataLastHour,
      "Last Hour CPU Usage",
      hostName,
      chartsDiv,
      "cpu_usage",
      "98, 0, 234",
    );
    await createChart(
      dataLastHour,
      "Last Hour RAM Usage",
      hostName,
      chartsDiv,
      "memory_usage",
      "241, 39, 245",
    );
    await createDayChart(
      dataToday,
      "Last Day CPU Usage",
      hostName,
      chartsDiv,
      "cpu_usage",
      "98, 0, 234",
    );
    await createDayChart(
      dataToday,
      "Last Day RAM Usage",
      hostName,
      chartsDiv,
      "memory_usage",
      "241, 39, 245",
    );
  } else {
    chartsDiv.empty(); // Clear the charts if hidden
  }
}

function buildAgentDiv(
  localhostname,
  cpuTotal,
  memoryPercent,
  uptime,
  isOnline,
) {
  return $(`
    <div class="agent-status">
      <div class="agent-info">
        <span class="agent-name">
          <span class="status-circle" style="background-color: ${isOnline ? "green" : "red"}"></span>
          ${localhostname}
        </span>
        ${buildMetricHtmlString("CPU", cpuTotal, "%")}
        ${buildMetricHtmlString("RAM", memoryPercent, "%")}
        <span><span class="metric-name">UP</span>&nbsp${uptime}</span>
        <button class="details-button ${isOnline ? "" : "disabled"}">Details</button>
      </div>
      <div class="charts" style="display: none;"></div> <!-- Hidden by default -->
    </div>
  `);
}

function buildMetricHtmlString(name, value, unit) {
  const color = value > 90 ? "red" : value > 75 ? "orange" : "unset";
  return `
    <span>
      <span class="metric-name">${name}</span>&nbsp
      <span style="color: ${color}">${value}${unit}</span>
    </span>
  `;
}

async function createChart(data, title, name, chartDiv, metric, color) {
  const ctx = document.createElement("canvas");
  ctx.id = `${name}-chart`;
  ctx.style = "width: 100%; max-width: 900px; margin: 20px auto;";
  chartDiv.append(ctx);

  const labels = data.map((entry) => entry.time);
  const metricData = data.map((entry) => entry[metric]);

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${title} for ${name}`,
          data: metricData,
          borderColor: `rgba(${color}, 1)`,
          backgroundColor: `rgba(${color}, 0.2)`,
          borderWidth: 2,
          fill: "origin",
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: { minute: "HH:mm" },
          },
          title: { display: true, text: "Time" },
        },
        y: {
          title: { display: true, text: "Usage (%)" },
          beginAtZero: true,
          min: 0,
          max: 100,
        },
      },
    },
  });
}

async function createDayChart(data, title, name, chartDiv, metric, color) {
  const ctx = document.createElement("canvas");
  ctx.id = `${name}-chart`;
  ctx.style = "width: 100%; max-width: 900px; margin: 20px auto;";
  chartDiv.append(ctx);

  const labels = data.map((entry) => entry.time);
  const metricData = data.map((entry) => entry[metric]);

  const cpuUsageAveraged = [];
  const labelsAveraged = [];

  for (let i = 0; i < metricData.length; i += 10) {
    const average = metricData.slice(i, i + 10).reduce((a, b) => a + b, 0) / 10;
    cpuUsageAveraged.push(average);
    labelsAveraged.push(labels[i]);
  }

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labelsAveraged,
      datasets: [
        {
          label: `${title} for ${name}`,
          data: cpuUsageAveraged,
          borderColor: `rgba(${color}, 1)`,
          backgroundColor: `rgba(${color}, 0.2)`,
          borderWidth: 2,
          fill: "origin",
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: "time",
          time: {
            unit: "hour",
            displayFormats: { hour: "HH:mm" },
          },
          title: { display: true, text: "Time" },
        },
        y: {
          title: { display: true, text: "Usage (%)" },
          beginAtZero: true,
          min: 0,
          max: 100,
        },
      },
    },
  });
}

function formatUptime(uptime) {
  const days = Math.floor(uptime / (24 * 60 * 60));
  const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((uptime % (60 * 60)) / 60);
  const seconds = uptime % 60;

  return `${days > 0 ? `${days}d ` : ""}${hours > 0 ? `${hours}h ` : ""}${minutes > 0 ? `${minutes}m ` : ""}${seconds > 0 ? `${seconds}s` : ""}`.trim();
}

async function createUptimeChart(data, name, chartDiv) {
  const ctx = document.createElement("canvas");
  ctx.id = `${name}-chart`;
  ctx.style =
    "width: 100%; max-width: 900px; max-height: 200px; margin: 20px auto;";
  chartDiv.append(ctx);

  const labels = data.map((data) => data.time);
  const statusData = data.map((data) =>
    data.status === "online" ? 1 : 1.0000001,
  );
  const colors = statusData.map((status) => (status === 1 ? "green" : "red"));

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Uptime Status",
          data: statusData,
          backgroundColor: colors,
          borderWidth: 0,
          categoryPercentage: 7.0,
          barPercentage: 7.0,
        },
      ],
    },
    options: {
      scales: {
        x: {
          type: "time",
          time: {
            unit: "hour",
            displayFormats: { hour: "HH:mm" },
          },
          title: { display: true, text: "Time" },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: () => "",
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (tooltipItem) =>
              `${tooltipItem.dataset.label}: ${tooltipItem.raw === 1 ? "Online" : "Offline"}`,
          },
        },
      },
    },
  });
}
