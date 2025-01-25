// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const axios = require("axios");
const xml2js = require("xml2js");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Serve the main HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Database setup
const db = new sqlite3.Database(
  process.env.DB_PATH || "./database.db",
  (err) => {
    if (err) {
      console.error("Error opening database " + err.message);
    } else {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name TEXT,
        status TEXT,
        cpu_usage REAL,
        memory_usage REAL,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      });
    }
  },
);

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Agent configuration
if (!process.env.AGENTS) {
  console.error("No agents configured");
  process.exit(1);
}
const agents = JSON.parse(process.env.AGENTS);

// Fetch agent data
async function fetchAgentData(agent) {
  const url = `http://stefanaru:monit344@${agent.ip}:${agent.port}/_status?format=xml`;
  try {
    const response = await axios.get(url, { timeout: 1000 });
    if (response.status !== 200) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const result = await xml2js.parseStringPromise(response.data);
    const cpuTotal = calculateCpuUsage(result);
    const memoryUsage = parseFloat(
      result.monit.service[0].system[0].memory[0].percent[0],
    );

    await saveAgentData(agent.name, "online", cpuTotal, memoryUsage);
    return result;
  } catch (error) {
    console.error(
      `Error fetching data from agent ${agent.ip}:${agent.port}`,
      error,
    );

    await saveAgentData(agent.name, "offline", 0, 0);

    const isAfterHours = new Date().getHours() > 1 || new Date().getHours() < 9;
    const isServiableOrTruenas =
      agent.name === "serviable" || agent.name === "truenas";
    if (isAfterHours && isServiableOrTruenas) {
      return null;
    }
    await handleAgentOffline(agent);
    return null;
  }
}

// Calculate CPU usage
function calculateCpuUsage(result) {
  const cpuData = result.monit.service[0].system[0].cpu[0];
  const userCpu = parseFloat(cpuData.user[0]) || 0;
  const guestCpu = parseFloat(cpuData.guest?.[0]) || 0;
  const systemCpu = parseFloat(cpuData.system[0]) || 0;
  return (userCpu + guestCpu + systemCpu).toFixed(2);
}

// Save agent data to the database
async function saveAgentData(name, status, cpuUsage, memoryUsage) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO agents (name, status, cpu_usage, memory_usage, time) VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))`,
      [name, status, cpuUsage, memoryUsage],
      function (err) {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          resolve(this.lastID);
        }
      },
    );
  });
}

// Handle agent offline
async function handleAgentOffline(agent) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM agents WHERE name = ? ORDER BY time DESC LIMIT 1`,
      [agent.name],
      (err, row) => {
        if (err) {
          console.error(err);
          reject(err);
        } else if (row && row.status === "offline") {
          console.log("Agent is already offline");
          resolve();
        } else {
          console.log("Agent is offline. Sending email alert");
          sendEmailAlert(agent, "offline");
          resolve();
        }
      },
    );
  });
}

// Get agent data
async function getAgentData() {
  const agentDataPromises = agents.map(fetchAgentData);
  const agentData = await Promise.all(agentDataPromises);
  return agentData.map((data, index) => {
    if (!data) {
      return { name: agents[index].name };
    }
    return { name: agents[index].name, data: data.monit };
  });
}

// API endpoint to get agent data
app.get("/api/agents", async (req, res) => {
  try {
    const agentData = await getAgentData();
    res.json(agentData);
  } catch (error) {
    console.error("Error fetching agent data:", error);
    res.status(500).send("Internal Server Error");
  }
});

// API endpoint for last hour data
app.get("/api/agents/:name/last_hour", (req, res) => {
  const name = req.params.name;
  db.all(
    `SELECT * FROM agents WHERE name = ? AND datetime(time) >= datetime('now', '-1 Hour') ORDER BY time`,
    [name],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).send("Error reading data from database");
      } else {
        res.json(rows);
      }
    },
  );
});

// API endpoint for today's data
app.get("/api/agents/:name/today", (req, res) => {
  const name = req.params.name;
  db.all(
    `SELECT * FROM agents WHERE name = ? AND datetime(time) >= datetime('now', '-24 Hour') ORDER BY time`,
    [name],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).send("Error reading data from database");
      } else {
        res.json(rows);
      }
    },
  );
});

// Email alert function
function sendEmailAlert(agent, type) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ALERT_EMAIL,
    subject: `selfmon alert: ${agent.name} is ${type}`,
    text: `The agent ${agent.name} is currently ${type}.`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.error("Error sending email:", error);
    }
    console.log("Email sent: " + info.response);
  });
}

function deleteOldRecords() {
  db.run(
    `DELETE FROM agents WHERE time < datetime('now', '-24 Hour')`,
    (err) => {
      if (err) {
        console.error("Error deleting old records", err);
      }
    },
  );
}

// Background task to fetch agent data every 60 seconds
setInterval(getAgentData, 60000);
setInterval(deleteOldRecords, 60 * 60 * 10000);

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
