import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Text,
  IndexTable,
  Badge,
  Divider,
  Icon,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { bookReplacementOrder, approveReplacement, rejectReplacement, markOrderCreated } from "../models/replacement.server";
import { createFreeReplacementOrder } from "../models/admin-orders.server";

const STATUS_TONE: Record<string, "info" | "success" | "attention" | "critical" | "warning"> = {
  PENDING_REVIEW: "attention",
  APPROVED: "info",
  ORDER_CREATED: "success",
  FULFILLED: "success",
  REJECTED: "critical",
};

const SOURCE_OPTIONS = [
  { label: "Marketplace (Amazon, Flipkart, etc)", value: "MARKETPLACE" },
  { label: "Offline / in-store purchase", value: "OFFLINE_STORE" },
  { label: "Warranty claim", value: "WARRANTY_CLAIM" },
  { label: "Shopify order (damaged/defective)", value: "SHOPIFY_ORDER" },
];

const DAMAGE_OPTIONS = [
  { label: "Damaged in transit", value: "DAMAGED_IN_TRANSIT" },
  { label: "Defective", value: "DEFECTIVE" },
  { label: "Marketplace damage", value: "MARKETPLACE_DAMAGE" },
  { label: "Offline purchase damage", value: "OFFLINE_PURCHASE_DAMAGE" },
  { label: "Warranty defect", value: "WARRANTY_DEFECT" },
  { label: "Other", value: "OTHER" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const replacements = await prisma.replacementOrder.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { items: true },
  });

  return json({ replacements, staffEmail: session.email ?? "staff" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const form = await request.formData();
  const intent = form.get("_intent");

  if (intent === "book") {
    const items = JSON.parse(form.get("items") as string);
    await bookReplacementOrder({
      shopId: shop.id,
      source: form.get("source") as any,
      damageType: form.get("damageType") as any,
      marketplaceName: (form.get("marketplaceName") as string) || undefined,
      externalOrderRef: (form.get("externalOrderRef") as string) || undefined,
      customerEmail: form.get("customerEmail") as string,
      customerName: (form.get("customerName") as string) || undefined,
      customerPhone: (form.get("customerPhone") as string) || undefined,
      notes: (form.get("notes") as string) || undefined,
      bookedByStaff: session.email ?? "staff",
      items,
    });
    return json({ ok: true });
  }

  if (intent === "approve") {
    await approveReplacement(form.get("id") as string);
    return json({ ok: true });
  }

  if (intent === "reject") {
    await rejectReplacement(form.get("id") as string);
    return json({ ok: true });
  }

  if (intent === "create_order") {
    const id = form.get("id") as string;
    const replacement = await prisma.replacementOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!replacement) return json({ error: "Not found" }, { status: 404 });

    const result = await createFreeReplacementOrder(admin.graphql, {
      email: replacement.customerEmail,
      lineItems: replacement.items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        title: i.title,
      })),
      tags: ["replacement", replacement.source.toLowerCase(), replacement.damageType.toLowerCase()],
      note: `${replacement.source} replacement — ${replacement.marketplaceName ?? ""} ${replacement.externalOrderRef ?? ""}`.trim(),
    });

    await markOrderCreated(id, result.draftOrderId, result.shopifyOrderId);
    return json({ ok: true, orderName: result.orderName });
  }

  return json({ ok: false });
};

interface LineItemDraft {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  quantity: number;
}

export default function Replacements() {
  const { replacements } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [source, setSource] = useState("MARKETPLACE");
  const [damageType, setDamageType] = useState("MARKETPLACE_DAMAGE");
  const [marketplaceName, setMarketplaceName] = useState("");
  const [externalOrderRef, setExternalOrderRef] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([
    { productId: "", variantId: "", title: "", variantTitle: "", quantity: 1 },
  ]);

  const updateItem = (index: number, patch: Partial<LineItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };
  const addItem = () =>
    setItems((prev) => [...prev, { productId: "", variantId: "", title: "", variantTitle: "", quantity: 1 }]);
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const handleBook = () => {
    submit(
      {
        _intent: "book",
        source,
        damageType,
        marketplaceName,
        externalOrderRef,
        customerEmail,
        customerName,
        customerPhone,
        notes,
        items: JSON.stringify(items.filter((i) => i.variantId)),
      },
      { method: "post" },
    );
  };

  return (
    <Page title="Replacement & Warranty Orders" subtitle="Book a free order for marketplace, offline, or warranty claims">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Book a new replacement
            </Text>
            <Text as="p" tone="subdued">
              For damage or defects that didn't come through a return —
              marketplace orders, in-store purchases, or a warranty claim
              with no order on file. This creates a $0 order in Shopify so it
              flows through normal fulfillment.
            </Text>

            <InlineStack gap="400">
              <Select label="Source" options={SOURCE_OPTIONS} value={source} onChange={setSource} />
              <Select label="Damage / claim type" options={DAMAGE_OPTIONS} value={damageType} onChange={setDamageType} />
            </InlineStack>

            <InlineStack gap="400">
              <TextField
                label="Marketplace / store name (optional)"
                value={marketplaceName}
                onChange={setMarketplaceName}
                autoComplete="off"
                placeholder="Amazon, Flipkart, In-store - MG Road..."
              />
              <TextField
                label="External order ref / invoice # (optional)"
                value={externalOrderRef}
                onChange={setExternalOrderRef}
                autoComplete="off"
              />
            </InlineStack>

            <Divider />
            <Text as="h3" variant="headingSm">Customer</Text>
            <InlineStack gap="400">
              <TextField label="Email" value={customerEmail} onChange={setCustomerEmail} autoComplete="off" />
              <TextField label="Name" value={customerName} onChange={setCustomerName} autoComplete="off" />
              <TextField label="Phone" value={customerPhone} onChange={setCustomerPhone} autoComplete="off" />
            </InlineStack>

            <Divider />
            <Text as="h3" variant="headingSm">Items to send (free)</Text>
            {items.map((item, index) => (
              <InlineStack key={index} gap="200" blockAlign="end">
                <TextField
                  label="Variant GID"
                  labelHidden={index > 0}
                  value={item.variantId}
                  onChange={(v) => updateItem(index, { variantId: v })}
                  autoComplete="off"
                  placeholder="gid://shopify/ProductVariant/123"
                />
                <TextField
                  label="Product title"
                  labelHidden={index > 0}
                  value={item.title}
                  onChange={(v) => updateItem(index, { title: v })}
                  autoComplete="off"
                />
                <TextField
                  label="Qty"
                  labelHidden={index > 0}
                  type="number"
                  value={String(item.quantity)}
                  onChange={(v) => updateItem(index, { quantity: Number(v) || 1 })}
                  autoComplete="off"
                />
                <Button icon={DeleteIcon} accessibilityLabel="Remove item" onClick={() => removeItem(index)} />
              </InlineStack>
            ))}
            <InlineStack>
              <Button icon={PlusIcon} onClick={addItem}>Add item</Button>
            </InlineStack>

            <TextField label="Internal notes" value={notes} onChange={setNotes} autoComplete="off" multiline={2} />

            <InlineStack align="end">
              <Button variant="primary" loading={saving} onClick={handleBook}>
                Book replacement
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "replacement", plural: "replacements" }}
            itemCount={replacements.length}
            headings={[
              { title: "Customer" },
              { title: "Source" },
              { title: "Damage type" },
              { title: "Est. value" },
              { title: "Status" },
              { title: "Order" },
              { title: "Action" },
            ]}
            selectable={false}
          >
            {replacements.map((r, index) => (
              <IndexTable.Row id={r.id} key={r.id} position={index}>
                <IndexTable.Cell>{r.customerName ?? r.customerEmail}</IndexTable.Cell>
                <IndexTable.Cell>
                  {r.source.replace(/_/g, " ")}
                  {r.marketplaceName ? ` · ${r.marketplaceName}` : ""}
                </IndexTable.Cell>
                <IndexTable.Cell>{r.damageType.replace(/_/g, " ")}</IndexTable.Cell>
                <IndexTable.Cell>${r.estimatedValue.toFixed(2)}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{r.shopifyOrderId ? "Created" : "—"}</IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200">
                    {r.status === "PENDING_REVIEW" && (
                      <>
                        <Form method="post">
                          <input type="hidden" name="_intent" value="approve" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button size="slim" submit>Approve</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="_intent" value="reject" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button size="slim" tone="critical" submit>Reject</Button>
                        </Form>
                      </>
                    )}
                    {r.status === "APPROVED" && (
                      <Form method="post">
                        <input type="hidden" name="_intent" value="create_order" />
                        <input type="hidden" name="id" value={r.id} />
                        <Button size="slim" variant="primary" submit>Create $0 order</Button>
                      </Form>
                    )}
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
