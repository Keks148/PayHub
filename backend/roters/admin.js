const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "admin",
    message: "Admin API module is working"
  });
});

module.exports = router;
