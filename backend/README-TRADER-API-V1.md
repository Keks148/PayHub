# PayHub Trader API v1

Upload `trader.js` to:

`PayHub/backend/routes/trader.js`

## Endpoints

GET `/api/trader`

GET `/api/trader/orders`

GET `/api/trader/orders/ORDER_2001`

POST `/api/trader/orders/ORDER_2001/confirm`

POST `/api/trader/orders/ORDER_2001/reject`

## Logic

- `confirm` changes status to `PAID`
- `reject` changes status to `REJECTED`
- both actions release the assigned card
