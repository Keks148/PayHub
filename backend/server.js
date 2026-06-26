const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const RECEIPTS_DIR = path.join(UPLOAD_DIR, "receipts");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/uploads", express.static(UPLOAD_DIR));

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

const defaultStore = {
  traders: [
    {
      id: "trader_1",
      name: "Trader_1",
      status: "online",
      percent: 4.5,
      available_usdt: 374.3,
      reserved_usdt: 0,
      earned_usdt: 0,
      missed_confirmations: 0,
      priority: 0,
      max_active_orders: 3,
      active_orders: 0,
      last_order_at: null
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
  topups: [],
  withdrawals: [],
  events: []
};

function cloneDefaultStore() {
  return JSON.parse(JSON.stringify(defaultStore));
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(STORE_FILE)) {
      const freshStore = cloneDefaultStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(freshStore, null, 2));
      return freshStore;
    }

    const loaded = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));

    return {
      ...cloneDefaultStore(),
      ...loaded,
      traders: Array.isArray(loaded.traders) ? loaded.traders : [],
      cards: Array.isArray(loaded.cards) ? loaded.cards : [],
      orders: Array.isArray(loaded.orders) ? loaded.orders : [],
      topups: Array.isArray(loaded.topups) ? loaded.topups : [],
      withdrawals: Array.isArray(loaded.withdrawals) ? loaded.withdrawals : [],
      events: Array.isArray(loaded.events) ? loaded.events : []
    };
  } catch (error) {
    console.error("Failed to load store.json:", error);
    return cloneDefaultStore();
  }
}

const store = loadStore();

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error("Failed to save store.json:", error);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now();
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function addEvent(type, message, data = {}) {
  if (!Array.isArray(store.events)) store.events = [];

  const event = {
    id: makeId("event"),
    type,
    message,
    data,
    created_at: nowIso()
  };

  store.events.unshift(event);

  if (store.events.length > 500) {
    store.events = store.events.slice(0, 500);
  }

  return event;
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

function getActiveOrdersCount(traderId) {
  return store.orders.filter(o => o.trader_id === traderId && o.status === "waiting").length;
}

function normalizeTrader(trader) {
  if (!trader) return null;

  if (!trader.status) trader.status = "online";
  if (trader.priority === undefined) trader.priority = 0;
  if (trader.max_active_orders === undefined) trader.max_active_orders = 3;
  trader.active_orders = getActiveOrdersCount(trader.id);
  if (trader.last_order_at === undefined) trader.last_order_at = null;
  if (trader.earned_usdt === undefined) trader.earned_usdt = 0;
  if (trader.reserved_usdt === undefined) trader.reserved_usdt = 0;
  if (trader.missed_confirmations === undefined) trader.missed_confirmations = 0;

  return trader;
}

function normalizeAllTraders() {
  store.traders.forEach(normalizeTrader);
}

normalizeAllTraders();

function updateTraderStatus(trader) {
  if (!trader) return;

  normalizeTrader(trader);

  if (Number(trader.available_usdt) <= CONFIG.min_trader_balance_usdt) {
    trader.status = "frozen";
    trader.freeze_reason = "Balance is lower than minimum";
    return;
  }

  if (trader.status === "frozen") {
    trader.status = "online";
    trader.freeze_reason = null;
  }
}

function findBestAssignment(amountUah) {
  normalizeAllTraders();

  const candidates = [];

  for (const card of store.cards) {
    if (!card.active) continue;
    if (card.reserved) continue;

    const trader = getTraderById(card.trader_id);
    if (!trader) continue;

    normalizeTrader(trader);
    updateTraderStatus(trader);

    if (trader.status !== "online") continue;

    const activeOrders = getActiveOrdersCount(trader.id);
    const maxActiveOrders = Number(trader.max_active_orders || 3);
    if (activeOrders >= maxActiveOrders) continue;

    if (amountUah < Number(card.min_amount || 0)) continue;
    if (amountUah > Number(card.max_amount || 0)) continue;

    if (Number(card.turnover_today || 0) + amountUah > Number(card.daily_limit || 0)) continue;
    if (Number(card.payments_today || 0) >= Number(card.max_payments_per_day || 0)) continue;

    const amountUsdt = round2(amountUah / CONFIG.usdt_rate_uah);
    const afterReserve = round2(Number(trader.available_usdt || 0) - amountUsdt);

    if (afterReserve < CONFIG.min_trader_balance_usdt) continue;

    candidates.push({
      trader,
      card,
      activeOrders,
      priority: Number(trader.priority || 0),
      lastOrderAt: trader.last_order_at ? new Date(trader.last_order_at).getTime() : 0,
      availableUsdt: Number(trader.available_usdt || 0)
    });
  }

  candidates.sort((a, b) => {
    if (a.activeOrders !== b.activeOrders) return a.activeOrders - b.activeOrders;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.lastOrderAt !== b.lastOrderAt) return a.lastOrderAt - b.lastOrderAt;
    return b.availableUsdt - a.availableUsdt;
  });

  return candidates[0] || null;
}

function getNoAssignmentReason(amountUah) {
  const onlineTraders = store.traders.filter(t => t.status === "online");
  const activeCards = store.cards.filter(c => c.active);

  if (!store.traders.length) return "No traders created";
  if (!onlineTraders.length) return "No online traders";
  if (!activeCards.length) return "No active cards";

  return "No available card: amount limits, daily limit, active orders limit or trader balance is too low";
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

function ensureUploadDirs() {
  if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  }
}

function getBaseUrl(req) {
  const envUrl = process.env.PUBLIC_BASE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function saveReceiptFromBody(req, order) {
  const body = req.body || {};
  const receiptUrl = body.receipt_url || null;

  if (receiptUrl) {
    return {
      receipt_url: receiptUrl,
      receipt_file_name: null,
      receipt_mime_type: null
    };
  }

  const rawData = body.receipt_base64 || body.receipt_file_base64 || body.file_base64 || body.image_base64 || null;

  if (!rawData) return null;

  let mimeType = body.receipt_mime_type || body.mime_type || "image/jpeg";
  let base64 = rawData;

  const match = String(rawData).match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (match) {
    mimeType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    base64 = match[3];
  }

  const allowed = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };

  const ext = allowed[mimeType];
  if (!ext) {
    const error = new Error("Only jpg, png or webp receipt images are allowed");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(String(base64), "base64");
  const maxSizeBytes = 5 * 1024 * 1024;

  if (!buffer.length || buffer.length > maxSizeBytes) {
    const error = new Error("Receipt image is empty or larger than 5MB");
    error.statusCode = 400;
    throw error;
  }

  ensureUploadDirs();

  const safeOrderId = String(order.id || order.payment_id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeOrderId}_${Date.now()}.${ext}`;
  const filePath = path.join(RECEIPTS_DIR, fileName);

  fs.writeFileSync(filePath, buffer);

  return {
    receipt_url: `${getBaseUrl(req)}/uploads/receipts/${fileName}`,
    receipt_file_name: fileName,
    receipt_mime_type: mimeType
  };
}

function attachReceipt(req, order) {
  const savedReceipt = saveReceiptFromBody(req, order);

  if (!savedReceipt) {
    return null;
  }

  order.receipt_url = savedReceipt.receipt_url;
  order.receipt_file_name = savedReceipt.receipt_file_name;
  order.receipt_mime_type = savedReceipt.receipt_mime_type;
  order.receipt_uploaded_at = nowIso();

  return savedReceipt;
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

    if (trader) {
      trader.active_orders = getActiveOrdersCount(trader.id);
    }

    addEvent("order_expired", `Order ${order.id} expired`, {
      order_id: order.id,
      trader_id: order.trader_id,
      amount_uah: order.amount_uah
    });

    saveStore();
  });
}

/* ROOT */

app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "PayHub",
    version: "vNext-4-auto-distribution",
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
/* MERCHANT / CLIENT API */

app.post("/api/merchant/create-payment", (req, res) => {
  expireOldOrders();

  const body = req.body || {};
  const amountUah = Number(body.amount_uah || body.amount || 0);

  if (!amountUah || amountUah <= 0) {
    return res.status(400).json({
      success: false,
      message: "amount_uah is required"
    });
  }

  const assignment = findBestAssignment(amountUah);

  if (!assignment) {
    const reason = getNoAssignmentReason(amountUah);

    addEvent("order_no_assignment", `No trader available for ${amountUah} UAH`, {
      amount_uah: amountUah,
      reason
    });

    saveStore();

    return res.status(409).json({
      success: false,
      message: "No available trader/card",
      reason
    });
  }

  const trader = assignment.trader;
  const card = assignment.card;
  const amountUsdt = round2(amountUah / CONFIG.usdt_rate_uah);

  const order = {
    id: makeId("order"),
    payment_id: makeId("payment"),
    merchant_order_id: body.order_id || body.merchant_order_id || null,
    merchant_id: body.merchant_id || "merchant_1",
    client_id: body.client_id || null,
    amount_uah: amountUah,
    amount_usdt: amountUsdt,
    usdt_rate_uah: CONFIG.usdt_rate_uah,
    trader_percent: Number(trader.percent || 4.5),
    trader_profit_uah: round2(amountUah * (Number(trader.percent || 4.5) / 100)),
    trader_profit_usdt: round2((amountUah * (Number(trader.percent || 4.5) / 100)) / CONFIG.usdt_rate_uah),
    status: "waiting",
    trader_id: trader.id,
    trader_name: trader.name,
    card_id: card.id,
    bank: card.bank,
    card_number: card.card_number,
    card_holder: card.card_holder,
    receipt_url: null,
    receipt_uploaded_at: null,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + CONFIG.order_lifetime_minutes * 60 * 1000).toISOString(),
    paid_at: null,
    rejected_at: null,
    cancelled_at: null,
    expired_at: null
  };

  reserveTraderBalance(trader, amountUsdt);

  card.reserved = true;
  card.current_order_id = order.id;

  trader.last_order_at = nowIso();
  trader.active_orders = getActiveOrdersCount(trader.id) + 1;

  store.orders.unshift(order);

  addEvent("order_assigned", `Order ${order.id} assigned to ${trader.name}`, {
    order_id: order.id,
    trader_id: trader.id,
    trader_name: trader.name,
    card_id: card.id,
    amount_uah: amountUah
  });

  saveStore();

  res.json({
    success: true,
    payment: publicOrder(order)
  });
});

app.get("/api/merchant/payment/:id", (req, res) => {
  expireOldOrders();

  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  res.json({
    success: true,
    payment: publicOrder(order)
  });
});

app.post("/api/merchant/payment/:id/receipt", (req, res) => {
  expireOldOrders();

  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (order.status !== "waiting") {
    return res.status(400).json({
      success: false,
      message: "Receipt can be uploaded only for waiting order"
    });
  }

  try {
    const receipt = attachReceipt(req, order);

    if (!receipt) {
      return res.status(400).json({
        success: false,
        message: "receipt_url or receipt_base64 is required"
      });
    }

    addEvent("receipt_uploaded", `Receipt uploaded for order ${order.id}`, {
      order_id: order.id,
      receipt_url: order.receipt_url
    });

    saveStore();

    res.json({
      success: true,
      payment: publicOrder(order)
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to upload receipt"
    });
  }
});

app.post("/api/merchant/payment/:id/cancel", (req, res) => {
  expireOldOrders();

  const order = getOrderById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (order.status !== "waiting") {
    return res.status(400).json({
      success: false,
      message: "Only waiting order can be cancelled"
    });
  }

  const trader = getTraderById(order.trader_id);

  order.status = "cancelled";
  order.cancelled_at = nowIso();

  if (trader) {
    releaseTraderReserve(trader, order.amount_usdt, true);
    trader.active_orders = getActiveOrdersCount(trader.id);
  }

  releaseCard(order.card_id);

  addEvent("order_cancelled", `Order ${order.id} cancelled by merchant`, {
    order_id: order.id,
    trader_id: order.trader_id
  });

  saveStore();

  res.json({
    success: true,
    payment: publicOrder(order)
  });
});

/* TRADER API */

app.get("/api/trader/:trader_id/profile", (req, res) => {
  expireOldOrders();

  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  normalizeTrader(trader);
  updateTraderStatus(trader);

  saveStore();

  res.json({
    success: true,
    trader
  });
});

app.post("/api/trader/:trader_id/status", (req, res) => {
  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const status = req.body.status;

  const allowed = ["online", "pause", "offline"];

  if (!allowed.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Allowed statuses: online, pause, offline"
    });
  }

  trader.status = status;
  trader.pause_reason = null;
  trader.freeze_reason = null;

  updateTraderStatus(trader);

  addEvent("trader_status_changed", `Trader ${trader.name} changed status to ${trader.status}`, {
    trader_id: trader.id,
    status: trader.status
  });

  saveStore();

  res.json({
    success: true,
    trader
  });
});

app.get("/api/trader/:trader_id/orders", (req, res) => {
  expireOldOrders();

  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  normalizeTrader(trader);

  const orders = store.orders.filter(o => o.trader_id === trader.id);

  res.json({
    success: true,
    trader,
    orders
  });
});

app.post("/api/trader/:trader_id/orders/:order_id/confirm", (req, res) => {
  expireOldOrders();

  const trader = getTraderById(req.params.trader_id);
  const order = getOrderById(req.params.order_id);

  if (!trader || !order || order.trader_id !== trader.id) {
    return res.status(404).json({
      success: false,
      message: "Order not found for this trader"
    });
  }

  if (order.status !== "waiting") {
    return res.status(400).json({
      success: false,
      message: "Only waiting order can be confirmed"
    });
  }

  const card = getCardById(order.card_id);

  order.status = "paid";
  order.paid_at = nowIso();

  trader.reserved_usdt = round2(Math.max(0, Number(trader.reserved_usdt || 0) - Number(order.amount_usdt || 0)));
  trader.earned_usdt = round2(Number(trader.earned_usdt || 0) + Number(order.trader_profit_usdt || 0));
  trader.missed_confirmations = 0;
  trader.active_orders = getActiveOrdersCount(trader.id);

  if (card) {
    card.payments_today = Number(card.payments_today || 0) + 1;
    card.turnover_today = round2(Number(card.turnover_today || 0) + Number(order.amount_uah || 0));
    card.reserved = false;
    card.current_order_id = null;

    if (
      Number(card.payments_today || 0) >= Number(card.max_payments_per_day || 0) ||
      Number(card.turnover_today || 0) >= Number(card.daily_limit || 0)
    ) {
      card.active = false;
      card.disabled_reason = "Daily limit reached";
    }
  }

  updateTraderStatus(trader);

  addEvent("order_confirmed", `Trader ${trader.name} confirmed order ${order.id}`, {
    order_id: order.id,
    trader_id: trader.id,
    amount_uah: order.amount_uah,
    profit_usdt: order.trader_profit_usdt
  });

  saveStore();

  res.json({
    success: true,
    payment: publicOrder(order),
    trader
  });
});

app.post("/api/trader/:trader_id/orders/:order_id/reject", (req, res) => {
  expireOldOrders();

  const trader = getTraderById(req.params.trader_id);
  const order = getOrderById(req.params.order_id);

  if (!trader || !order || order.trader_id !== trader.id) {
    return res.status(404).json({
      success: false,
      message: "Order not found for this trader"
    });
  }

  if (order.status !== "waiting") {
    return res.status(400).json({
      success: false,
      message: "Only waiting order can be rejected"
    });
  }

  order.status = "rejected";
  order.rejected_at = nowIso();
  order.reject_reason = req.body.reason || "Rejected by trader";

  releaseTraderReserve(trader, order.amount_usdt, true);
  releaseCard(order.card_id);

  trader.active_orders = getActiveOrdersCount(trader.id);

  addEvent("order_rejected", `Trader ${trader.name} rejected order ${order.id}`, {
    order_id: order.id,
    trader_id: trader.id,
    reason: order.reject_reason
  });

  saveStore();

  res.json({
    success: true,
    payment: publicOrder(order),
    trader
  });
});
app.get("/api/trader/:trader_id/cards", (req, res) => {
  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const cards = store.cards.filter(c => c.trader_id === trader.id);

  res.json({
    success: true,
    cards
  });
});

app.post("/api/trader/:trader_id/cards", (req, res) => {
  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const body = req.body || {};

  if (!body.bank || !body.card_number || !body.card_holder) {
    return res.status(400).json({
      success: false,
      message: "bank, card_number and card_holder are required"
    });
  }

  const card = {
    id: makeId("card"),
    trader_id: trader.id,
    bank: body.bank,
    card_number: body.card_number,
    card_holder: body.card_holder,
    min_amount: Number(body.min_amount || 1000),
    max_amount: Number(body.max_amount || 6000),
    daily_limit: Number(body.daily_limit || 500000),
    max_payments_per_day: Number(body.max_payments_per_day || 5),
    payments_today: 0,
    turnover_today: 0,
    active: true,
    reserved: false,
    current_order_id: null,
    created_at: nowIso()
  };

  store.cards.unshift(card);

  addEvent("card_created", `Trader ${trader.name} added card ${card.bank}`, {
    trader_id: trader.id,
    card_id: card.id,
    bank: card.bank
  });

  saveStore();

  res.json({
    success: true,
    card
  });
});

app.post("/api/trader/:trader_id/withdrawals", (req, res) => {
  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const amountUsdt = Number(req.body.amount_usdt || 0);
  const wallet = req.body.wallet || req.body.trc20_wallet || "";

  if (!amountUsdt || amountUsdt <= 0) {
    return res.status(400).json({
      success: false,
      message: "amount_usdt is required"
    });
  }

  if (!wallet) {
    return res.status(400).json({
      success: false,
      message: "TRC20 wallet is required"
    });
  }

  if (amountUsdt > Number(trader.earned_usdt || 0)) {
    return res.status(400).json({
      success: false,
      message: "Not enough earned balance"
    });
  }

  trader.earned_usdt = round2(Number(trader.earned_usdt || 0) - amountUsdt);

  const withdrawal = {
    id: makeId("withdrawal"),
    trader_id: trader.id,
    trader_name: trader.name,
    amount_usdt: amountUsdt,
    wallet,
    network: "TRC20",
    status: "pending",
    created_at: nowIso(),
    completed_at: null
  };

  store.withdrawals.unshift(withdrawal);

  addEvent("withdrawal_created", `Trader ${trader.name} requested ${amountUsdt} USDT withdrawal`, {
    trader_id: trader.id,
    withdrawal_id: withdrawal.id,
    amount_usdt: amountUsdt
  });

  saveStore();

  res.json({
    success: true,
    withdrawal,
    trader
  });
});

/* ADMIN API */

app.get("/api/admin/stats", (req, res) => {
  expireOldOrders();

  res.json({
    success: true,
    stats: calcStats()
  });
});

app.get("/api/admin/traders", (req, res) => {
  expireOldOrders();

  normalizeAllTraders();

  res.json({
    success: true,
    traders: store.traders
  });
});

app.post("/api/admin/traders", (req, res) => {
  const body = req.body || {};

  if (!body.name) {
    return res.status(400).json({
      success: false,
      message: "Trader name is required"
    });
  }

  const trader = {
    id: body.id || makeId("trader"),
    name: body.name,
    status: body.status || "online",
    percent: Number(body.percent || 4.5),
    available_usdt: Number(body.available_usdt || body.balance_usdt || 0),
    reserved_usdt: 0,
    earned_usdt: 0,
    missed_confirmations: 0,
    priority: Number(body.priority || 0),
    max_active_orders: Number(body.max_active_orders || 3),
    active_orders: 0,
    last_order_at: null,
    created_at: nowIso()
  };

  store.traders.unshift(trader);

  addEvent("trader_created", `Admin created trader ${trader.name}`, {
    trader_id: trader.id
  });

  saveStore();

  res.json({
    success: true,
    trader
  });
});

app.patch("/api/admin/traders/:trader_id", (req, res) => {
  const trader = getTraderById(req.params.trader_id);

  if (!trader) {
    return res.status(404).json({
      success: false,
      message: "Trader not found"
    });
  }

  const body = req.body || {};

  if (body.name !== undefined) trader.name = body.name;
  if (body.percent !== undefined) trader.percent = Number(body.percent);
  if (body.available_usdt !== undefined) trader.available_usdt = Number(body.available_usdt);
  if (body.balance_usdt !== undefined) trader.available_usdt = Number(body.balance_usdt);
  if (body.priority !== undefined) trader.priority = Number(body.priority);
  if (body.max_active_orders !== undefined) trader.max_active_orders = Number(body.max_active_orders);

  if (body.status !== undefined) {
    const allowed = ["online", "pause", "offline", "frozen"];
    if (!allowed.includes(body.status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid trader status"
      });
    }

    trader.status = body.status;
  }

  updateTraderStatus(trader);
  normalizeTrader(trader);

  addEvent("trader_updated", `Admin updated trader ${trader.name}`, {
    trader_id: trader.id
  });

  saveStore();

  res.json({
    success: true,
    trader
  });
});

app.get("/api/admin/cards", (req, res) => {
  res.json({
    success: true,
    cards: store.cards
  });
});

app.patch("/api/admin/cards/:card_id", (req, res) => {
  const card = getCardById(req.params.card_id);

  if (!card) {
    return res.status(404).json({
      success: false,
      message: "Card not found"
    });
  }

  const body = req.body || {};

  if (body.bank !== undefined) card.bank = body.bank;
  if (body.card_number !== undefined) card.card_number = body.card_number;
  if (body.card_holder !== undefined) card.card_holder = body.card_holder;
  if (body.min_amount !== undefined) card.min_amount = Number(body.min_amount);
  if (body.max_amount !== undefined) card.max_amount = Number(body.max_amount);
  if (body.daily_limit !== undefined) card.daily_limit = Number(body.daily_limit);
  if (body.max_payments_per_day !== undefined) card.max_payments_per_day = Number(body.max_payments_per_day);
  if (body.active !== undefined) card.active = Boolean(body.active);

  addEvent("card_updated", `Admin updated card ${card.id}`, {
    card_id: card.id
  });

  saveStore();

  res.json({
    success: true,
    card
  });
});

app.post("/api/admin/cards/:card_id/reset-day", (req, res) => {
  const card = getCardById(req.params.card_id);

  if (!card) {
    return res.status(404).json({
      success: false,
      message: "Card not found"
    });
  }

  card.payments_today = 0;
  card.turnover_today = 0;
  card.active = true;
  card.disabled_reason = null;

  addEvent("card_day_reset", `Admin reset daily limits for card ${card.id}`, {
    card_id: card.id
  });

  saveStore();

  res.json({
    success: true,
    card
  });
});

app.get("/api/admin/orders", (req, res) => {
  expireOldOrders();

  res.json({
    success: true,
    orders: store.orders
  });
});

app.get("/api/admin/orders/:order_id", (req, res) => {
  expireOldOrders();

  const order = getOrderById(req.params.order_id);

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

app.get("/api/admin/withdrawals", (req, res) => {
  res.json({
    success: true,
    withdrawals: store.withdrawals
  });
});

app.post("/api/admin/withdrawals/:withdrawal_id/complete", (req, res) => {
  const withdrawal = store.withdrawals.find(w => w.id === req.params.withdrawal_id);

  if (!withdrawal) {
    return res.status(404).json({
      success: false,
      message: "Withdrawal not found"
    });
  }

  withdrawal.status = "completed";
  withdrawal.txid = req.body.txid || null;
  withdrawal.completed_at = nowIso();

  addEvent("withdrawal_completed", `Admin completed withdrawal ${withdrawal.id}`, {
    withdrawal_id: withdrawal.id,
    txid: withdrawal.txid
  });

  saveStore();

  res.json({
    success: true,
    withdrawal
  });
});

app.get("/api/admin/events", (req, res) => {
  res.json({
    success: true,
    events: store.events || []
  });
});

app.get("/api/admin/config", (req, res) => {
  res.json({
    success: true,
    config: CONFIG
  });
});

/* START */

app.listen(PORT, () => {
  console.log(`PayHub server started on port ${PORT}`);
});
