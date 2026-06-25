const express = require("express");
const orders = require("../data/orders");
const cards = require("../data/cards");
const traders = require("../data/traders");

const router = express.Router();

function findOrder(id) {
  return orders.find(
    (order) => order.payment_id === id || order.merchant_order_id === id
  );
}

function releaseCard(cardId) {
  const card = cards.find((item) => item.id === cardId);

  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  return card;
}

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "trader",
    version: "v1",
    message: "Trader API module is working",
    endpoints: [
      "GET /api/trader/orders",
      "GET /api/trader/orders/:id",
      "POST /api/trader/orders/:id/confirm",
      "POST /api/trader/orders/:id/reject"
    ]
  });
});

router.get("/orders", (req, res) => {
  const { trader_id = "trader_1", status } = req.query;

  let result = orders.filter((order) => order.assigned_trader_id === trader_id);

  if (status) {
    result = result.filter((order) => order.status === status);
  }

  res.json({
    success: true,
    trader_id,
    count: result.length,
    orders: result
  });
});

router.get("/orders/:id", (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      error_code: "ORDER_NOT_FOUND",
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    order
  });
});

router.post("/orders/:id/confirm", (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      error_code: "ORDER_NOT_FOUND",
      message: "Order not found"
    });
  }

  if (order.status !== "WAITING_PAYMENT") {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_ORDER_STATUS",
      message: `Order cannot be confirmed from status ${order.status}`
    });
  }

  const trader = traders.find((item) => item.id === order.assigned_trader_id);

  order.status = "PAID";
  order.confirmed_at = new Date().toISOString();

  releaseCard(order.assigned_card_id);

  if (trader) {
    trader.reserved_usdt = Math.max(0, trader.reserved_usdt || 0);
  }

  res.json({
    success: true,
    message: "Order confirmed by trader",
    order
  });
});

router.post("/orders/:id/reject", (req, res) => {
  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      error_code: "ORDER_NOT_FOUND",
      message: "Order not found"
    });
  }

  if (order.status !== "WAITING_PAYMENT") {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_ORDER_STATUS",
      message: `Order cannot be rejected from status ${order.status}`
    });
  }

  order.status = "REJECTED";
  order.cancelled_at = new Date().toISOString();
  order.reject_reason = req.body?.reason || "Payment not received";

  releaseCard(order.assigned_card_id);

  res.json({
    success: true,
    message: "Order rejected by trader",
    order
  });
});

module.exports = router;
