import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, IndexTable, Badge, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const STATUS_TONE: Record<string, "info" | "success" | "attention" | "critical" | "warning"> = {
  PENDING: "info",
  EXCHANGE_OFFERED: "attention",
  EXCHANGE_ACCEPTED: "success",
  REFUND_APPROVED: "warning",
  REJECTED: "critical",
  COMPLETED: "success",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const returns = await prisma.returnRequest.findMany({
    where: { shopId: shop.id },
    orderBy: { requestedAt: "desc" },
    take: 50,
    include: { items: true },
  });

  return json({ returns });
};

export default function Returns() {
  const { returns } = useLoaderData<typeof loader>();

  return (
    <Page title="Returns">
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "return", plural: "returns" }}
          itemCount={returns.length}
          headings={[
            { title: "Order" },
            { title: "Customer" },
            { title: "Reason" },
            { title: "Status" },
            { title: "Exchange offered?" },
            { title: "Outcome" },
          ]}
          selectable={false}
        >
          {returns.map((r, index) => (
            <IndexTable.Row id={r.id} key={r.id} position={index}>
              <IndexTable.Cell>{r.orderName}</IndexTable.Cell>
              <IndexTable.Cell>{r.customerName ?? r.customerEmail}</IndexTable.Cell>
              <IndexTable.Cell>{r.reason}</IndexTable.Cell>
              <IndexTable.Cell>
                <Badge tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
              </IndexTable.Cell>
              <IndexTable.Cell>{r.offeredExchange ? "Yes" : "No"}</IndexTable.Cell>
              <IndexTable.Cell>
                {r.exchangeAccepted === true && (
                  <Text as="span" tone="success">Exchanged</Text>
                )}
                {r.exchangeAccepted === false && (
                  <Text as="span" tone="subdued">Chose refund</Text>
                )}
                {r.exchangeAccepted == null && "—"}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
