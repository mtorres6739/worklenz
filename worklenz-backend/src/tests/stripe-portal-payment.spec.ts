import Stripe from "stripe";

import { constructStripeWebhookEvent } from "../services/stripe-portal-payment.service";

describe("Stripe portal webhook signatures", () => {
  const secret = "whsec_test_portal_signature";
  const stripe = new Stripe("sk_test_fixture", {
    maxNetworkRetries: 0,
  });
  const payload = JSON.stringify({
    id: "evt_portal_fixture",
    object: "event",
    api_version: "2026-06-30.basil",
    created: 1_700_000_000,
    data: {
      object: {
        id: "cs_fixture",
        object: "checkout.session",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  });

  it("accepts the exact signed request bytes", () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: Math.floor(Date.now() / 1000),
    });
    expect(
      constructStripeWebhookEvent(
        Buffer.from(payload),
        header,
        secret,
        stripe,
      ).id,
    ).toBe("evt_portal_fixture");
  });

  it("rejects mutated payloads and invalid signatures", () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: Math.floor(Date.now() / 1000),
    });
    expect(() =>
      constructStripeWebhookEvent(
        Buffer.from(`${payload} `),
        header,
        secret,
        stripe,
      ),
    ).toThrow();
  });
});
