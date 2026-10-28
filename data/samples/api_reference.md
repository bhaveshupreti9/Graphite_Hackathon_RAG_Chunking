# Orders API Reference

Version 2.4. All endpoints return JSON and require a bearer token in the `Authorization` header.

## Authentication

Request a token with your client ID and secret. Tokens expire after one hour; request a new one when you receive a `401` response.

```http
POST /v2/auth/token
Content-Type: application/json

{
  "client_id": "abc123",
  "client_secret": "s3cr3t"
}
```

## Endpoints

| Method | Path | Description | Rate limit |
|---|---|---|---|
| GET | /v2/orders | List orders, newest first | 60/min |
| GET | /v2/orders/{id} | Get one order | 120/min |
| POST | /v2/orders | Create an order | 30/min |
| PATCH | /v2/orders/{id} | Update status or notes | 30/min |
| DELETE | /v2/orders/{id} | Cancel an unshipped order | 10/min |
| GET | /v2/customers/{id}/orders | Orders for one customer | 60/min |

### Creating an order

Send the customer ID and at least one line item. Prices are in cents to avoid rounding errors.

```python
import requests

response = requests.post(
    "https://api.example.com/v2/orders",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "customer_id": "cus_8812",
        "items": [{"sku": "TSHIRT-M", "quantity": 2, "unit_price": 1999}],
        "notes": "Gift wrap",
    },
    timeout=10,
)
response.raise_for_status()
order = response.json()
print(order["id"], order["status"])
```

### Order statuses

1. `pending`: created, payment not captured yet.
2. `paid`: payment captured, waiting to be packed.
3. `shipped`: handed to the carrier; `tracking_number` is set.
4. `delivered`: the carrier confirmed delivery.
5. `cancelled`: cancelled before shipping; payment refunded.

## Pagination

List endpoints return at most 50 items. Pass the `next_cursor` value from one response as the `cursor` query parameter of the next request. When `next_cursor` is null there are no more results.

## Errors

| HTTP status | Code | Meaning |
|---|---|---|
| 400 | invalid_request | A field is missing or has the wrong type |
| 401 | unauthorized | The token is missing or expired |
| 403 | forbidden | The token cannot access this resource |
| 404 | not_found | The order or customer does not exist |
| 409 | conflict | The order already shipped and cannot be changed |
| 429 | rate_limited | Too many requests; retry after the time in `Retry-After` |

Every error body has the same shape:

```json
{ "error": { "code": "not_found", "message": "Order ord_123 was not found." } }
```

## Webhooks

Register a URL to receive an event whenever an order changes status. Each request carries an `X-Signature` header: an HMAC-SHA256 of the raw body using your webhook secret. Reject any request whose signature does not match.

## Changelog

- 2.4: added `notes` to orders and the customer orders endpoint.
- 2.3: cursors replace page numbers in list endpoints.
- 2.2: webhooks are signed with HMAC-SHA256.
