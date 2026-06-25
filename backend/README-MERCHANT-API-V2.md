# PayHub Merchant API v2

This version creates orders with assigned trader/card and trader profit.

## Create order

POST `/api/merchant/create-order`

Body:
```json
{
  "merchant_id": "merchant_demo",
  "order_id": "ORDER_2001",
  "amount": 4200,
  "currency": "UAH",
  "callback_url": "https://example.com/callback",
  "client_name": "Client name",
  "description": "Test payment"
}
```

## Order includes

- `assigned_trader_id`
- `assigned_card_id`
- `bank`
- `card_number`
- `trader_percent`
- `trader_profit_uah`
- `status`

## Test endpoints

GET `/api/merchant/orders`

GET `/api/merchant/orders/ORDER_2001`

GET `/api/merchant/orders/ORDER_2001/status`

POST `/api/merchant/orders/ORDER_2001/cancel`

## Important

This version still stores data in memory only.
After server restart, orders disappear.
Database will be added later.
