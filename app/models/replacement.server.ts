import prisma from "../db.server";

/**
 * ── Manual Replacement / Warranty Order Booking ──────────────────────────
 *
 * For claims that never touch the normal return flow because there's no
 * Shopify order behind them:
 *   - a product bought on a marketplace (Amazon, Flipkart, ...) arrived damaged
 *   - an in-store / offline purchase was defective
 *   - a standing warranty claim comes in with no order reference at all
 *
 * Staff books the claim right here in the app (source, damage type, proof
 * photos, customer + shipping details, items to send). We record it, then
 * either auto-approve (low-value replacements under the shop's threshold)
 * or leave it PENDING_REVIEW for a manager to approve, and finally create
 * a $0 draft order in Shopify to actually fulfill it.
 */

export interface ReplacementItemInput {
  productId: string;
  variantId: string;
  title: string;
  variantTitle?: string;
  quantity?: number;
  imageUrl?: string;
  unitValue?: number; // used only to compute estimatedValue for rule thresholds
}

export interface BookReplacementInput {
  shopId: string;
  source: "MARKETPLACE" | "OFFLINE_STORE" | "WARRANTY_CLAIM" | "SHOPIFY_ORDER";
  damageType:
    | "DAMAGED_IN_TRANSIT"
    | "DEFECTIVE"
    | "MARKETPLACE_DAMAGE"
    | "OFFLINE_PURCHASE_DAMAGE"
    | "WARRANTY_DEFECT"
    | "OTHER";
  marketplaceName?: string;
  externalOrderRef?: string;
  originalPurchaseDate?: Date;
  proofImageUrls?: string[];
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  shippingAddress?: Record<string, unknown>;
  notes?: string;
  bookedByStaff?: string;
  items: ReplacementItemInput[];
}

export async function bookReplacementOrder(input: BookReplacementInput) {
  const estimatedValue = input.items.reduce(
    (sum, i) => sum + (i.unitValue ?? 0) * (i.quantity ?? 1),
    0,
  );

  const record = await prisma.replacementOrder.create({
    data: {
      shopId: input.shopId,
      source: input.source,
      damageType: input.damageType,
      marketplaceName: input.marketplaceName,
      externalOrderRef: input.externalOrderRef,
      originalPurchaseDate: input.originalPurchaseDate,
      proofImageUrls: input.proofImageUrls?.join(",") ?? null,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      shippingAddress: input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
      notes: input.notes,
      estimatedValue,
      bookedByStaff: input.bookedByStaff,
      items: {
        create: input.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          title: i.title,
          variantTitle: i.variantTitle,
          quantity: i.quantity ?? 1,
          imageUrl: i.imageUrl,
        })),
      },
    },
    include: { items: true },
  });

  // Value-based auto-approval: low-value replacements (e.g. under $50) can
  // skip manual review; anything above the shop's threshold waits for a
  // manager to approve in the admin.
  const rule = await prisma.automationRule.findFirst({
    where: { shopId: input.shopId, isActive: true, action: "REPLACEMENT_AUTO_APPROVE" },
    orderBy: { priority: "asc" },
  });

  const autoApprove =
    !!rule && (rule.matchMaxReplacementValue == null || estimatedValue <= rule.matchMaxReplacementValue);

  if (autoApprove) {
    return prisma.replacementOrder.update({
      where: { id: record.id },
      data: { status: "APPROVED", reviewedAt: new Date() },
      include: { items: true },
    });
  }

  return record;
}

export async function approveReplacement(id: string) {
  return prisma.replacementOrder.update({
    where: { id },
    data: { status: "APPROVED", reviewedAt: new Date() },
  });
}

export async function rejectReplacement(id: string) {
  return prisma.replacementOrder.update({
    where: { id },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
}

export async function markOrderCreated(id: string, shopifyDraftOrderId: string, shopifyOrderId?: string) {
  return prisma.replacementOrder.update({
    where: { id },
    data: {
      status: shopifyOrderId ? "ORDER_CREATED" : "APPROVED",
      shopifyDraftOrderId,
      shopifyOrderId,
    },
  });
}
