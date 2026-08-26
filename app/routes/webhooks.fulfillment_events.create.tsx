import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { flagRTO, markReceivedAtOrigin } from "../models/rto.server";

/**
 * Shopify doesn't have a dedicated "RTO" webhook — merchants using
 * India/COD-heavy carriers get delivery-failure signals via fulfillment
 * events. This handler listens to FULFILLMENT_EVENTS_CREATE and treats
 * failure-type statuses as the start of an RTO, matching how QuickReturns
 * and carrier platforms (Eshopbox, Shiprocket, etc.) surface RTOs.
 *
 * Statuses that indicate a failed delivery attempt / return-to-origin,
 * per Shopify's fulfillment event status enum.
 */
const RTO_TRIGGER_STATUSES = new Set([
  "failure",
  "attempted_delivery",
  "delivery_failed",
]);

const RECEIVED_STATUSES = new Set(["out_for_delivery" /* placeholder */]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);
  if (!session) return new Response();

  const shopRecord = await prisma.shop.upsert({
    where: { domain: shop },
    update: {},
    create: { domain: shop },
  });

  const event = payload as any;
  const status: string = (event.status ?? "").toLowerCase();
  const orderId: string = String(event.order_id ?? event.orderId ?? "");
  const orderName: string = event.order_name ?? `#${orderId}`;

  if (RTO_TRIGGER_STATUSES.has(status)) {
    // Avoid double-flagging the same order if multiple failure events fire.
    const existing = await prisma.rTOShipment.findFirst({
      where: { shopId: shopRecord.id, shopifyOrderId: orderId, status: { not: "RESOLVED" } },
    });

    if (!existing) {
      await flagRTO({
        shopId: shopRecord.id,
        shopifyOrderId: orderId,
        orderName,
        trackingNumber: event.tracking_number ?? undefined,
        carrier: event.carrier ?? event.service ?? undefined,
        rawReason: event.message ?? status,
      });
    }
  }

  // When the carrier later confirms the parcel is back at the warehouse,
  // your carrier/WMS integration should call markReceivedAtOrigin() with
  // the matching RTOShipment id (wire this to whatever confirms arrival —
  // a WMS webhook, a manual admin action, etc).

  return new Response();
};
