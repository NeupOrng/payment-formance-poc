# partner-mock

A stand-in for a biller, called by the payment engine's SPIs (the seed registers it as the `EDC_BILLER` SPI on `EDC_BILL_USD`). Port 4003.

| Request | Result |
| --- | --- |
| `POST /validations` (PRE_PAYMENT) with `externalReference` starting `INVALID…` | 422: the order fails with `PRE_PAYMENT_REJECTED` and the hold is released |
| `POST /confirmations` (POST_PAYMENT) with `externalReference` starting `REJECT…` | 422: the saga reverts the movements, releases the hold, order `FAILED` / `POST_PAYMENT_REJECTED` |
| `POST /confirmations` with `externalReference` starting `TIMEOUT…` | No answer: after its retries the saga compensates the same way, `POST_PAYMENT_FAILED` |
| `POST /confirmations` otherwise | Follows the global mode (default `approve` → 200 with a `partnerRef`) |
| `PUT /mode` `{"mode":"approve"\|"reject"\|"timeout"}` | Switch the global behaviour, e.g. during a demo |
| `GET /confirmations` | Everything confirmed so far |

Confirmations are idempotent by `reference` (the order ID), so retries from the saga never confirm twice.
