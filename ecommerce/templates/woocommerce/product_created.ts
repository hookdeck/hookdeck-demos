export default () => {
  // Helper functions
  const randomId = () => Math.floor(Math.random() * 100000);
  const randomFromArray = (arr: any[]) =>
    arr[Math.floor(Math.random() * arr.length)];
  const generatePrice = (min: number, max: number) =>
    (Math.random() * (max - min) + min).toFixed(2);
  const randomDate = () =>
    new Date(
      Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000
    ).toISOString();

  // Product data arrays
  const productNames = [
    "T-Shirt",
    "Jeans",
    "Hoodie",
    "Sneakers",
    "Watch",
    "Backpack",
    "Jacket",
  ];
  const categories = [
    "Clothing",
    "Accessories",
    "Footwear",
    "Electronics",
    "Sports",
  ];
  const tags = ["new", "featured", "sale", "trending", "seasonal"];
  const statuses = ["publish", "draft", "private"];
  const webhookSources = [
    "https://shop.example.com",
    "https://store.example.com",
    "https://marketplace.example.com",
  ];

  // Generate base product details
  const basePrice = generatePrice(50, 300);
  const salePrice = (Number(basePrice) * 0.8).toFixed(2);
  const productName = randomFromArray(productNames);

  return {
    headers: {
      "x-wc-webhook-delivery-id": randomId().toString(),
      "x-wc-webhook-event": "created",
      "x-wc-webhook-id": randomId().toString(),
      "x-wc-webhook-resource": "product",
      "x-wc-webhook-signature": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
      "x-wc-webhook-source": randomFromArray(webhookSources),
      "x-wc-webhook-topic": "product.created",
    },
    body: {
      id: randomId(),
      name: productName,
      slug: productName.toLowerCase().replace(/\s+/g, "-"),
      permalink: `https://example.com/product/${productName
        .toLowerCase()
        .replace(/\s+/g, "-")}/`,
      date_created: randomDate(),
      date_created_gmt: randomDate(),
      date_modified: new Date().toISOString(),
      date_modified_gmt: new Date().toISOString(),
      type: randomFromArray(["simple", "variable", "grouped"]),
      status: randomFromArray(statuses),
      featured: Math.random() > 0.8,
      catalog_visibility: randomFromArray([
        "visible",
        "catalog",
        "search",
        "hidden",
      ]),
      description: `<p>Premium quality ${productName.toLowerCase()} with great features.</p>`,
      short_description: `High-quality ${productName.toLowerCase()} for everyday use.`,
      sku: `SKU-${Math.floor(Math.random() * 10000)}`,
      price: salePrice,
      regular_price: basePrice,
      sale_price: salePrice,
      date_on_sale_from: null,
      date_on_sale_from_gmt: null,
      date_on_sale_to: null,
      date_on_sale_to_gmt: null,
      on_sale: true,
      purchasable: true,
      total_sales: Math.floor(Math.random() * 1000),
      virtual: false,
      downloadable: false,
      downloads: [],
      download_limit: -1,
      download_expiry: -1,
      external_url: "",
      button_text: "",
      tax_status: randomFromArray(["taxable", "shipping", "none"]),
      tax_class: "",
      manage_stock: Math.random() > 0.5,
      stock_quantity: Math.floor(Math.random() * 100),
      backorders: randomFromArray(["no", "notify", "yes"]),
      backorders_allowed: false,
      backordered: false,
      low_stock_amount: Math.floor(Math.random() * 10),
      sold_individually: Math.random() > 0.8,
      weight: (Math.random() * 2).toFixed(2),
      dimensions: {
        length: (Math.random() * 30).toFixed(2),
        width: (Math.random() * 20).toFixed(2),
        height: (Math.random() * 10).toFixed(2),
      },
      shipping_required: true,
      shipping_taxable: true,
      shipping_class: "",
      shipping_class_id: 0,
      reviews_allowed: true,
      average_rating: (Math.random() * 5).toFixed(2),
      rating_count: Math.floor(Math.random() * 100),
      upsell_ids: [],
      cross_sell_ids: [],
      parent_id: 0,
      purchase_note: "",
      categories: [
        {
          id: randomId(),
          name: randomFromArray(categories),
          slug: randomFromArray(categories).toLowerCase(),
        },
      ],
      tags: Array(Math.floor(Math.random() * 3) + 1)
        .fill(null)
        .map(() => ({
          id: randomId(),
          name: randomFromArray(tags),
          slug: randomFromArray(tags).toLowerCase(),
        })),
      images: Array(Math.floor(Math.random() * 4) + 1)
        .fill(null)
        .map((_, index) => ({
          id: randomId(),
          date_created: randomDate(),
          date_modified: new Date().toISOString(),
          src: `https://example.com/products/${randomId()}/image-${
            index + 1
          }.jpg`,
          name: `${productName} - Image ${index + 1}`,
          alt: `${productName} product image ${index + 1}`,
          position: index,
        })),
      attributes: [],
      default_attributes: [],
      variations: [],
      grouped_products: [],
      menu_order: 0,
      price_html: `<del>${basePrice}</del> <ins>${salePrice}</ins>`,
      related_ids: [randomId(), randomId()],
      meta_data: [],
      stock_status: randomFromArray(["instock", "outofstock", "onbackorder"]),
      has_options: false,
      _links: {
        self: [
          { href: `https://example.com/wp-json/wc/v3/products/${randomId()}` },
        ],
        collection: [{ href: "https://example.com/wp-json/wc/v3/products" }],
      },
    },
  };
};
