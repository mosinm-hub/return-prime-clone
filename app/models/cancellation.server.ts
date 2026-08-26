import prisma from "../db.server";

/**
 * ── Automation: Auto-approve Order Cancellation ──────────────────────────
 *
 * Mirrors QuickReturns/"WF - Order Cancellation" self-serve cancellation:
 * a customer can cancel an order themselves from the order-status page
 * before it ships. We auto-approve when:
 *   - the order is not yet fulfilled, AND
 *   - the request comes within the merchant's configured cutoff window
 *     (e.g. "only auto-cancel within 6 hours of placing the order")
 * Anything outside those conditions is routed to the merchant for manual
 * review instead of silently rejecting it.
 */

interface EvaluateCancellationInput {
  shopId: string;
  wasFulfilled: boolean;
  hoursSinceOrder: number;
}

export interface CancellationDecision {
  outcome: "AUTO_APPROVED" | "ROUTE_TO_REVIEW" | "NO_RULE_MATCHED";
  reason: string;
}

export async function evaluateCancellation(
  input: EvaluateCancellationInput,
): Promise<CancellationDecision> {
  const rule = await prisma.automationRule.findFirst({
    where: {
      shopId: input.shopId,
      isActive: true,
      action: "CANCELLATION_AUTO_APPROVE",
    },
    orderBy: { priority: "asc" },
  });

  if (!rule) {
    return { outcome: "NO_RULE_MATCHED", reason: "No cancellation rule configured" };
  }

  if (rule.matchOnlyUnfulfilled && input.wasFulfilled) {
    return {
      outcome: "ROUTE_TO_REVIEW",
      reason: "Order already fulfilled — cannot auto-cancel, needs merchant review",
    };
  }

  if (rule.matchCutoffHours != null && input.hoursSinceOrder > rule.matchCutoffHours) {
    return {
      outcome: "ROUTE_TO_REVIEW",
      reason: `Requested ${input.hoursSinceOrder.toFixed(1)}h after order, past the ${rule.matchCutoffHours}h auto-approve cutoff`,
    };
  }

  return { outcome: "AUTO_APPROVED", reason: "Unfulfilled and within cutoff window" };
}

export async function submitCancellation(params: {
  shopId: string;
  shopifyOrderId: string;
  orderName: string;
  orderValue: number;
  customerEmail: string;
  customerName?: string;
  reason: string;
  wasFulfilled: boolean;
  orderPlacedAt: Date;
  refundMethod?: "ORIGINAL_PAYMENT" | "STORE_CREDIT";
}) {
  const hoursSinceOrder = (Date.now() - params.orderPlacedAt.getTime()) / (1000 * 60 * 60);

  const request = await prisma.cancellationRequest.create({
    data: {
      shopId: params.shopId,
      shopifyOrderId: params.shopifyOrderId,
      orderName: params.orderName,
      orderValue: params.orderValue,
      customerEmail: params.customerEmail,
      customerName: params.customerName,
      reason: params.reason,
      wasFulfilled: params.wasFulfilled,
      hoursSinceOrder,
      refundMethod: params.refundMethod ?? "ORIGINAL_PAYMENT",
    },
  });

  const decision = await evaluateCancellation({
    shopId: params.shopId,
    wasFulfilled: params.wasFulfilled,
    hoursSinceOrder,
  });

  const updated = await prisma.cancellationRequest.update({
    where: { id: request.id },
    data: {
      status: decision.outcome === "AUTO_APPROVED" ? "AUTO_APPROVED" : "PENDING",
      decidedAt: decision.outcome === "AUTO_APPROVED" ? new Date() : null,
    },
  });

  return { request: updated, decision };
}
