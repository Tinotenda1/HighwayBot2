import mysql from "mysql2/promise";

const retryInterval = 5000; // 5 seconds
const maxRetries = 10; // keep this low to fail fast
let retryCount = 0;

// ✅ Create connection pool with SSL & Keep-Alive settings
const pool = mysql.createPool({
  host: "bnstpnqezswwwytggskv-mysql.services.clever-cloud.com",
  port: 21031,
  user: "uhhmgzguldqdjkvs",
  password: "GnRAd49pl1yesiKMAGA",
  database: "bnstpnqezswwwytggskv",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  connectTimeout: 10000, // 10s timeout.

  // ⚡ CRITICAL FIX FOR ETIMEDOUT:
  enableKeepAlive: true,        // Prevents cloud firewalls/proxies from silently killing idle sockets
  keepAliveInitialDelay: 10000, // Starts sending TCP keep-alive probes after 10 seconds of idleness
  idleTimeout: 60000,           // Automatically closes idle pooled connections after 60 seconds

  ssl: {
    rejectUnauthorized: false, // ⚠️ required for Clever Cloud
  },
});

// ✅ Retry connection test
async function connectWithRetry() {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Database connected. Thread ID:", conn.threadId);

    conn.release();
    retryCount = 0;
  } catch (err) {
    console.error("❌ DB connection error:", err.message);

    retryCount++;

    if (retryCount < maxRetries) {
      console.log(
        `🔁 Retrying in ${retryInterval / 1000}s... (${retryCount}/${maxRetries})`
      );
      setTimeout(connectWithRetry, retryInterval);
    } else {
      console.error("💥 Max retries reached. Exiting...");
      process.exit(1);
    }
  }
}

// Start connection check
connectWithRetry();

export default pool;
