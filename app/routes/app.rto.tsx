import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { Page, Card, IndexTable, Badge, Button, Text, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { markReceivedAtOrigin } from "../models/rto.server";

const STATUS_TONE: Record<string, "info" | "success" | "attention" | "warning"> = {
  FLAGGED: "attention",
  IN_TRANSIT: "warning",
  RECEIVED_AT_ORIGIN: "info",
  RESOLVED: "success",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const shipments = await prisma.rTOShipment.findMany({
    where: { shopId: shop.id },
    orderBy: { flaggedAt: "desc" },
    take: 50,
  });

  return json({ shipments });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const id = form.get("id") as string;
  await markReceivedAtOrigin(id);
  return json({ ok: true });
};

export default function RTO() {
  const { shipments } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  return (
    <Page title="RTO (Return to Origin)" subtitle="Courier-initiated delivery failures — kept separate from customer returns">
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "shipment", plural: "shipments" }}
          itemCount={shipments.length}
          headings={[
            { title: "Order" },
            { title: "Reason" },
            { title: "Carrier / Tracking" },
            { title: "COD amount" },
            { title: "Status" },
            { title: "Action" },
          ]}
          selectable={false}
        >
          {shipments.map((s, index) => (
            <IndexTable.Row id={s.id} key={s.id} position={index}>
              <IndexTable.Cell>{s.orderName}</IndexTable.Cell>
              <IndexTable.Cell>{s.rtoReason.replace(/_/g, " ")}</IndexTable.Cell>
              <IndexTable.Cell>
                {s.carrier ?? "—"} {s.trackingNumber ? `· ${s.trackingNumber}` : ""}
              </IndexTable.Cell>
              <IndexTable.Cell>{s.codAmount ? `$${s.codAmount.toFixed(2)}` : "—"}</IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={STATUS_TONE[s.status]}>{s.status.replace(/_/g, " ")}</Badge>
                  {s.actionTaken && (
                    <Text as="span" tone="subdued">
                      {s.actionTaken.replace(/_/g, " ")}
                    </Text>
                  )}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {s.status === "FLAGGED" || s.status === "IN_TRANSIT" ? (
                  <Button
                    size="slim"
                    onClick={() => submit({ id: s.id }, { method: "post" })}
                  >
                    Mark received at warehouse
                  </Button>
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
