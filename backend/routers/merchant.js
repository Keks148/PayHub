const express = require("express");
const orders = require("../data/orders");

const router = express.Router();

function generatePaymentId() {
  return "ph_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
}

router.get("/", (req, res) => {
  res.json({
    success: true,
    module: "merchant",
    message: "Merchant API module is working",
    endpoints: [
      "POST /api/merchant/create-order",
      "GET /api/merchant/orders",
      "GET /api/merchant/orders/:id",
      "POST /api/merchant/orders/:id/cancel"
    ]
  });
});

router.post("/create-order", (req, res) => {
  const { order_id, amount, currency = "UAH", callback_url = null, metadata = {} } = req.body;

  if (!order_id) {
    return res.status(400).json({
      success: false,
      error_code: "ORDER_ID_REQUIRED",
      message: "order_id is required"
    });
  }

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({
      success: false,
      error_code: "AMOUNT_REQUIRED",
      message: "amount must be greater than 0"
    });
  }

  const existingOrder = orders.find((order) => order.order_id === order_id);

  if (existingOrder) {
    return res.status(409).json({
      success: false,
      error_code: "ORDER_ALREADY_EXISTS",
      message: "order_id already exists",
      payment_id: existingOrder.payment_id
    });
  }

  const order = {
    payment_id: generatePaymentId(),
    order_id,
    amount: Number(amount),
    currency,
    status: "WAITING_PAYMENT",
    bank: "Monobank",
    card_number: "5375410000001234",
    card_holder: "PAYHUB TEST CARD",
    callback_url,
    metadata,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };

  orders.push(order);

  res.status(201).json({
    success: true,
    payment: order
  });
});

router.get("/orders", (req, res) => {
  res.json({
    success: true,
    count: orders.length,
    orders
  });
});

router.get("/orders/:id", (req, res) => {
  const order = orders.find((item) => item.payment_id === req.params.id || item.order_id === req.params.id);

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

router.post("/orders/:id/cancel", (req, res) => {
  const order = orders.find((item) => item.payment_id === req.params.id || item.order_id === req.params.id);

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

  order.status = "CANCELLED";
  order.cancelled_at = new Date().toISOString();

  res.json({
    success: true,
    order
  });
});

module.exports = router;
