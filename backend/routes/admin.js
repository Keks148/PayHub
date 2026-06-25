const express = require("express");
const router = express.Router();

/*
  Хранилище в памяти.
  ВАЖНО:
  На Render free после перезапуска данные сбросятся.
  Но для теста/демки этого достаточно.
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

/* =========================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
========================= */

function getStats() {
  const orders = store.orders || [];
  const traders = store.traders || [];
  const cards = store.cards || [];

  const total_orders = orders.length;
  const waiting_orders = orders.filter(o => o.status === "waiting").length;
  const paid_orders = orders.filter(o => o.status === "paid").length;
  const rejected_orders = orders.filter(o => o.status === "rejected").length;
  const cancelled_orders = orders.filter(o => o.status === "cancelled").length;

  const turnover_uah = orders
    .filter(o => o.status === "paid")
    .reduce((sum, o) => sum + (Number(o.amount_uah) || 0), 0);

  const trader_profit_uah = orders
    .filter(o => o.status === "paid")
    .reduce((sum, o) => sum + (Number(o.trader_profit_uah) || 0), 0);

  const traders_count = traders.length;
  const cards_count = cards.length;
  const active_cards = cards.filter(c => c.active).length;

  return {
    total_orders,
    waiting_orders,
    paid_orders,
    rejected_orders,
    cancelled_orders,
    turnover_uah,
    trader_profit_uah,
    traders_count,
    cards_count,
    active_cards
  };
}

function findFreeCardForAmount(amount) {
  const cards = store.cards || [];

  return cards.find(card => {
    if (!card.active) return false;
    if (card.reserved) return false;

    const min = Number(card.min_amount) || 0;
    const max = Number(card.max_amount) || 0;
    const daily = Number(card.daily_limit) || 0;
    const turnoverToday = Number(card.turnover_today) || 0;
    const maxPayments = Number(card.max_payments_per_day) || 0;
    const paymentsToday = Number(card.payments_today) || 0;

    if (amount < min || amount > max) return false;
    if (daily > 0 && turnoverToday + amount > daily) return false;
    if (maxPayments > 0 && paymentsToday >= maxPayments) return false;

    return true;
  });
}

function getTraderById(traderId) {
  return store.traders.find(t => t.id === traderId);
}

function getCardById(cardId) {
  return store.cards.find(c => c.id === cardId);
}

function getOrderById(orderId) {
  return store.orders.find(o => o.id === orderId);
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

/* =========================
   STATS / LISTS
========================= */

router.get("/stats", (req, res) => {
  return res.json({
    success: true,
    stats: getStats()
  });
});

router.get("/orders", (req, res) => {
  const orders = store.orders.map(order => {
    const trader = getTraderById(order.trader_id);
    return {
      ...order,
      trader_name: trader ? trader.name : order.trader_id
    };
  });

  return res.json({
    success: true,
    count: orders.length,
    orders
  });
});

router.get("/traders", (req, res) => {
  return res.json({
    success: true,
    count: store.traders.length,
    traders: store.traders
  });
});

router.get("/cards", (req, res) => {
  return res.json({
    success: true,
    count: store.cards.length,
    cards: store.cards
  });
});

/* =========================
   СОЗДАНИЕ ТРЕЙДЕРА
========================= */

router.post("/traders/create", (req, res) => {
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

    return res.json({
      success: true,
      message: "Trader created",
      trader
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* =========================
   СОЗДАНИЕ КАРТЫ
========================= */

router.post("/cards/create", (req, res) => {
  try {
    const {
      trader_id,
      bank,
      card_number,
      card_holder,
      min_amount,
      max_amount,
      daily_limit
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
      max_payments_per_day: 5,
      payments_today: 0,
      turnover_today: 0,
      active: true,
      reserved: false,
      current_order_id: null
    };

    store.cards.push(card);

    return res.json({
      success: true,
      message: "Card created",
      card
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* =========================
   ВКЛ / ВЫКЛ КАРТЫ
========================= */

router.patch("/cards/:id/toggle", (req, res) => {
  try {
    const card = getCardById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: "Card not found"
      });
    }

    card.active = !card.active;

    return res.json({
      success: true,
      message: `Card ${card.active ? "activated" : "disabled"}`,
      card
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* =========================
   ОПЛАТИТЬ ОРДЕР
========================= */

router.patch("/orders/:id/paid", (req, res) => {
  try {
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

    const card = getCardById(order.card_id);
    if (card) {
      card.reserved = false;
      card.current_order_id = null;
      card.payments_today = (Number(card.payments_today) || 0) + 1;
      card.turnover_today = (Number(card.turnover_today) || 0) + (Number(order.amount_uah) || 0);
    }

    return res.json({
      success: true,
      message: "Order marked as paid",
      order,
      stats: getStats()
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* =========================
   ОТКЛОНИТЬ ОРДЕР
========================= */

router.patch("/orders/:id/reject", (req, res) => {
  try {
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

    const card = getCardById(order.card_id);
    if (card) {
      card.reserved = false;
      card.current_order_id = null;
    }

    return res.json({
      success: true,
      message: "Order rejected",
      order,
      stats: getStats()
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* =========================
   СЛУЖЕБНОЕ: СОЗДАТЬ ОРДЕР ИЗ АДМИНКИ
   POST /api/admin/orders/create
========================= */

router.post("/orders/create", (req, res) => {
  try {
    const amount_uah = Number(req.body?.amount_uah || 0);

    if (!amount_uah || amount_uah <= 0) {
      return res.status(400).json({
        success: false,
        message: "amount_uah must be > 0"
      });
    }

    const card = findFreeCardForAmount(amount_uah);

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

    const traderPercent = Number(trader.percent) || 0;
    const traderProfit = Number(((amount_uah * traderPercent) / 100).toFixed(2));

    const order = {
      id: makeOrderId(),
      amount_uah,
      status: "waiting",
      trader_id: trader.id,
      trader_name: trader.name,
      trader_percent: traderPercent,
      trader_profit_uah: traderProfit,
      card_id: card.id,
      bank: card.bank,
      card_number: card.card_number,
      card_holder: card.card_holder,
      created_at: new Date().toISOString()
    };

    store.orders.unshift(order);

    card.reserved = true;
    card.current_order_id = order.id;

    return res.json({
      success: true,
      message: "Order created",
      order
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

module.exports = router;
