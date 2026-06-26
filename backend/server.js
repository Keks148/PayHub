const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const CONFIG = {
  usdt_rate_uah: 40,
  min_trader_balance_usdt: 100,
  order_lifetime_minutes: 15,
  missed_limit_for_pause: 2,
  usdt_wallet: {
    network: "TRC20",
    address: "PUT_YOUR_USDT_TRC20_WALLET_HERE"
  }
};

const store = {
  traders: [
    {
      id: "trader_1",
      name: "Trader_1",
      status: "online",
      percent: 4.5,
      available_usdt: 374.3,
      reserved_usdt: 0,
      earned_usdt: 0,
      missed_confirmations: 0
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
  orders: [],
  topups: []
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now();
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getTraderById(id) {
  return store.traders.find(t => t.id === id);
}

function getCardById(id) {
  return store.cards.find(c => c.id === id);
}

function getOrderById(id) {
  return store.orders.find(o =>
    o.id === id ||
    o.payment_id === id ||
    o.merchant_order_id === id
  );
}

function updateTraderStatus(trader) {
  if (!trader) return;

  if (Number(trader.available_usdt) <= CONFIG.min_trader_balance_usdt) {
    trader.status = "frozen";
    trader.freeze_reason = "Balance is lower than minimum";
  }
}

function findFreeCard(amountUah) {
  return store.cards.find(card => {
    if (!card.active) return false;
    if (card.reserved) return false;

    const trader = getTraderById(card.trader_id);
    if (!trader) return false;
    if (trader.status !== "online") return false;

    if (amountUah < Number(card.min_amount)) return false;
    if (amountUah > Number(card.max_amount)) return false;

    if (Number(card.turnover_today || 0) + amountUah > Number(card.daily_limit || 0)) return false;
    if (Number(card.payments_today || 0) >= Number(card.max_payments_per_day || 0)) return false;

    const amountUsdt = round2(amountUah / CONFIG.usdt_rate_uah);
    const afterReserve = round2(Number(trader.available_usdt) - amountUsdt);

    if (afterReserve < CONFIG.min_trader_balance_usdt) return false;

    return true;
  });
}

function reserveTraderBalance(trader, amountUsdt) {
  trader.available_usdt = round2(Number(trader.available_usdt) - amountUsdt);
  trader.reserved_usdt = round2(Number(trader.reserved_usdt || 0) + amountUsdt);
  updateTraderStatus(trader);
}

function releaseTraderReserve(trader, amountUsdt, returnToAvailable) {
  trader.reserved_usdt = round2(Math.max(0, Number(trader.reserved_usdt || 0) - amountUsdt));

  if (returnToAvailable) {
    trader.available_usdt = round2(Number(trader.available_usdt || 0) + amountUsdt);

    if (trader.status === "frozen" && trader.available_usdt > CONFIG.min_trader_balance_usdt) {
      trader.status = "online";
      trader.freeze_reason = null;
    }
  }
}

function releaseCard(cardId) {
  const card = getCardById(cardId);
  if (card) {
    card.reserved = false;
    card.current_order_id = null;
  }
}

function calcStats() {
  return {
    total_orders: store.orders.length,
    waiting_orders: store.orders.filter(o => o.status === "waiting").length,
    paid_orders: store.orders.filter(o => o.status === "paid").length,
    rejected_orders: store.orders.filter(o => o.status === "rejected").length,
    cancelled_orders: store.orders.filter(o => o.status === "cancelled").length,
    expired_orders: store.orders.filter(o => o.status === "expired").length,
    turnover_uah: store.orders
      .filter(o => o.status === "paid")
      .reduce((s, o) => s + Number(o.amount_uah || 0), 0),
    trader_profit_uah: store.orders
      .filter(o => o.status === "paid")
      .reduce((s, o) => s + Number(o.trader_profit_uah || 0), 0),
    trader_profit_usdt: round2(store.orders
      .filter(o => o.status === "paid")
      .reduce((s, o) => s + Number(o.trader_profit_usdt || 0), 0)),
    traders_count: store.traders.length,
    cards_count: store.cards.length,
    active_cards: store.cards.filter(c => c.active).length,
    usdt_rate_uah: CONFIG.usdt_rate_uah
  };
}

function publicOrder(order) {
  const trader = getTraderById(order.trader_id);
  return {
    ...order,
    trader_name: trader ? trader.name : order.trader_name
  };
}

function expireOldOrders() {
  const now = Date.now();

  store.orders.forEach(order => {
    if (order.status !== "waiting") return;

    const expiresAt = new Date(order.expires_at).getTime();
    if (now <= expiresAt) return;

    order.status = "expired";
    order.expired_at = nowIso();

    const trader = getTraderById(order.trader_id);
    if (trader) {
      releaseTraderReserve(trader, order.amount_usdt, true);
      trader.missed_confirmations = Number(trader.missed_confirmations || 0) + 1;

      if (trader.missed_confirmations >= CONFIG.missed_limit_for_pause) {
        trader.status = "pause";
        trader.pause_reason = "Too many expired orders";
      }
    }

    releaseCard(order.card_id);
  });
}

/* ROOT */

app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "PayHub",
    version: "vNext-2-receipt-balance",
    config: CONFIG
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: nowIso()
  });
});

app.get("/api/debug/store", (req, res) => {
  res.json({
    success: true,
    store
  });
});

/* MERCHANT */

app.get("/api/merchant", (req, res) => {
  res.json({
    success: true,
    module: "merchant",
    version: "vNext-2",
    endpoints: [
      "POST /api/merchant/create-order",
      "POST /api/merchant/orders/:id/receipt",
      "GET /api/merchant/orders",
      "GET /api/merchant/orders/:id",
      "GET /api/merchant/orders/:id/status",
      "POST /api/merchant/orders/:id/cancel"
    ]
  });
});

app.post("/api/merchant/create-order", (req, res) => {
  expireOldOrders();

  const {
    amount,
    amount_uah,
    currency = "UAH",
    merchant_id = "merchant_demo",
    merchant_order_id = null,
    client_name = null,
    description = null,
    callback_url = null,
    metadata = {},
    receipt_url = null
  } = req.body || {};

  const amountUah = Number(amount_uah || amount || 0);

  if (!amountUah || amountUah <= 0) {
    return res.status(400).json({
      success: false,
      message: "amount or amount_uah is required"
    });
  }

  const card = findFreeCard(amountUah);

  if (!card) {
    return res.status(400).json({
      success: false,
      message: "No available card for this amount or trader balance is too low"
    });
  }

  const trader = getTraderById(card.trader_id);
  const amountUsdt = round2(amountUah / CONFIG.usdt_rate_uah);
  const traderProfitUah = round2((amountUah * Number(trader.percent)) / 100);
  const traderProfitUsdt = round2(traderProfitUah / CONFIG.usdt_rate_uah);

  reserveTraderBalance(trader, amountUsdt);

  const orderId = makeId("ORDER");

  const order = {
    id: orderId,
    payment_id: makeId("ph"),
    merchant_id,
    merchant_order_id: merchant_order_id || orderId,

    amount_uah: amountUah,
    amount_usdt: amountUsdt,
    reserved_usdt: amountUsdt,
    currency,
    usdt_rate_uah: CONFIG.usdt_rate_uah,

    status: "waiting",

    trader_id: trader.id,
    trader_name: trader.name,
    trader_percent: trader.percent,
    trader_profit_uah: traderProfitUah,
    trader_profit_usdt: traderProfitUsdt,

    card_id: card.id,
    bank: card.bank,
    card_number: card.card_number,
    card_holder: card.card_holder,

    client_name,
    description,
    callback_url,
    metadata,

    receipt_url,
    receipt_uploaded_at: receipt_url ? nowIso() : null,

    created_at: nowIso(),
    expires_at: new Date(Date.now() + CONFIG.order_lifetime_minutes * 60 * 1000).toISOString(),
    paid_at: null,
    rejected_at: null,
    cancelled_at: null,
    expired_at: null
  };

  store.orders.unshift(order);

  card.reserved = true;
  card.current_order_id = order.id;

  res.json({
    success: true,
    message: "Order created",
    payment: {
      payment_id: order.payment_id,
      order_id: order.id,
      merchant_order_id: order.merchant_order_id,
      amount_uah: order.amount_uah,
      amount_usdt: order.amount_usdt,
      usdt_rate_uah: order.usdt_rate_uah,
      currency: order.currency,
      status: order.status,
      bank: order.bank,
      card_number: order.card_number,
      card_holder: order.card_holder,
      receipt_url: order.receipt_url,
      expires_at: order.expires_at
    },
    order: publicOrder(order)
  });
});

app.post("/api/merchant/orders/:id/receipt", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  const { receipt_url } = req.body || {};

  if (!receipt_url) {
    return res.status(400).json({
      success: false,
      message: "receipt_url is required"
    });
  }

  order.receipt_url = receipt_url;
  order.receipt_uploaded_at = nowIso();

  res.json({
    success: true,
    message: "Receipt attached",
    order: publicOrder(order)
  });
});

app.get("/api/merchant/orders", (req, res) => {
  expireOldOrders();

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
  expireOldOrders();

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
  expireOldOrders();

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
    amount_uah: order.amount_uah,
    amount_usdt: order.amount_usdt,
    usdt_rate_uah: order.usdt_rate_uah,
    receipt_url: order.receipt_url,
    paid_at: order.paid_at
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

  const trader = getTraderById(order.trader_id);
  if (trader) {
    releaseTraderReserve(trader, order.reserved_usdt, true);
  }

  releaseCard(order.card_id);

  res.json({
    success: true,
    message: "Order cancelled",
    order: publicOrder(order)
  });
});

/* ADMIN */

app.get("/api/admin", (req, res) => {
  res.json({
    success: true,
    module: "admin",
    version: "vNext-2"
  });
});

app.get("/api/admin/stats", (req, res) => {
  expireOldOrders();

  res.json({
    success: true,
    stats: calcStats()
  });
});

app.get("/api/admin/orders", (req, res) => {
  expireOldOrders();

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
  req.url = "/api/merchant/create-order";
  return app._router.handle(req, res, () => {});
});

app.patch("/api/admin/orders/:id/receipt", (req, res) => {
  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  const { receipt_url } = req.body || {};

  if (!receipt_url) {
    return res.status(400).json({
      success: false,
      message: "receipt_url is required"
    });
  }

  order.receipt_url = receipt_url;
  order.receipt_uploaded_at = nowIso();

  res.json({
    success: true,
    message: "Receipt updated",
    order: publicOrder(order)
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

  const trader = getTraderById(order.trader_id);
  if (trader) {
    releaseTraderReserve(trader, order.reserved_usdt, false);
    trader.earned_usdt = round2(Number(trader.earned_usdt || 0) + Number(order.trader_profit_usdt || 0));
    trader.missed_confirmations = 0;
    updateTraderStatus(trader);
  }

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

  const trader = getTraderById(order.trader_id);
  if (trader) {
    releaseTraderReserve(trader, order.reserved_usdt, true);
  }

  releaseCard(order.card_id);

  res.json({
    success: true,
    message: "Order rejected",
    order: publicOrder(order),
    stats: calcStats()
  });
});

app.post("/api/admin/traders/create", (req, res) => {
  const { name, percent, available_usdt } = req.body || {};

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "name is required"
    });
  }

  const trader = {
    id: makeId("trader"),
    name,
    status: "online",
    percent: Number(percent) || 4.5,
    available_usdt: Number(available_usdt) || 0,
    reserved_usdt: 0,
    earned_usdt: 0,
    missed_confirmations: 0
  };

  updateTraderStatus(trader);
  store.traders.push(trader);

  res.json({
    success: true,
    message: "Trader created",
    trader
  });
});

app.patch("/api/admin/traders/:id/unpause", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  if (Number(trader.available_usdt) <= CONFIG.min_trader_balance_usdt) {
    trader.status = "frozen";
    trader.freeze_reason = "Balance is lower than minimum";
  } else {
    trader.status = "online";
    trader.pause_reason = null;
    trader.freeze_reason = null;
    trader.missed_confirmations = 0;
  }

  res.json({
    success: true,
    trader
  });
});

app.post("/api/admin/cards/create", (req, res) => {
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

  const trader = getTraderById(trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const card = {
    id: makeId("card"),
    trader_id,
    bank,
    card_number,
    card_holder,
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
    card
  });
});

/* TOPUPS */

app.get("/api/admin/topups", (req, res) => {
  res.json({
    success: true,
    count: store.topups.length,
    topups: store.topups
  });
});

app.post("/api/trader/:id/topups", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const { amount_usdt, txid, network = "TRC20" } = req.body || {};

  if (!amount_usdt || !txid) {
    return res.status(400).json({
      success: false,
      message: "amount_usdt and txid are required"
    });
  }

  const topup = {
    id: makeId("topup"),
    trader_id: trader.id,
    trader_name: trader.name,
    amount_usdt: Number(amount_usdt),
    txid,
    network,
    status: "pending",
    created_at: nowIso(),
    approved_at: null,
    rejected_at: null
  };

  store.topups.unshift(topup);

  res.json({
    success: true,
    message: "Topup request created",
    wallet: CONFIG.usdt_wallet,
    topup
  });
});

app.patch("/api/admin/topups/:id/approve", (req, res) => {
  const topup = store.topups.find(t => t.id === req.params.id);

  if (!topup) {
    return res.status(404).json({
      success: false,
      message: "Topup not found"
    });
  }

  if (topup.status !== "pending") {
    return res.status(400).json({
      success: false,
      message: `Topup already ${topup.status}`
    });
  }

  const trader = getTraderById(topup.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  trader.available_usdt = round2(Number(trader.available_usdt || 0) + Number(topup.amount_usdt));
  if (trader.available_usdt > CONFIG.min_trader_balance_usdt) {
    trader.status = "online";
    trader.freeze_reason = null;
    trader.pause_reason = null;
  }

  topup.status = "approved";
  topup.approved_at = nowIso();

  res.json({
    success: true,
    message: "Topup approved",
    trader,
    topup
  });
});

app.patch("/api/admin/topups/:id/reject", (req, res) => {
  const topup = store.topups.find(t => t.id === req.params.id);

  if (!topup) {
    return res.status(404).json({
      success: false,
      message: "Topup not found"
    });
  }

  topup.status = "rejected";
  topup.rejected_at = nowIso();

  res.json({
    success: true,
    message: "Topup rejected",
    topup
  });
});

/* TRADER */

app.get("/api/trader/:id/orders", (req, res) => {
  expireOldOrders();

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
    count: cards.length,
    cards
  });
});

app.get("/api/trader/:id/wallet", (req, res) => {
  const trader = getTraderById(req.params.id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  res.json({
    success: true,
    trader_id: trader.id,
    available_usdt: trader.available_usdt,
    reserved_usdt: trader.reserved_usdt,
    earned_usdt: trader.earned_usdt,
    min_balance_usdt: CONFIG.min_trader_balance_usdt,
    usdt_rate_uah: CONFIG.usdt_rate_uah,
    wallet: CONFIG.usdt_wallet
  });
});

/* 404 */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error_code: "NOT_FOUND",
    message: "Route not found",
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`PayHub server vNext-2 running on port ${PORT}`);
});
