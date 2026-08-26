import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { Page, Card, IndexTable, Badge, Button, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const STATUS_TONE: Record<string, "info" | "success" | "attention" | "critical"> = {
  PENDING: "attention",
  AUTO_APPROVED: "success",
  APPROVED: "success",
  REJECTED: "critical",
  COMPLETED: "info",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const cancellations = await prisma.cancellationRequest.findMany({
    where: { shopId: shop.id },
    orderBy: { requestedAt: "desc" },
    take: 50,
  });

  return json({ cancellations });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const id = form.get("id") as string;
  const decision = form.get("decision") as "APPROVED" | "REJECTED";

  await prisma.cancellationRequest.update({
    where: { id },
    data: { status: decision, decidedAt: new Date() },
  });

  return json({ ok: true });
};

export default function Cancellations() {
  const { cancellations } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  return (
    <Page title="Order Cancellations" subtitle="Self-serve cancellations before fulfillment">
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "request", plural: "requests" }}
          itemCount={cancellations.length}
          headings={[
            { title: "Order" },
            { title: "Customer" },
            { title: "Reason" },
            { title: "Requested" },
            { title: "Status" },
            { title: "Action" },
          ]}
          selectable={false}
        >
          {cancellations.map((c, index) => (
            <IndexTable.Row id={c.id} key={c.id} position={index}>
              <IndexTable.Cell>{c.orderName}</IndexTable.Cell>
              <IndexTable.Cell>{c.customerName ?? c.customerEmail}</IndexTable.Cell>
              <IndexTable.Cell>{c.reason}</IndexTable.Cell>
              <IndexTable.Cell>{c.hoursSinceOrder.toFixed(1)}h after order</IndexTable.Cell>
              <IndexTable.Cell>
                <Badge tone={STATUS_TONE[c.status]}>{c.status.replace(/_/g, " ")}</Badge>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {c.status === "PENDING" ? (
                  <InlineStack gap="200">
                    <Button
                      size="slim"
                      variant="primary"
                      onClick={() => submit({ id: c.id, decision: "APPROVED" }, { method: "post" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="slim"
                      tone="critical"
                      onClick={() => submit({ id: c.id, decision: "REJECTED" }, { method: "post" })}
                    >
                      Reject
                    </Button>
                  </InlineStack>
                ) : (
                  "—"
                )}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
