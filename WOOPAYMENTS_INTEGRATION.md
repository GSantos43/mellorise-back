# WooPayments checkout

The BFF supports two checkout providers:

- `CHECKOUT_PROVIDER=stripe`: existing Stripe Checkout flow.
- `CHECKOUT_PROVIDER=woopayments`: creates a pending WooCommerce order and redirects the customer to the WooCommerce order payment URL, where WooPayments handles the payment.

Keep the Stripe environment variables configured so the store can switch back to Stripe quickly if WooPayments is unavailable.

## Required WooPayments setup

1. Install and connect WooPayments in WordPress.
2. Confirm the gateway is enabled in WooCommerce > Settings > Payments.
3. Confirm the WooCommerce payment gateways API reports the gateway as enabled at `/wp-json/wc/v3/payment_gateways/woocommerce_payments`.
4. Keep the gateway ID as `woocommerce_payments`, unless the plugin reports a different ID through the WooCommerce payment gateways API.
5. Copy `docker-woo/mu-plugins/mellorise-headless-woopayments.php` to the production WordPress `wp-content/mu-plugins/` directory.
6. Set the BFF environment:

```env
CHECKOUT_PROVIDER=woopayments
WOOCOMMERCE_PUBLIC_URL=https://mello-api-rise.duckdns.org
WOOPAYMENTS_GATEWAY_ID=woocommerce_payments
WOOPAYMENTS_GATEWAY_TITLE=WooPayments
```

If the public WordPress domain changes, update `WOOCOMMERCE_PUBLIC_URL` so the BFF never returns an internal Docker hostname such as `http://wordpress`.

## Return flow

For WooPayments, the BFF stores the frontend success and cancel URLs on the WooCommerce order. The MU-plugin filters the WooCommerce return URL only for headless WooPayments orders and sends paid customers back to:

```text
/checkout/success?provider=woopayments&order_id=<order_id>&order_key=<order_key>
```

The frontend clears the cart on that confirmed WooPayments return. Stripe still clears the cart when the success URL contains `session_id`.

## Fulfillment

Stripe orders are still marked ready for Wiio by the Stripe webhook.

WooPayments orders are marked paid by WooCommerce. The MU-plugin adds these metadata fields when WooCommerce completes or moves the order to processing:

```text
_wiio_ready_for_sync=true
_wiio_sync_source=woopayments_order_paid
_wiio_dispatch_status=queued_in_woocommerce
```

That keeps the recommended Wiio WooCommerce sync flow available for paid WooPayments orders.
