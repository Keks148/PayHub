const express = require("express");
const router = express.Router();

/*
  Merchant API
  Клиент создаёт заявку → система выдаёт свободную карту → ордер попадает в админку.
*/

if (!global.payhubStore) {
  global.payhubStore = {
    traders: [
      {
        id: "trader_1",
        name: "Trader_1",
        status: "online",
        percent: 4.5,
        available_usdt: 374.3,
        reserved_usdt: 0
      }
    ],
    cards: [
      {
        id: "card_1",
        trader_id: "trader_1",
        bank: "Monobank",
        card_number: "5375410000001234",
        card_holder: "PAYHUB TEST CARD",
        min_amount: 1000,
        max_amount: 6000,
        daily_limit: 500000,
        max_payments_per_day: 5,
        payments_today: 0,
        turnover_today: 0,
        active: true,
        reserved: false,
        current_order_id: null
      }
    ],
    orders: []
  };
}

const store = global.payhubStore;

function makeOrderId() {
  return "ORDER_" + Date.now();
}

function getTraderById(traderId) {
  return store.traders.find(t => t.id === traderId);
}

function getOrderById(orderId) {
  return store.orders.find(o => o.id === orderId);
}

function findFreeCardForAmount(amount) {
  return store.cards.find(card => {
    if (!card.active) return false;
    if (card.reserved) return false;

    if (amount < Number(card.min_amount)) return false;
    if (amount > Number(card.max_amount)) return false;

    if (Number(card.turnover_today || 0) + amount > Number(card.daily_limit || 0)) return false;
    if (Number(card.payments_today || 0) >= Number(card.max_payments_per_day || 0)) return false;

    return true;
  });
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
  try {
    const {
      amount,
      amount_uah,
      currency = "UAH",
      merchant_id = "merchant_demo",
      client_name = null,
      description = null
    } = req.body || {};

    const finalAmount = Number(amount_uah || amount || 0);

    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "amount or amount_uah is required"
      });
    }

    const card = findFreeCardForAmount(finalAmount);

    if (!card) {
      return res.status(400).json({
        success: false,
        message: "No available card for this amount"
      });
    }

    const trader = getTraderById(card.trader_id);

    if (!trader) {
      return res.status(400).json({
        success: false,
        message: "Trader not found for selected card"
      });
    }

    const traderPercent = Number(trader.percent || 0);
    const traderProfit = Number(((finalAmount * traderPercent) / 100).toFixed(2));

    const order = {
      id: makeOrderId(),
      merchant_id,
      amount_uah: finalAmount,
      amount: finalAmount,
      currency,
      status: "waiting",
      trader_id: trader.id,
      trader_name: trader.name,
      trader_percent: traderPercent,
      trader_profit_uah: traderProfit,
      card_id: card.id,
      bank: card.bank,
      card_number: card.card_number,
      card_holder: card.card_holder,
      client_name,
      description,
      created_at: new Date().toISOString(),
      paid_at: null,
      rejected_at: null,
      cancelled_at: null
    };

    store.orders.unshift(order);

    card.reserved = true;
    card.current_order_id = order.id;

    return res.json({
      success: true,
      message: "Order created",
      payment: {
        order_id: order.id,
        amount: order.amount_uah,
        currency: order.currency,
        status: order.status,
        bank: order.bank,
        card_number: order.card_number,
        card_holder: order.card_holder,
        expires_in_minutes: 15
      },
      order
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

router.get("/orders", (req, res) => {
  const merchantId = req.query.merchant_id;

  let orders = store.orders;

  if (merchantId) {
    orders = orders.filter(o => o.merchant_id === merchantId);
  }

  res.json({
    success: true,
    count: orders.length,
    orders
  });
});

router.get("/orders/:id", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    order
  });
});

router.get("/orders/:id/status", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    order_id: order.id,
    status: order.status,
    amount: order.amount_uah,
    currency: order.currency
  });
});

router.post("/orders/:id/cancel", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  if (order.status !== "waiting") {
    return res.status(400).json({
      success: false,
      message: `Only waiting order can be cancelled. Current status: ${order.status}`
    });
  }

  order.status = "cancelled";
  order.cancelled_at = new Date().toISOString();

  const card = store.cards.find(c => c.id === order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  res.json({
    success: true,
    message: "Order cancelled",
    order
  });
});

module.exports = router;
