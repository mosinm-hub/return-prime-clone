import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { acceptExchange, declineExchange } from "../models/automation.server";

/**
 * POST /apps/returns/decision
 * body: { returnRequestId, decision: "accept" | "decline", variantId? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "Invalid app proxy request" }, { status: 401 });

  const { returnRequestId, decision, variantId } = await request.json();

  if (decision === "accept") {
    if (!variantId) {
      return json({ error: "variantId required to accept an exchange" }, { status: 400 });
    }
    const updated = await acceptExchange(returnRequestId, variantId);
    return json({ status: updated.status });
  }

  if (decision === "decline") {
    const updated = await declineExchange(returnRequestId);
    return json({ status: updated.status ?? "PENDING", nextStep: "refund_flow" });
  }

  return json({ error: "decision must be 'accept' or 'decline'" }, { status: 400 });
};
