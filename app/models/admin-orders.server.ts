import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

/**
 * Creates a free ($0) draft order for an approved ReplacementOrder, then
 * completes it into a real Shopify order so it flows through normal
 * fulfillment (packing slips, shipping labels, tracking) like any other
 * order — it's just fully discounted.
 *
 * lineItemsDiscount: 100% off every line via appliedDiscount, rather than
 * zeroing the variant price directly, so the order still shows the retail
 * value for reporting/insurance purposes while the customer owes nothing.
 */

const DRAFT_ORDER_CREATE = `#graphql
  mutation CreateReplacementDraftOrder($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id name totalPrice }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_COMPLETE = `#graphql
  mutation CompleteReplacementDraftOrder($id: ID!) {
    draftOrderComplete(id: $id) {
      draftOrder { id order { id name } }
      userErrors { field message }
    }
  }
`;

export interface FreeOrderLineItem {
  variantId: string; // gid://shopify/ProductVariant/...
  quantity: number;
  title: string;
}

export async function createFreeReplacementOrder(
  admin: AdminApiContext["graphql"],
  params: {
    email: string;
    shippingAddress?: Record<string, unknown>;
    lineItems: FreeOrderLineItem[];
    tags: string[]; // e.g. ["replacement", "warranty", "marketplace-damage"]
    note: string; // e.g. "Warranty replacement — Amazon order #123, damaged in transit"
  },
) {
  const createResponse = await admin(DRAFT_ORDER_CREATE, {
    variables: {
      input: {
        email: params.email,
        note2: params.note,
        tags: params.tags,
        shippingAddress: params.shippingAddress ?? undefined,
        lineItems: params.lineItems.map((li) => ({
          variantId: li.variantId,
          quantity: li.quantity,
          // 100% discount so the retail value is preserved on the order
          // for reporting, while the customer is charged nothing.
          appliedDiscount: {
            value: 100,
            valueType: "PERCENTAGE",
            title: "Free replacement",
          },
        })),
        shippingLine: {
          title: "Free shipping (replacement order)",
          price: "0.00",
        },
      },
    },
  });

  const createData = await createResponse.json();
  const createResult = createData.data?.draftOrderCreate;
  if (createResult?.userErrors?.length) {
    throw new Error(
      `draftOrderCreate failed: ${createResult.userErrors.map((e: any) => e.message).join("; ")}`,
    );
  }

  const draftOrderId = createResult.draftOrder.id;

  const completeResponse = await admin(DRAFT_ORDER_COMPLETE, {
    variables: { id: draftOrderId },
  });
  const completeData = await completeResponse.json();
  const completeResult = completeData.data?.draftOrderComplete;
  if (completeResult?.userErrors?.length) {
    throw new Error(
      `draftOrderComplete failed: ${completeResult.userErrors.map((e: any) => e.message).join("; ")}`,
    );
  }

  return {
    draftOrderId,
    shopifyOrderId: completeResult.draftOrder.order?.id as string | undefined,
    orderName: completeResult.draftOrder.order?.name as string | undefined,
  };
}
