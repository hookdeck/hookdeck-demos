export default () => ({
  headers: {
    "x-shopify-api-version": "2024-10",
    "x-shopify-hmac-sha256": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
    "x-shopify-shop-domain": "shop.myshopify.com",
    "x-shopify-test": "true",
    "x-shopify-topic": "products/update",
    "x-shopify-triggered-at": new Date().toISOString(),
    "x-shopify-webhook-id": crypto.randomUUID(),
  },
  body: {
    admin_graphql_api_id: `gid://shopify/Product/${Math.floor(
      Math.random() * 1000000000000000
    )}`,
    body_html: `${
      ["Classic", "Vintage", "Modern", "Designer"][
        Math.floor(Math.random() * 4)
      ]
    } ${
      ["T-Shirt", "Polo", "Sweater", "Hoodie"][Math.floor(Math.random() * 4)]
    } - Perfect for any occasion`,
    created_at: new Date(
      Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000
    ).toISOString(),
    handle: "example-product",
    id: Math.floor(Math.random() * 1000000000000000),
    product_type: ["Shirts", "Tops", "Apparel", "Clothing"][
      Math.floor(Math.random() * 4)
    ],
    published_at: new Date(
      Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
    ).toISOString(),
    title: `${
      ["Premium", "Luxury", "Essential", "Basic"][Math.floor(Math.random() * 4)]
    } ${
      ["T-Shirt", "Polo", "Sweater", "Hoodie"][Math.floor(Math.random() * 4)]
    }`,
    updated_at: new Date().toISOString(),
    vendor: ["Acme", "Fashion Co.", "Style Inc.", "Trendy Brands"][
      Math.floor(Math.random() * 4)
    ],
    status: "active",
    published_scope: "web",
    tags: [
      ["casual", "formal", "sporty", "vintage"][Math.floor(Math.random() * 4)],
      ["mens", "unisex", "fashion"][Math.floor(Math.random() * 3)],
      ["new-arrival", "bestseller", "limited-edition"][
        Math.floor(Math.random() * 3)
      ],
    ].join(", "),
    variants: [
      {
        admin_graphql_api_id: "gid://shopify/ProductVariant/642667041472713922",
        barcode: null,
        compare_at_price: (25 + Math.random() * 45).toFixed(2),
        created_at: "2021-12-29T19:00:00-05:00",
        id: Math.floor(Math.random() * 1000000000000000),
        inventory_policy: "deny",
        position: 1,
        price: (15 + Math.random() * 35).toFixed(2),
        product_id: Math.floor(Math.random() * 1000000000000000),
        sku: "example-shirt-s",
        taxable: true,
        title: "Small",
        updated_at: "2021-12-30T19:00:00-05:00",
        option1: "Small",
        option2: null,
        option3: null,
        image_id: null,
        inventory_item_id: null,
        inventory_quantity: Math.floor(Math.random() * 100),
        old_inventory_quantity: 75,
      },
      {
        admin_graphql_api_id: "gid://shopify/ProductVariant/757650484644203962",
        barcode: null,
        compare_at_price: (25 + Math.random() * 45).toFixed(2),
        created_at: "2021-12-29T19:00:00-05:00",
        id: Math.floor(Math.random() * 1000000000000000),
        inventory_policy: "deny",
        position: 2,
        price: (15 + Math.random() * 35).toFixed(2),
        product_id: Math.floor(Math.random() * 1000000000000000),
        sku: "example-shirt-m",
        taxable: true,
        title: "Medium",
        updated_at: "2021-12-31T19:00:00-05:00",
        option1: "Medium",
        option2: null,
        option3: null,
        image_id: null,
        inventory_item_id: null,
        inventory_quantity: Math.floor(Math.random() * 100),
        old_inventory_quantity: 50,
      },
    ],
    options: [],
    images: [],
    image: null,
    media: [],
    variant_gids: [
      {
        admin_graphql_api_id: "gid://shopify/ProductVariant/757650484644203962",
        updated_at: "2022-01-01T00:00:00.000Z",
      },
      {
        admin_graphql_api_id: "gid://shopify/ProductVariant/642667041472713922",
        updated_at: "2021-12-31T00:00:00.000Z",
      },
    ],
    has_variants_that_requires_components: false,
  },
});
