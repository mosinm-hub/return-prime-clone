import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ExchangeCandidate } from "./automation.server";

/**
 * Wraps the Shopify Admin GraphQL API calls the automation engine needs.
 * Kept separate from automation.server.ts so the decision logic can be
 * unit-tested without a live Admin API connection.
 */

const PRODUCT_VARIANTS_QUERY = `#graphql
  query ProductVariants($id: ID!) {
    product(id: $id) {
      id
      title
      tags
      collections(first: 3) { nodes { id title } }
      variants(first: 25) {
        nodes {
          id
          title
          price
          availableForSale
          inventoryQuantity
          image { url }
        }
      }
    }
  }
`;

const RELATED_PRODUCTS_QUERY = `#graphql
  query RelatedByCollection($collectionId: ID!, $excludeProductId: ID!) {
    collection(id: $collectionId) {
      products(first: 10) {
        nodes {
          id
          title
          featuredImage { url }
          variants(first: 1) {
            nodes { id title price availableForSale }
          }
        }
      }
    }
  }
`;

export async function fetchVariantsForProduct(
  admin: AdminApiContext["graphql"],
  productGid: string,
): Promise<ExchangeCandidate[]> {
  const response = await admin(PRODUCT_VARIANTS_QUERY, { variables: { id: productGid } });
  const data = await response.json();
  const product = data.data?.product;
  if (!product) return [];

  return product.variants.nodes
    .filter((v: any) => v.availableForSale && v.inventoryQuantity > 0)
    .map((v: any) => ({
      productId: product.id,
      variantId: v.id,
      title: product.title,
      variantTitle: v.title,
      price: parseFloat(v.price),
      imageUrl: v.image?.url ?? null,
      matchType: "same_product_other_variant" as const,
    }));
}

export async function fetchRelatedProducts(
  admin: AdminApiContext["graphql"],
  productGid: string,
): Promise<ExchangeCandidate[]> {
  // Look up the product's first collection, then pull sibling products from it.
  const lookup = await admin(PRODUCT_VARIANTS_QUERY, { variables: { id: productGid } });
  const lookupData = await lookup.json();
  const collectionId = lookupData.data?.product?.collections?.nodes?.[0]?.id;
  if (!collectionId) return [];

  const response = await admin(RELATED_PRODUCTS_QUERY, {
    variables: { collectionId, excludeProductId: productGid },
  });
  const data = await response.json();
  const products = data.data?.collection?.products?.nodes ?? [];

  return products
    .filter((p: any) => p.id !== productGid && p.variants.nodes[0]?.availableForSale)
    .map((p: any) => ({
      productId: p.id,
      variantId: p.variants.nodes[0].id,
      title: p.title,
      variantTitle: p.variants.nodes[0].title,
      price: parseFloat(p.variants.nodes[0].price),
      imageUrl: p.featuredImage?.url ?? null,
      matchType: "related_product" as const,
    }));
}
