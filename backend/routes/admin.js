const express = require("express");
const orders = require("../data/orders");
const cards = require("../data/cards");
const traders = require("../data/traders");

const router = express.Router();

function findCard(id) {
  return cards.find((card) => card.id === id);
}

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "admin",
    version: "v1",
    message: "Admin API module is working",
    endpoints: [
      "GET /api/admin/stats",
      "GET /api/admin/orders",
      "GET /api/admin/traders",
      "GET /api/admin/cards",
      "POST /api/admin/cards/create",
      "PATCH /api/admin/cards/:id/toggle",
      "PATCH /api/admin/cards/:id/limits"
    ]
  });
});

router.get("/stats", (req, res) => {
  const totalOrders = orders.length;
  const waitingOrders = orders.filter((order) => order.status === "WAITING_PAYMENT").length;
  const paidOrders = orders.filter((order) => order.status === "PAID").length;
  const rejectedOrders = orders.filter((order) => order.status === "REJECTED").length;
  const cancelledOrders = orders.filter((order) => order.status === "CANCELLED").length;

  const turnoverUah = orders
    .filter((order) => order.status === "PAID")
    .reduce((sum, order) => sum + Number(order.amount || 0), 0);

  const traderProfitUah = orders
    .filter((order) => order.status === "PAID")
    .reduce((sum, order) => sum + Number(order.trader_profit_uah || 0), 0);

  res.json({
    success: true,
    stats: {
      total_orders: totalOrders,
      waiting_orders: waitingOrders,
      paid_orders: paidOrders,
      rejected_orders: rejectedOrders,
      cancelled_orders: cancelledOrders,
      turnover_uah: turnoverUah,
      trader_profit_uah: traderProfitUah,
      traders_count: traders.length,
      cards_count: cards.length,
      active_cards: cards.filter((card) => card.active).length
    }
  });
});

router.get("/orders", (req, res) => {
  const { status, trader_id } = req.query;

  let result = orders;

  if (status) {
    result = result.filter((order) => order.status === status);
  }

  if (trader_id) {
    result = result.filter((order) => order.assigned_trader_id === trader_id);
  }

  res.json({
    success: true,
    count: result.length,
    orders: result
  });
});

router.get("/traders", (req, res) => {
  res.json({
    success: true,
    count: traders.length,
    traders
  });
});

router.get("/cards", (req, res) => {
  res.json({
    success: true,
    count: cards.length,
    cards
  });
});

router.post("/cards/create", (req, res) => {
  const {
    trader_id = "trader_1",
    bank,
    card_number,
    card_holder,
    min_amount = 1000,
    max_amount = 6000,
    daily_limit = 500000,
    max_payments_per_day = 5,
    active = true
  } = req.body;

  if (!bank || !card_number || !card_holder) {
    return res.status(400).json({
      success: false,
      error_code: "CARD_FIELDS_REQUIRED",
      message: "bank, card_number and card_holder are required"
    });
  }

  const trader = traders.find((item) => item.id === trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      error_code: "TRADER_NOT_FOUND",
      message: "Trader not found"
    });
  }

  const card = {
    id: "card_" + (cards.length + 1),
    trader_id,
    bank,
    card_number,
    card_holder,
    min_amount: Number(min_amount),
    max_amount: Number(max_amount),
    daily_limit: Number(daily_limit),
    max_payments_per_day: Number(max_payments_per_day),
    payments_today: 0,
    turnover_today: 0,
    active: Boolean(active),
    reserved: false,
    current_order_id: null
  };

  cards.push(card);

  res.status(201).json({
    success: true,
    card
  });
});

router.patch("/cards/:id/toggle", (req, res) => {
  const card = findCard(req.params.id);

  if (!card) {
    return res.status(404).json({
      success: false,
      error_code: "CARD_NOT_FOUND",
      message: "Card not found"
    });
  }

  if (typeof req.body.active === "boolean") {
    card.active = req.body.active;
  } else {
    card.active = !card.active;
  }

  res.json({
    success: true,
    card
  });
});

router.patch("/cards/:id/limits", (req, res) => {
  const card = findCard(req.params.id);

  if (!card) {
    return res.status(404).json({
      success: false,
      error_code: "CARD_NOT_FOUND",
      message: "Card not found"
    });
  }

  const allowedFields = [
    "min_amount",
    "max_amount",
    "daily_limit",
    "max_payments_per_day"
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      card[field] = Number(req.body[field]);
    }
  });

  res.json({
    success: true,
    card
  });
});

module.exports = router;
