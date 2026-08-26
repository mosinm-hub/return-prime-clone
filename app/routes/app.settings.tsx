import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  TextField,
  Select,
  Checkbox,
  Button,
  Text,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const RETURN_REASONS = [
  { label: "Wrong size", value: "wrong_size" },
  { label: "Changed mind", value: "changed_mind" },
  { label: "Item defective", value: "defective" },
  { label: "Not as described", value: "not_as_described" },
  { label: "Arrived late", value: "arrived_late" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  let rule = await prisma.automationRule.findFirst({
    where: { shopId: shop.id, action: "SUGGEST_EXCHANGE" },
  });
  if (!rule) {
    rule = await prisma.automationRule.create({
      data: {
        shopId: shop.id,
        name: "Suggest exchange instead of refund",
        action: "SUGGEST_EXCHANGE",
        matchReasons: "wrong_size,changed_mind",
        matchWithinDays: 30,
        incentivePercent: 10,
        isActive: true,
      },
    });
  }

  let cancellationRule = await prisma.automationRule.findFirst({
    where: { shopId: shop.id, action: "CANCELLATION_AUTO_APPROVE" },
  });
  if (!cancellationRule) {
    cancellationRule = await prisma.automationRule.create({
      data: {
        shopId: shop.id,
        name: "Auto-approve cancellations before fulfillment",
        action: "CANCELLATION_AUTO_APPROVE",
        matchOnlyUnfulfilled: true,
        matchCutoffHours: 6,
        isActive: true,
      },
    });
  }

  let rtoRule = await prisma.automationRule.findFirst({
    where: { shopId: shop.id, action: "RTO_AUTO_ACTION" },
  });
  if (!rtoRule) {
    rtoRule = await prisma.automationRule.create({
      data: {
        shopId: shop.id,
        name: "Auto-restock on RTO received",
        action: "RTO_AUTO_ACTION",
        matchRtoReasons: "address_issue,customer_unavailable,delivery_refused",
        rtoAction: "RESTOCK_INVENTORY",
        isActive: true,
      },
    });
  }

  let replacementRule = await prisma.automationRule.findFirst({
    where: { shopId: shop.id, action: "REPLACEMENT_AUTO_APPROVE" },
  });
  if (!replacementRule) {
    replacementRule = await prisma.automationRule.create({
      data: {
        shopId: shop.id,
        name: "Auto-approve low-value replacements",
        action: "REPLACEMENT_AUTO_APPROVE",
        matchMaxReplacementValue: 50,
        isActive: true,
      },
    });
  }

  return json({ rule, cancellationRule, rtoRule, replacementRule });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const form = await request.formData();
  const formName = form.get("_form");

  if (formName === "exchange") {
    const reasons = form.getAll("reasons") as string[];
    const rule = await prisma.automationRule.findFirst({
      where: { shopId: shop.id, action: "SUGGEST_EXCHANGE" },
    });
    const data = {
      isActive: form.get("isActive") === "true",
      matchReasons: reasons.join(","),
      matchWithinDays: Number(form.get("withinDays")) || null,
      matchMinOrderVal: form.get("minOrderVal") ? Number(form.get("minOrderVal")) : null,
      incentivePercent: Number(form.get("incentivePercent")) || 0,
    };
    if (rule) {
      await prisma.automationRule.update({ where: { id: rule.id }, data });
    } else {
      await prisma.automationRule.create({
        data: { ...data, shopId: shop.id, name: "Suggest exchange instead of refund", action: "SUGGEST_EXCHANGE" },
      });
    }
  }

  if (formName === "cancellation") {
    const rule = await prisma.automationRule.findFirst({
      where: { shopId: shop.id, action: "CANCELLATION_AUTO_APPROVE" },
    });
    const data = {
      isActive: form.get("isActive") === "true",
      matchOnlyUnfulfilled: form.get("onlyUnfulfilled") === "true",
      matchCutoffHours: Number(form.get("cutoffHours")) || null,
    };
    if (rule) {
      await prisma.automationRule.update({ where: { id: rule.id }, data });
    } else {
      await prisma.automationRule.create({
        data: { ...data, shopId: shop.id, name: "Auto-approve cancellations before fulfillment", action: "CANCELLATION_AUTO_APPROVE" },
      });
    }
  }

  if (formName === "rto") {
    const reasons = form.getAll("rtoReasons") as string[];
    const rule = await prisma.automationRule.findFirst({
      where: { shopId: shop.id, action: "RTO_AUTO_ACTION" },
    });
    const data = {
      isActive: form.get("isActive") === "true",
      matchRtoReasons: reasons.join(","),
      rtoAction: form.get("rtoAction") as any,
    };
    if (rule) {
      await prisma.automationRule.update({ where: { id: rule.id }, data });
    } else {
      await prisma.automationRule.create({
        data: { ...data, shopId: shop.id, name: "Auto-restock on RTO received", action: "RTO_AUTO_ACTION" },
      });
    }
  }

  if (formName === "replacement") {
    const rule = await prisma.automationRule.findFirst({
      where: { shopId: shop.id, action: "REPLACEMENT_AUTO_APPROVE" },
    });
    const data = {
      isActive: form.get("isActive") === "true",
      matchMaxReplacementValue: form.get("maxValue") ? Number(form.get("maxValue")) : null,
    };
    if (rule) {
      await prisma.automationRule.update({ where: { id: rule.id }, data });
    } else {
      await prisma.automationRule.create({
        data: { ...data, shopId: shop.id, name: "Auto-approve low-value replacements", action: "REPLACEMENT_AUTO_APPROVE" },
      });
    }
  }

  return json({ ok: true });
};

export default function Settings() {
  const { rule, cancellationRule, rtoRule, replacementRule } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [reasons, setReasons] = useState<string[]>(
    rule.matchReasons ? rule.matchReasons.split(",") : [],
  );
  const [withinDays, setWithinDays] = useState(String(rule.matchWithinDays ?? 30));
  const [minOrderVal, setMinOrderVal] = useState(
    rule.matchMinOrderVal != null ? String(rule.matchMinOrderVal) : "",
  );
  const [incentive, setIncentive] = useState(String(rule.incentivePercent ?? 10));
  const [isActive, setIsActive] = useState(rule.isActive);

  const [cancelActive, setCancelActive] = useState(cancellationRule.isActive);
  const [onlyUnfulfilled, setOnlyUnfulfilled] = useState(
    cancellationRule.matchOnlyUnfulfilled ?? true,
  );
  const [cutoffHours, setCutoffHours] = useState(
    String(cancellationRule.matchCutoffHours ?? 6),
  );

  const [rtoActive, setRtoActive] = useState(rtoRule.isActive);
  const [rtoReasons, setRtoReasons] = useState<string[]>(
    rtoRule.matchRtoReasons ? rtoRule.matchRtoReasons.split(",") : [],
  );
  const [rtoAction, setRtoAction] = useState(rtoRule.rtoAction ?? "RESTOCK_INVENTORY");

  const toggleRtoReason = (value: string) => {
    setRtoReasons((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value],
    );
  };

  const RTO_REASONS = [
    { label: "Address issue", value: "address_issue" },
    { label: "Out of delivery area", value: "oda" },
    { label: "Customer unavailable", value: "customer_unavailable" },
    { label: "Delivery refused", value: "delivery_refused" },
    { label: "COD payment refused", value: "cod_refused" },
  ];

  const RTO_ACTIONS = [
    { label: "Restock inventory", value: "RESTOCK_INVENTORY" },
    { label: "Refund customer", value: "REFUND_CUSTOMER" },
    { label: "Reschedule shipment", value: "RESCHEDULE_SHIPMENT" },
    { label: "Flag for manual review", value: "FLAG_FOR_REVIEW" },
  ];

  const [replacementActive, setReplacementActive] = useState(replacementRule.isActive);
  const [maxReplacementValue, setMaxReplacementValue] = useState(
    replacementRule.matchMaxReplacementValue != null ? String(replacementRule.matchMaxReplacementValue) : "50",
  );

  const toggleReason = (value: string) => {
    setReasons((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value],
    );
  };

  return (
    <Page title="Automation Rules" subtitle="Auto-suggest exchange instead of refund">
      <BlockStack gap="400">
      <Card>
        <Form method="post">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Suggest an exchange first
              </Text>
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={setIsActive}
                name="isActiveCheckbox"
              />
            </InlineStack>
            <input type="hidden" name="_form" value="exchange" />
            <input type="hidden" name="isActive" value={String(isActive)} />

            <Text as="p" tone="subdued">
              When a customer opens a return for one of the reasons below, they'll
              see exchange options (a different size/variant, or a similar
              product) before the refund button.
            </Text>

            <Divider />

            <Text as="h3" variant="headingSm">
              Trigger on these return reasons
            </Text>
            <BlockStack gap="100">
              {RETURN_REASONS.map((r) => (
                <Checkbox
                  key={r.value}
                  label={r.label}
                  checked={reasons.includes(r.value)}
                  onChange={() => toggleReason(r.value)}
                />
              ))}
            </BlockStack>
            {reasons.map((r) => (
              <input key={r} type="hidden" name="reasons" value={r} />
            ))}

            <InlineStack gap="400">
              <TextField
                label="Only if requested within (days of delivery)"
                type="number"
                name="withinDays"
                value={withinDays}
                onChange={setWithinDays}
                autoComplete="off"
              />
              <TextField
                label="Minimum order value ($, optional)"
                type="number"
                name="minOrderVal"
                value={minOrderVal}
                onChange={setMinOrderVal}
                autoComplete="off"
              />
              <TextField
                label="Exchange incentive (extra % store credit)"
                type="number"
                name="incentivePercent"
                value={incentive}
                onChange={setIncentive}
                autoComplete="off"
                helpText="e.g. 10 = customer gets 10% extra credit value if they choose an exchange over a refund"
              />
            </InlineStack>

            <InlineStack align="end">
              <Button submit variant="primary" loading={saving}>
                Save rule
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>

      <Card>
        <Form method="post">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Auto-approve order cancellations
              </Text>
              <Checkbox label="Active" checked={cancelActive} onChange={setCancelActive} />
            </InlineStack>
            <input type="hidden" name="_form" value="cancellation" />
            <input type="hidden" name="isActive" value={String(cancelActive)} />
            <input type="hidden" name="onlyUnfulfilled" value={String(onlyUnfulfilled)} />

            <Text as="p" tone="subdued">
              Customers can self-cancel from the order-status page before the
              order ships. Auto-approve when it's still unfulfilled and
              within your cutoff window — anything outside that gets routed
              to you for manual review instead of being rejected outright.
            </Text>

            <Checkbox
              label="Only auto-approve if order is not yet fulfilled"
              checked={onlyUnfulfilled}
              onChange={setOnlyUnfulfilled}
            />

            <TextField
              label="Auto-approve cutoff (hours after order placed)"
              type="number"
              name="cutoffHours"
              value={cutoffHours}
              onChange={setCutoffHours}
              autoComplete="off"
              helpText="Requests after this window are routed to you for manual review"
            />

            <InlineStack align="end">
              <Button submit variant="primary" loading={saving}>
                Save rule
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>

      <Card>
        <Form method="post">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                RTO (Return to Origin) auto-resolve
              </Text>
              <Checkbox label="Active" checked={rtoActive} onChange={setRtoActive} />
            </InlineStack>
            <input type="hidden" name="_form" value="rto" />
            <input type="hidden" name="isActive" value={String(rtoActive)} />

            <Text as="p" tone="subdued">
              When a courier reports a failed delivery, we flag it as RTO —
              tracked separately from customer-initiated returns. Once the
              parcel is confirmed back at your warehouse, this rule decides
              what happens automatically for the reasons you select below.
            </Text>

            <Text as="h3" variant="headingSm">
              Auto-resolve for these RTO reasons
            </Text>
            <BlockStack gap="100">
              {RTO_REASONS.map((r) => (
                <Checkbox
                  key={r.value}
                  label={r.label}
                  checked={rtoReasons.includes(r.value)}
                  onChange={() => toggleRtoReason(r.value)}
                />
              ))}
            </BlockStack>
            {rtoReasons.map((r) => (
              <input key={r} type="hidden" name="rtoReasons" value={r} />
            ))}

            <Select
              label="Action to take once received at warehouse"
              name="rtoAction"
              options={RTO_ACTIONS}
              value={rtoAction}
              onChange={setRtoAction}
            />

            <InlineStack align="end">
              <Button submit variant="primary" loading={saving}>
                Save rule
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>

      <Card>
        <Form method="post">
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Auto-approve low-value replacement/warranty orders
              </Text>
              <Checkbox label="Active" checked={replacementActive} onChange={setReplacementActive} />
            </InlineStack>
            <input type="hidden" name="_form" value="replacement" />
            <input type="hidden" name="isActive" value={String(replacementActive)} />

            <Text as="p" tone="subdued">
              Applies to replacement orders staff book under Replacements
              for marketplace damage, offline purchases, or warranty claims.
              Bookings at or under this value are approved automatically;
              anything above it waits for a manager to approve before the
              $0 order is created in Shopify.
            </Text>

            <TextField
              label="Auto-approve up to this estimated value ($)"
              type="number"
              name="maxValue"
              value={maxReplacementValue}
              onChange={setMaxReplacementValue}
              autoComplete="off"
              helpText="Leave blank to auto-approve regardless of value"
            />

            <InlineStack align="end">
              <Button submit variant="primary" loading={saving}>
                Save rule
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Card>
      </BlockStack>
    </Page>
  );
}
