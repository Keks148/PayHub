const express = require("express");

const healthRoutes = require("./routes/health");
const merchantRoutes = require("./routes/merchant");
const traderRoutes = require("./routes/trader");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PayHub backend is running",
    project: "PayHub",
    version: "1.0.0"
  });
});

app.use("/health", healthRoutes);
app.use("/api/merchant", merchantRoutes);
app.use("/api/trader", traderRoutes);
app.use("/api/admin", adminRoutes);

app.listen(PORT, () => {
  console.log(`PayHub server running on port ${PORT}`);
});
