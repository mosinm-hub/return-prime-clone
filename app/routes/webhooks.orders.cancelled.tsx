import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Fires when an order is cancelled in Shopify — whether that cancellation
 * was triggered by our orderCancel mutation (after an approved/auto-approved
 * CancellationRequest) or done manually by the merchant. Keeps our
 * CancellationRequest status in sync with the source of truth.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);
  if (!session) return new Response();

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return new Response();

  const order = payload as any;
  const shopifyOrderId = String(order.id ?? order.admin_graphql_api_id ?? "");

  await prisma.cancellationRequest.updateMany({
    where: {
      shopId: shopRecord.id,
      shopifyOrderId,
      status: { in: ["PENDING", "AUTO_APPROVED", "APPROVED"] },
    },
    data: { status: "COMPLETED", decidedAt: new Date() },
  });

  return new Response();
};
