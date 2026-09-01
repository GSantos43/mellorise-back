# MelloRise Wiio Integration

The BFF supports Wiio through the WooCommerce integration first, with an optional direct API mode if Wiio provides private API credentials.

## Recommended WooCommerce Mode

Connect WooCommerce inside Wiio using:

```text
Store URL: https://mello-api-rise.duckdns.org
Permission: Read/Write
```

Then keep the BFF configured with:

```text
WIIO_FULFILLMENT_ENABLED=true
WIIO_SYNC_MODE=woocommerce
BFF_PUBLIC_URL=https://mello-api-rise.duckdns.org
WIIO_WEBHOOK_SECRET=<shared secret>
MAIL_TRACKING_ENABLED=true
```

In this mode, Stripe-paid orders are marked in WooCommerce for Wiio to sync through the connected store.

## Optional Direct API Mode

Use only if Wiio provides a direct order ingestion endpoint:

```text
WIIO_FULFILLMENT_ENABLED=true
WIIO_SYNC_MODE=direct_api
WIIO_API_URL=<wiio order endpoint>
WIIO_API_KEY=<wiio api key>
WIIO_AUTH_HEADER=
WIIO_AUTH_SCHEME=Bearer
```

If Wiio expects a custom auth header, set `WIIO_AUTH_HEADER` and put the full header value in `WIIO_API_KEY`.

## Tracking Webhook

Configure tracking updates to call:

```text
POST https://mello-api-rise.duckdns.org/tracking/wiio
Header: x-wiio-webhook-secret: <WIIO_WEBHOOK_SECRET>
Content-Type: application/json
```

Preferred payload:

```json
{
  "orderId": 123,
  "trackingCode": "WIIO123456",
  "carrier": "Wiio",
  "trackingUrl": "https://example.com/track/WIIO123456",
  "status": "shipped",
  "shippedAt": "2026-09-01T18:00:00.000Z"
}
```

The webhook also accepts common aliases such as `order_id`, `wooOrderId`, `orderNumber`, `order_number`, `tracking_code`, `trackingNumber`, `tracking_number`, `trackNumber`, `logisticName`, `tracking_url`, `trackUrl`, `orderStatus`, and `shipped_at`.

When tracking is received, the BFF saves it in WooCommerce metadata and sends the customer tracking email through Resend when email is configured.

## WooCommerce Metadata

Paid orders receive:

```text
_wiio_ready_for_sync=true
_wiio_sync_source=stripe_checkout_webhook
_wiio_dispatch_status=queued_in_woocommerce | sent | failed | missing_endpoint
_wiio_dispatch_attempted_at=<ISO date>
```

Tracking updates save:

```text
_wiio_tracking_code
_wiio_tracking_url
_wiio_carrier
_wiio_tracking_status
_wiio_shipped_at
_wiio_tracking_updated_at
```

Do not store API keys in this document.
