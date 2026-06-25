const express = require("express");
const orders = require("../data/orders");
const cards = require("../data/cards");
const traders = require("../data/traders");

const router = express.Router();

function generatePaymentId() {
  return "ph_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
}

function findAvailableCard(amount) {
  return cards.find((card) => {
    const trader = traders.find((item) => item.id === card.trader_id);

    if (!trader) return false;
    if (trader.status !== "online") return false;
    if (trader.available_usdt <= 0) return false;

    if (!card.active) return false;
    if (card.reserved) return false;
    if (amount < card.min_amount) return false;
    if (amount > card.max_amount) return false;
    if (card.payments_today >= card.max_payments_per_day) return false;
    if (card.turnover_today + amount > card.daily_limit) return false;

    return true;
  });
}

function calculateTraderProfit(amount, traderPercent) {
  return Number(((amount * traderPercent) / 100).toFixed(2));
}

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "merchant",
    version: "v2",
    message: "Merchant API module is working",
    endpoints: [
      "POST /api/merchant/create-order",
      "GET /api/merchant/orders",
      "GET /api/merchant/orders/:id",
      "GET /api/merchant/orders/:id/status",
      "POST /api/merchant/orders/:id/cancel"
    ]
  });
});

router.post("/create-order", (req, res) => {
  const {
    merchant_id = "merchant_demo",
    order_id,
    amount,
    currency = "UAH",
    callback_url = null,
    client_name = null,
    description = null,
    metadata = {}
  } = req.body;

  const numericAmount = Number(amount);

  if (!order_id) {
    return res.status(400).json({
      success: false,
      error_code: "ORDER_ID_REQUIRED",
      message: "order_id is required"
    });
  }

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({
      success: false,
      error_code: "AMOUNT_REQUIRED",
      message: "amount must be greater than 0"
    });
  }

  const existingOrder = orders.find((order) => order.merchant_order_id === order_id);

  if (existingOrder) {
    return res.status(409).json({
      success: false,
      error_code: "ORDER_ALREADY_EXISTS",
      message: "order_id already exists",
      payment_id: existingOrder.payment_id,
      status: existingOrder.status
    });
  }

  const selectedCard = findAvailableCard(numericAmount);

  if (!selectedCard) {
    return res.status(409).json({
      success: false,
      error_code: "NO_AVAILABLE_CARDS",
      message: "No available card for this amount"
    });
  }

  const trader = traders.find((item) => item.id === selectedCard.trader_id);
  const traderPercent = trader.percent;
  const traderProfitUah = calculateTraderProfit(numericAmount, traderPercent);

  selectedCard.reserved = true;
  selectedCard.current_order_id = order_id;
  selectedCard.payments_today += 1;
  selectedCard.turnover_today += numericAmount;

  const order = {
    payment_id: generatePaymentId(),
    merchant_id,
    merchant_order_id: order_id,
    amount: numericAmount,
    currency,
    status: "WAITING_PAYMENT",

    assigned_trader_id: trader.id,
    assigned_trader_name: trader.name,
    assigned_card_id: selectedCard.id,

    bank: selectedCard.bank,
    card_number: selectedCard.card_number,
    card_holder: selectedCard.card_holder,

    trader_percent: traderPercent,
    trader_profit_uah: traderProfitUah,

    callback_url,
    client_name,
    description,
    metadata,

    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    confirmed_at: null,
    cancelled_at: null
  };

  orders.push(order);

  return res.status(201).json({
    success: true,
    payment: order
  });
});

router.get("/orders", (req, res) => {
  const { status } = req.query;
  let result = orders;

  if (status) {
    result = orders.filter((order) => order.status === status);
  }

  res.json({
    success: true,
    count: result.length,
    orders: result
  });
});

router.get("/orders/:id", (req, res) => {
  const order = orders.find(
    (item) => item.payment_id === req.params.id || item.merchant_order_id === req.params.id
  );

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

router.get("/orders/:id/status", (req, res) => {
  const order = orders.find(
    (item) => item.payment_id === req.params.id || item.merchant_order_id === req.params.id
  );

  if (!order) {
    return res.status(404).json({
      success: false,
      error_code: "ORDER_NOT_FOUND",
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    payment_id: order.payment_id,
    merchant_order_id: order.merchant_order_id,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    created_at: order.created_at,
    expires_at: order.expires_at,
    confirmed_at: order.confirmed_at
  });
});

router.post("/orders/:id/cancel", (req, res) => {
  const order = orders.find(
    (item) => item.payment_id === req.params.id || item.merchant_order_id === req.params.id
  );

  if (!order) {
    return res.status(404).json({
      success: false,
      error_code: "ORDER_NOT_FOUND",
      message: "Order not found"
    });
  }

  if (order.status === "CONFIRMED") {
    return res.status(400).json({
      success: false,
      error_code: "ORDER_ALREADY_CONFIRMED",
      message: "Confirmed order cannot be cancelled"
    });
  }

  const card = cards.find((item) => item.id === order.assigned_card_id);

  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  order.status = "CANCELLED";
  order.cancelled_at = new Date().toISOString();

  res.json({
    success: true,
    order
  });
});

module.exports = router;
