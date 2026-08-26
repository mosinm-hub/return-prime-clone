import prisma from "../db.server";

/**
 * ── Automation: RTO (Return To Origin) handling ──────────────────────────
 *
 * Distinct from customer-initiated returns by design (a Shopify Community
 * ask: "don't mix RTO with customer returns"). RTO happens when a courier
 * cannot deliver a shipment — bad address, out of delivery area, customer
 * unavailable/refused, COD payment refused, or a last-minute cancellation —
 * and the parcel is sent back to the warehouse.
 *
 * We track it through: FLAGGED (courier reports failure) → IN_TRANSIT →
 * RECEIVED_AT_ORIGIN → RESOLVED, and let a rule decide what "resolved"
 * means automatically (restock inventory, refund the customer, or flag
 * for manual review — e.g. for COD orders you may want a human to check
 * before refunding).
 */

const RTO_REASON_MAP: Record<string, string> = {
  address_issue: "ADDRESS_ISSUE",
  oda: "OUT_OF_DELIVERY_AREA",
  out_of_delivery_area: "OUT_OF_DELIVERY_AREA",
  customer_unavailable: "CUSTOMER_UNAVAILABLE",
  refused: "DELIVERY_REFUSED",
  delivery_refused: "DELIVERY_REFUSED",
  cod_refused: "COD_PAYMENT_REFUSED",
  cod_payment_refused: "COD_PAYMENT_REFUSED",
  customer_requested_cancel: "CUSTOMER_REQUESTED_CANCEL",
};

export function normalizeRtoReason(raw: string): string {
  return RTO_REASON_MAP[raw.toLowerCase()] ?? "OTHER";
}

/** Called from the carrier/fulfillment webhook when a delivery attempt fails. */
export async function flagRTO(params: {
  shopId: string;
  shopifyOrderId: string;
  orderName: string;
  trackingNumber?: string;
  carrier?: string;
  codAmount?: number;
  rawReason: string;
}) {
  const rtoReason = normalizeRtoReason(params.rawReason) as any;

  const shipment = await prisma.rTOShipment.create({
    data: {
      shopId: params.shopId,
      shopifyOrderId: params.shopifyOrderId,
      orderName: params.orderName,
      trackingNumber: params.trackingNumber,
      carrier: params.carrier,
      codAmount: params.codAmount ?? 0,
      rtoReason,
      status: "FLAGGED",
    },
  });

  return shipment;
}

/** Called when the carrier confirms the parcel has physically arrived back at the warehouse. */
export async function markReceivedAtOrigin(rtoShipmentId: string) {
  const shipment = await prisma.rTOShipment.update({
    where: { id: rtoShipmentId },
    data: { status: "RECEIVED_AT_ORIGIN", receivedAt: new Date() },
  });

  // Auto-resolve if the shop has an active RTO_AUTO_ACTION rule matching this reason.
  const rule = await prisma.automationRule.findFirst({
    where: {
      shopId: shipment.shopId,
      isActive: true,
      action: "RTO_AUTO_ACTION",
    },
    orderBy: { priority: "asc" },
  });

  if (!rule || !rule.rtoAction) {
    return { shipment, autoResolved: false };
  }

  if (rule.matchRtoReasons) {
    const allowed = rule.matchRtoReasons.split(",").map((r) => r.trim());
    if (!allowed.includes(shipment.rtoReason)) {
      return { shipment, autoResolved: false };
    }
  }

  const resolved = await prisma.rTOShipment.update({
    where: { id: shipment.id },
    data: {
      status: "RESOLVED",
      actionTaken: rule.rtoAction,
      resolvedAt: new Date(),
    },
  });

  // NOTE: the actual side effect (inventoryAdjustQuantities mutation for
  // RESTOCK_INVENTORY, or refundCreate for REFUND_CUSTOMER) is executed by
  // the caller (webhook handler), which has the Admin API client. This
  // function only decides + records what should happen.
  return { shipment: resolved, autoResolved: true, actionTaken: rule.rtoAction };
}
