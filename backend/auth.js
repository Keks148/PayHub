const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin123";
const TRADER_TOKEN = process.env.TRADER_TOKEN || "trader123";

function getToken(req) {
  return (
    req.headers["x-payhub-token"] ||
    req.headers["authorization"]?.replace("Bearer ", "") ||
    req.query.token ||
    null
  );
}

function requireAdmin(req, res, next) {
  const token = getToken(req);

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      message: "Admin access denied"
    });
  }

  next();
}

function requireTrader(req, res, next) {
  const token = getToken(req);

  if (token !== TRADER_TOKEN && token !== ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      message: "Trader access denied"
    });
  }

  next();
}

module.exports = {
  requireAdmin,
  requireTrader
};
