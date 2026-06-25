const express = require("express");
const path = require("path");

const healthRoutes = require("./routes/health");
const merchantRoutes = require("./routes/merchant");
const traderRoutes = require("./routes/trader");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Раздаём frontend-папку как сайт
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PayHub backend is running",
    project: "PayHub",
    version: "1.0.0",
    modules: ["health", "merchant", "trader", "admin"]
  });
});

// Прямая ссылка на админку
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/admin.html"));
});

app.use("/health", healthRoutes);
app.use("/api/merchant", merchantRoutes);
app.use("/api/trader", traderRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error_code: "NOT_FOUND",
    message: "Route not found"
  });
});

app.listen(PORT, () => {
  console.log(`PayHub server running on port ${PORT}`);
});
