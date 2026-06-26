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
