const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "trader",
    message: "Trader API module is working"
  });
});

module.exports = router;
