# ShipsGo → Twilio WhatsApp bridge

This serverless function receives ShipsGo ocean shipment webhooks, validates the HMAC-SHA256 signature, detects relevant actual container movements, and sends a WhatsApp message through Twilio.

## Webhook URL

After deploying the repository to Vercel, the endpoint will be:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/shipsgo-webhook
```

A browser GET request to this URL should return:

```json
{"ok":true,"service":"shipsgo-twilio-bridge"}
```

## Required Vercel environment variables

Configure these in Vercel → Project → Settings → Environment Variables:

```text
SHIPSGO_WEBHOOK_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
WHATSAPP_TO=
NOTIFY_EVENT_CODES=LOAD,DEPA,ARRV,DISC,GTOT
```

For the Twilio Sandbox, `TWILIO_WHATSAPP_FROM` is normally the shared Sandbox number shown by Twilio. Use full international format, for example `+14155238886`.

`WHATSAPP_TO` must be the WhatsApp number that joined the Sandbox, also in full international format.

Do not commit real credentials to GitHub.

## ShipsGo configuration

In ShipsGo:

1. Open **Webhooks**.
2. Create a webhook named `Export MCA WhatsApp Tracking`.
3. Set the endpoint URL to the deployed Vercel URL.
4. Subscribe to `OCEAN.SHIPMENTS.SHIPMENT_UPDATED`.
5. Create a strong Secret Key.
6. Save the same value in Vercel as `SHIPSGO_WEBHOOK_SECRET`.

## Events currently notified

- `LOAD`: loaded onto vessel
- `DEPA`: departed port
- `ARRV`: arrived at port
- `DISC`: discharged from vessel
- `GTOT`: gate out from terminal

Only movements with ShipsGo status `ACT` are sent. Planned or estimated events are ignored.

## Trial limitation

Twilio Sandbox messages work only for numbers that have joined the Sandbox. For production customer notifications, register a WhatsApp sender in Twilio/Meta and use approved WhatsApp templates when required.

## Current scope

The current version sends all qualifying shipment updates to one number configured in `WHATSAPP_TO`. A later version can map each shipment or customer reference to a different recipient and add persistent duplicate protection.
