import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const [total, offered, accepted, activeRules, pendingCancellations, autoApprovedCancellations, openRTO, resolvedRTO, pendingReplacements, replacementOrdersCreated] =
    await Promise.all([
      prisma.returnRequest.count({ where: { shopId: shop.id } }),
      prisma.returnRequest.count({ where: { shopId: shop.id, offeredExchange: true } }),
      prisma.returnRequest.count({ where: { shopId: shop.id, exchangeAccepted: true } }),
      prisma.automationRule.count({ where: { shopId: shop.id, isActive: true } }),
      prisma.cancellationRequest.count({ where: { shopId: shop.id, status: "PENDING" } }),
      prisma.cancellationRequest.count({ where: { shopId: shop.id, status: "AUTO_APPROVED" } }),
      prisma.rTOShipment.count({ where: { shopId: shop.id, status: { not: "RESOLVED" } } }),
      prisma.rTOShipment.count({ where: { shopId: shop.id, status: "RESOLVED" } }),
      prisma.replacementOrder.count({ where: { shopId: shop.id, status: "PENDING_REVIEW" } }),
      prisma.replacementOrder.count({ where: { shopId: shop.id, status: "ORDER_CREATED" } }),
    ]);

  const conversionRate = offered > 0 ? Math.round((accepted / offered) * 100) : 0;

  return json({
    total,
    offered,
    accepted,
    conversionRate,
    activeRules,
    pendingCancellations,
    autoApprovedCancellations,
    openRTO,
    resolvedRTO,
    pendingReplacements,
    replacementOrdersCreated,
  });
};

export default function Dashboard() {
  const {
    total,
    offered,
    accepted,
    conversionRate,
    activeRules,
    pendingCancellations,
    autoApprovedCancellations,
    openRTO,
    resolvedRTO,
    pendingReplacements,
    replacementOrdersCreated,
  } = useLoaderData<typeof loader>();

  return (
    <Page title="Returns & Exchanges">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            <Metric label="Total return requests" value={total} />
            <Metric label="Exchange offered" value={offered} />
            <Metric
              label="Exchange accepted"
              value={accepted}
              badge={`${conversionRate}% conversion`}
            />
            <Metric label="Active automation rules" value={activeRules} />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            <Metric label="Cancellations pending review" value={pendingCancellations} />
            <Metric label="Cancellations auto-approved" value={autoApprovedCancellations} />
            <Metric label="Open RTO shipments" value={openRTO} />
            <Metric label="RTO resolved" value={resolvedRTO} />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={2} gap="400">
            <Metric label="Replacements pending review" value={pendingReplacements} />
            <Metric label="Replacement orders created" value={replacementOrdersCreated} />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                First automation: Auto-suggest Exchange
              </Text>
              <Text as="p" tone="subdued">
                When a return matches an active rule, customers see exchange
                options (same product, different variant, or a similar item)
                before the refund button — the same pattern used by Return
                Prime and QuickReturns to retain revenue instead of losing it
                to a refund. Configure conditions and incentives under
                Automation Rules.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Metric({
  label,
  value,
  badge,
}: {
  label: string;
  value: number;
  badge?: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="span" tone="subdued">
          {label}
        </Text>
        <Text as="span" variant="heading2xl">
          {value}
        </Text>
        {badge && <Badge tone="success">{badge}</Badge>}
      </BlockStack>
    </Card>
  );
}
