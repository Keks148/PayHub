const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/*
  PayHub vNext
  ЕДИНОЕ ХРАНИЛИЩЕ ДЛЯ ВСЕХ:
  merchant -> admin -> trader

  ВАЖНО:
  Это память сервера. На Render Free после перезапуска данные сбросятся.
  Позже перенесём в MongoDB/PostgreSQL.
*/

const store = {
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

/* =====================
   STATIC FRONTEND
===================== */

app.use(express.static(path.join(__dirname, "../frontend")));

/* =====================
   HELPERS
===================== */

function nowIso() {
  return new Date().toISOString();
}

function makeOrderId() {
  return "ORDER_" + Date.now();
}

function makeTraderId() {
  return "trader_" + Date.now();
}

function makeCardId() {
  return "card_" + Date.now();
}

function getTraderById(id) {
  return store.traders.find(t => t.id === id);
}

function getCardById(id) {
  return store.cards.find(c => c.id === id);
}

function getOrderById(id) {
  return store.orders.find(o => o.id === id);
}

function findFreeCard(amount) {
  return store.cards.find(card => {
    if (!card.active) return false;
    if (card.reserved) return false;

    const min = Number(card.min_amount || 0);
    const max = Number(card.max_amount || 0);
    const daily = Number(card.daily_limit || 0);
    const turnoverToday = Number(card.turnover_today || 0);
    const paymentsToday = Number(card.payments_today || 0);
    const maxPayments = Number(card.max_payments_per_day || 0);

    if (amount < min) return false;
    if (amount > max) return false;
    if (daily > 0 && turnoverToday + amount > daily) return false;
    if (maxPayments > 0 && paymentsToday >= maxPayments) return false;

    const trader = getTraderById(card.trader_id);
    if (!trader) return false;
    if (trader.status !== "online") return false;

    return true;
  });
}

function calcStats() {
  const total_orders = store.orders.length;
  const waiting_orders = store.orders.filter(o => o.status === "waiting").length;
  const paid_orders = store.orders.filter(o => o.status === "paid").length;
  const rejected_orders = store.orders.filter(o => o.status === "rejected").length;
  const cancelled_orders = store.orders.filter(o => o.status === "cancelled").length;

  const turnover_uah = store.orders
    .filter(o => o.status === "paid")
    .reduce((sum, o) => sum + Number(o.amount_uah || 0), 0);

  const trader_profit_uah = store.orders
    .filter(o => o.status === "paid")
    .reduce((sum, o) => sum + Number(o.trader_profit_uah || 0), 0);

  return {
    total_orders,
    waiting_orders,
    paid_orders,
    rejected_orders,
    cancelled_orders,
    turnover_uah,
    trader_profit_uah,
    traders_count: store.traders.length,
    cards_count: store.cards.length,
    active_cards: store.cards.filter(c => c.active).length
  };
}

function publicOrder(order) {
  const trader = getTraderById(order.trader_id);

  return {
    ...order,
    trader_name: trader ? trader.name : order.trader_name
  };
}

/* =====================
   ROOT / HEALTH
===================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PayHub backend is running",
    project: "PayHub",
    version: "vNext-1",
    modules: ["merchant", "admin", "trader", "debug"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "payhub-backend",
    version: "vNext-1",
    timestamp: nowIso()
  });
});

app.get("/api/debug/store", (req, res) => {
  res.json({
    success: true,
    store
  });
});

/* =====================
   MERCHANT API
===================== */

app.get("/api/merchant", (req, res) => {
  res.json({
    success: true,
    module: "merchant",
    version: "vNext-1",
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

app.post("/api/merchant/create-order", (req, res) => {
  try {
    const {
      amount,
      amount_uah,
      currency = "UAH",
      merchant_id = "merchant_demo",
      merchant_order_id = null,
      client_name = null,
      description = null,
      callback_url = null,
      metadata = {}
    } = req.body || {};

    const finalAmount = Number(amount_uah || amount || 0);

    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "amount or amount_uah is required"
      });
    }

    const card = findFreeCard(finalAmount);

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
    const orderId = makeOrderId();

    const order = {
      id: orderId,
      payment_id: "ph_" + Date.now(),
      merchant_id,
      merchant_order_id: merchant_order_id || orderId,
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
      callback_url,
      metadata,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
        payment_id: order.payment_id,
        order_id: order.id,
        merchant_order_id: order.merchant_order_id,
        amount: order.amount_uah,
        currency: order.currency,
        status: order.status,
        bank: order.bank,
        card_number: order.card_number,
        card_holder: order.card_holder,
        expires_at: order.expires_at,
        expires_in_minutes: 15
      },
      order: publicOrder(order)
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

app.get("/api/merchant/orders", (req, res) => {
  const merchantId = req.query.merchant_id;

  let orders = store.orders.map(publicOrder);

  if (merchantId) {
    orders = orders.filter(o => o.merchant_id === merchantId);
  }

  res.json({
    success: true,
    count: orders.length,
    orders
  });
});

app.get("/api/merchant/orders/:id", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    order: publicOrder(order)
  });
});

app.get("/api/merchant/orders/:id/status", (req, res) => {
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
    merchant_order_id: order.merchant_order_id,
    status: order.status,
    amount: order.amount_uah,
    currency: order.currency,
    paid_at: order.paid_at,
    rejected_at: order.rejected_at,
    cancelled_at: order.cancelled_at
  });
});

app.post("/api/merchant/orders/:id/cancel", (req, res) => {
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
  order.cancelled_at = nowIso();

  const card = getCardById(order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  res.json({
    success: true,
    message: "Order cancelled",
    order: publicOrder(order)
  });
});

/* =====================
   ADMIN API
===================== */

app.get("/api/admin", (req, res) => {
  res.json({
    success: true,
    module: "admin",
    version: "vNext-1",
    message: "Admin API module is working"
  });
});

app.get("/api/admin/stats", (req, res) => {
  res.json({
    success: true,
    stats: calcStats()
  });
});

app.get("/api/admin/orders", (req, res) => {
  res.json({
    success: true,
    count: store.orders.length,
    orders: store.orders.map(publicOrder)
  });
});

app.get("/api/admin/traders", (req, res) => {
  res.json({
    success: true,
    count: store.traders.length,
    traders: store.traders
  });
});

app.get("/api/admin/cards", (req, res) => {
  res.json({
    success: true,
    count: store.cards.length,
    cards: store.cards
  });
});

app.post("/api/admin/orders/create", (req, res) => {
  req.body = {
    ...req.body,
    merchant_id: req.body?.merchant_id || "admin_test",
    client_name: req.body?.client_name || "Admin test",
    description: req.body?.description || "Created from admin panel"
  };

  const fakeReq = req;
  const fakeRes = res;

  return app._router.handle(
    {
      ...fakeReq,
      method: "POST",
      url: "/api/merchant/create-order",
      originalUrl: "/api/merchant/create-order"
    },
    fakeRes,
    () => {}
  );
});

app.post("/api/admin/traders/create", (req, res) => {
  try {
    const { name, percent, available_usdt } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "name is required"
      });
    }

    const trader = {
      id: makeTraderId(),
      name: String(name).trim(),
      status: "online",
      percent: Number(percent) || 4.5,
      available_usdt: Number(available_usdt) || 0,
      reserved_usdt: 0
    };

    store.traders.push(trader);

    res.json({
      success: true,
      message: "Trader created",
      trader
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

app.post("/api/admin/cards/create", (req, res) => {
  try {
    const {
      trader_id,
      bank,
      card_number,
      card_holder,
      min_amount,
      max_amount,
      daily_limit,
      max_payments_per_day
    } = req.body || {};

    if (!trader_id) {
      return res.status(400).json({
        success: false,
        message: "trader_id is required"
      });
    }

    const trader = getTraderById(trader_id);

    if (!trader) {
      return res.status(404).json({
        success: false,
        message: "Trader not found"
      });
    }

    if (!bank || !card_number || !card_holder) {
      return res.status(400).json({
        success: false,
        message: "bank, card_number, card_holder are required"
      });
    }

    const card = {
      id: makeCardId(),
      trader_id,
      bank: String(bank).trim(),
      card_number: String(card_number).trim(),
      card_holder: String(card_holder).trim(),
      min_amount: Number(min_amount) || 1000,
      max_amount: Number(max_amount) || 6000,
      daily_limit: Number(daily_limit) || 500000,
      max_payments_per_day: Number(max_payments_per_day) || 5,
      payments_today: 0,
      turnover_today: 0,
      active: true,
      reserved: false,
      current_order_id: null
    };

    store.cards.push(card);

    res.json({
      success: true,
      message: "Card created",
      card
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

app.patch("/api/admin/cards/:id/toggle", (req, res) => {
  const card = getCardById(req.params.id);

  if (!card) {
    return res.status(404).json({
      success: false,
      message: "Card not found"
    });
  }

  card.active = !card.active;

  res.json({
    success: true,
    message: card.active ? "Card activated" : "Card disabled",
    card
  });
});

app.patch("/api/admin/orders/:id/paid", (req, res) => {
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
      message: `Only waiting order can be paid. Current status: ${order.status}`
    });
  }

  order.status = "paid";
  order.paid_at = nowIso();

  const card = getCardById(order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
    card.payments_today = Number(card.payments_today || 0) + 1;
    card.turnover_today = Number(card.turnover_today || 0) + Number(order.amount_uah || 0);
  }

  res.json({
    success: true,
    message: "Order marked as paid",
    order: publicOrder(order),
    stats: calcStats()
  });
});

app.patch("/api/admin/orders/:id/reject", (req, res) => {
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
      message: `Only waiting order can be rejected. Current status: ${order.status}`
    });
  }

  order.status = "rejected";
  order.rejected_at = nowIso();

  const card = getCardById(order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  res.json({
    success: true,
    message: "Order rejected",
    order: publicOrder(order),
    stats: calcStats()
  });
});

/* =====================
   TRADER API
===================== */

app.get("/api/trader", (req, res) => {
  res.json({
    success: true,
    module: "trader",
    version: "vNext-1",
    message: "Trader API module is working"
  });
});

app.get("/api/trader/:id/profile", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  res.json({
    success: true,
    trader
  });
});

app.get("/api/trader/:id/orders", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const orders = store.orders
    .filter(o => o.trader_id === trader.id)
    .map(publicOrder);

  res.json({
    success: true,
    trader_id: trader.id,
    count: orders.length,
    orders
  });
});

app.get("/api/trader/:id/cards", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const cards = store.cards.filter(c => c.trader_id === trader.id);

  res.json({
    success: true,
    trader_id: trader.id,
    count: cards.length,
    cards
  });
});

app.patch("/api/trader/orders/:id/confirm", (req, res) => {
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
      message: `Only waiting order can be confirmed. Current status: ${order.status}`
    });
  }

  order.status = "paid";
  order.paid_at = nowIso();

  const card = getCardById(order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
    card.payments_today = Number(card.payments_today || 0) + 1;
    card.turnover_today = Number(card.turnover_today || 0) + Number(order.amount_uah || 0);
  }

  res.json({
    success: true,
    message: "Order confirmed by trader",
    order: publicOrder(order),
    stats: calcStats()
  });
});

app.patch("/api/trader/orders/:id/reject", (req, res) => {
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
      message: `Only waiting order can be rejected. Current status: ${order.status}`
    });
  }

  order.status = "rejected";
  order.rejected_at = nowIso();

  const card = getCardById(order.card_id);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }

  res.json({
    success: true,
    message: "Order rejected by trader",
    order: publicOrder(order),
    stats: calcStats()
  });
});

/* =====================
   404
===================== */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error_code: "NOT_FOUND",
    message: "Route not found",
    path: req.originalUrl
  });
});

/* =====================
   START
===================== */

app.listen(PORT, () => {
  console.log(`PayHub server vNext running on port ${PORT}`);
});
