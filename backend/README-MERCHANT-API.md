# PayHub Merchant API v1

Temporary in-memory API for testing first merchant payment flow.

## Endpoints

### Create order
POST `/api/merchant/create-order`

Body:
```json
{
  "order_id": "ORDER_1001",
  "amount": 4200
}
```

### List orders
GET `/api/merchant/orders`

### Get order
GET `/api/merchant/orders/:id`

You can use `payment_id` or `order_id`.

### Cancel order
POST `/api/merchant/orders/:id/cancel`

## Important
This version stores orders in memory only. After server restart, orders disappear.
PostgreSQL database will be added in next steps.
