import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  evaluateAndSuggestExchange,
} from "../models/automation.server";
import {
  fetchVariantsForProduct,
  fetchRelatedProducts,
} from "../models/admin-catalog.server";

/**
 * Storefront-facing endpoint, reached via Shopify App Proxy at:
 *   https://{shop}/apps/returns/submit
 * This is what the branded return portal (theme app extension) calls
 * when a customer submits a return request. It is the entry point that
 * triggers the "auto-suggest exchange instead of refund" automation.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.public.appProxy verifies the Shopify HMAC signature and
  // gives us an admin API client scoped to the shop, without requiring
  // the customer to be logged into the admin.
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return json({ error: "Invalid app proxy request" }, { status: 401 });
  }

  const body = await request.json();
  const {
    shopifyOrderId,
    orderName,
    orderValue,
    customerEmail,
    customerName,
    reason,
    items, // [{ shopifyLineItemId, productId, variantId, title, variantTitle, quantity, price, imageUrl, tags, deliveredAt }]
  } = body;

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const returnRequest = await prisma.returnRequest.create({
    data: {
      shopId: shop.id,
      shopifyOrderId,
      orderName,
      customerEmail,
      customerName,
      reason,
      items: {
        create: items.map((i: any) => ({
          shopifyLineItemId: i.shopifyLineItemId,
          productId: i.productId,
          variantId: i.variantId,
          title: i.title,
          variantTitle: i.variantTitle,
          quantity: i.quantity ?? 1,
          price: i.price,
          imageUrl: i.imageUrl ?? null,
        })),
      },
    },
    include: { items: true },
  });

  const deliveredAt = items[0]?.deliveredAt ? new Date(items[0].deliveredAt) : new Date();
  const daysSinceDelivery = Math.floor(
    (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  const productTags: string[] = items.flatMap((i: any) => i.tags ?? []);

  const decision = await evaluateAndSuggestExchange({
    returnRequestId: returnRequest.id,
    shopId: shop.id,
    reason,
    orderValue: orderValue ?? 0,
    items: returnRequest.items,
    productTags,
    daysSinceDelivery,
    fetchVariants: (productId) => fetchVariantsForProduct(admin.graphql, productId),
    fetchRelated: (productId) => fetchRelatedProducts(admin.graphql, productId),
  });

  return json({
    returnRequestId: returnRequest.id,
    decision: decision.action,
    incentivePercent: decision.incentivePercent,
    exchangeCandidates: decision.candidates,
  });
};
