import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { submitCancellation } from "../models/cancellation.server";

/**
 * POST /apps/returns/cancel-order
 * body: { shopifyOrderId, orderName, orderValue, customerEmail, customerName,
 *         reason, wasFulfilled, orderPlacedAt, refundMethod }
 * Called from the order-status/thank-you page "Cancel my order" button.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "Invalid app proxy request" }, { status: 401 });

  const body = await request.json();
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const { request: cancellation, decision } = await submitCancellation({
    shopId: shop.id,
    shopifyOrderId: body.shopifyOrderId,
    orderName: body.orderName,
    orderValue: body.orderValue ?? 0,
    customerEmail: body.customerEmail,
    customerName: body.customerName,
    reason: body.reason,
    wasFulfilled: !!body.wasFulfilled,
    orderPlacedAt: new Date(body.orderPlacedAt),
    refundMethod: body.refundMethod,
  });

  return json({
    cancellationId: cancellation.id,
    status: cancellation.status,
    outcome: decision.outcome,
    message: decision.reason,
  });
};
