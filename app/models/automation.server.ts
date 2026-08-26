import prisma from "../db.server";
import type { AutomationRule, ReturnLineItem } from "@prisma/client";

/**
 * ── Automation #1: Auto-suggest Exchange instead of Refund ──────────────
 *
 * When a customer opens a return, before we let them pick "refund", we
 * check the shop's active rules. If a SUGGEST_EXCHANGE rule matches the
 * return's reason / order value / item tags / return window, we:
 *   1. Look up exchange candidates (same product, other variants first;
 *      then similar products) via the Admin API.
 *   2. Attach an optional incentive (extra % store credit) to make the
 *      exchange path more attractive than a plain refund.
 *   3. Mark the ReturnRequest as EXCHANGE_OFFERED and return the
 *      suggestions so the return portal can render them ahead of the
 *      refund button.
 *
 * Merchants configure rules in /app/settings — no code changes needed
 * to change which reasons trigger suggestions or how big the incentive is.
 */

export interface ExchangeCandidate {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  price: number;
  imageUrl: string | null;
  matchType: "same_product_other_variant" | "related_product";
}

export interface AutomationDecision {
  action: "SUGGEST_EXCHANGE" | "AUTO_APPROVE" | "AUTO_REJECT" | "ROUTE_TO_REVIEW" | "NO_RULE_MATCHED";
  rule?: AutomationRule;
  incentivePercent: number;
  candidates: ExchangeCandidate[];
}

interface EvaluateInput {
  shopId: string;
  reason: string;
  orderValue: number;
  productTags: string[];
  daysSinceDelivery: number;
}

/** Find the highest-priority active rule whose conditions match this return. */
export async function findMatchingRule(
  input: EvaluateInput,
): Promise<AutomationRule | null> {
  const rules = await prisma.automationRule.findMany({
    where: { shopId: input.shopId, isActive: true },
    orderBy: { priority: "asc" },
  });

  for (const rule of rules) {
    if (rule.matchReasons) {
      const reasons = rule.matchReasons.split(",").map((r) => r.trim());
      if (!reasons.includes(input.reason)) continue;
    }
    if (rule.matchMinOrderVal != null && input.orderValue < rule.matchMinOrderVal) continue;
    if (rule.matchMaxOrderVal != null && input.orderValue > rule.matchMaxOrderVal) continue;
    if (rule.matchWithinDays != null && input.daysSinceDelivery > rule.matchWithinDays) continue;
    if (rule.matchTags) {
      const tags = rule.matchTags.split(",").map((t) => t.trim());
      const hasOverlap = input.productTags.some((t) => tags.includes(t));
      if (!hasOverlap) continue;
    }
    return rule; // first match wins (already priority-sorted)
  }
  return null;
}

/**
 * Runs the automation engine for a return request and persists the outcome.
 * `fetchVariants` / `fetchRelated` are injected so this stays testable and
 * decoupled from the Admin API client (see admin-catalog.server.ts).
 */
export async function evaluateAndSuggestExchange(params: {
  returnRequestId: string;
  shopId: string;
  reason: string;
  orderValue: number;
  items: Pick<ReturnLineItem, "productId" | "variantId" | "title">[];
  productTags: string[];
  daysSinceDelivery: number;
  fetchVariants: (productId: string) => Promise<ExchangeCandidate[]>;
  fetchRelated: (productId: string) => Promise<ExchangeCandidate[]>;
}): Promise<AutomationDecision> {
  const rule = await findMatchingRule({
    shopId: params.shopId,
    reason: params.reason,
    orderValue: params.orderValue,
    productTags: params.productTags,
    daysSinceDelivery: params.daysSinceDelivery,
  });

  if (!rule) {
    return { action: "NO_RULE_MATCHED", incentivePercent: 0, candidates: [] };
  }

  if (rule.action !== "SUGGEST_EXCHANGE") {
    await prisma.returnRequest.update({
      where: { id: params.returnRequestId },
      data: {
        status: rule.action === "AUTO_APPROVE" ? "REFUND_APPROVED" : "REJECTED",
        decidedAt: new Date(),
      },
    });
    return { action: rule.action, rule, incentivePercent: 0, candidates: [] };
  }

  // Build exchange candidates: same-product variants first (e.g. a size
  // swap), then related products as a fallback if no other variant exists.
  const candidates: ExchangeCandidate[] = [];
  for (const item of params.items) {
    const sameProductVariants = await params.fetchVariants(item.productId);
    const otherVariants = sameProductVariants.filter((v) => v.variantId !== item.variantId);

    if (otherVariants.length > 0) {
      candidates.push(...otherVariants);
    } else {
      const related = await params.fetchRelated(item.productId);
      candidates.push(...related.slice(0, 4));
    }
  }

  await prisma.returnRequest.update({
    where: { id: params.returnRequestId },
    data: {
      status: "EXCHANGE_OFFERED",
      offeredExchange: true,
      incentiveApplied: rule.incentivePercent ?? 0,
      decidedAt: new Date(),
    },
  });

  return {
    action: "SUGGEST_EXCHANGE",
    rule,
    incentivePercent: rule.incentivePercent ?? 0,
    candidates,
  };
}

/** Called when the customer accepts a suggested exchange over a refund. */
export async function acceptExchange(returnRequestId: string, chosenVariantId: string) {
  return prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: {
      status: "EXCHANGE_ACCEPTED",
      exchangeAccepted: true,
      exchangeVariantId: chosenVariantId,
    },
  });
}

/** Called when the customer declines the suggestion and wants a refund instead. */
export async function declineExchange(returnRequestId: string) {
  return prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: {
      exchangeAccepted: false,
    },
  });
}
