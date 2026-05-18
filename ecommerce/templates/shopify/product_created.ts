export default () => {
  // Helper functions
  const randomId = () => Math.floor(Math.random() * 1000000000000000);
  const randomFromArray = (arr: any[]) =>
    arr[Math.floor(Math.random() * arr.length)];
  const generatePrice = (min: number, max: number) =>
    (Math.random() * (max - min) + min).toFixed(2);
  const randomDate = () =>
    new Date(
      Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000
    ).toISOString();

  // Product data arrays
  const adjectives = [
    "Premium",
    "Luxury",
    "Essential",
    "Classic",
    "Modern",
    "Vintage",
    "Designer",
  ];
  const categories = [
    "Apparel",
    "Footwear",
    "Accessories",
    "Electronics",
    "Home Goods",
  ];
  const products = [
    "T-Shirt",
    "Jeans",
    "Sneakers",
    "Watch",
    "Backpack",
    "Hoodie",
    "Jacket",
  ];
  const colors = ["Black", "Navy", "White", "Grey", "Red", "Blue", "Green"];
  const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
  const brands = [
    "Acme Co.",
    "Fashion House",
    "Style Inc.",
    "Trendy Brands",
    "Urban Wear",
  ];
  const materials = [
    "Cotton",
    "Leather",
    "Polyester",
    "Wool",
    "Denim",
    "Canvas",
  ];

  // Generate base product details
  const productName = `${randomFromArray(adjectives)} ${randomFromArray(
    products
  )}`;
  const basePrice = Number(generatePrice(50, 200));
  const salePrice = (basePrice * 0.8).toFixed(2);
  const productId = randomId();

  return {
    headers: {
      "x-shopify-api-version": "2024-10",
      "x-shopify-hmac-sha256": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
      "x-shopify-shop-domain": "shop.myshopify.com",
      "x-shopify-test": "true",
      "x-shopify-topic": "products/create",
      "x-shopify-triggered-at": new Date().toISOString(),
      "x-shopify-webhook-id": crypto.randomUUID(),
    },
    body: {
      id: productId,
      admin_graphql_api_id: `gid://shopify/Product/${productId}`,
      title: productName,
      body_html: `<p>${randomFromArray(adjectives)} quality ${randomFromArray(
        materials
      )} ${randomFromArray(products).toLowerCase()} 
                  perfect for any occasion.</p>
                  <ul>
                    <li>Premium ${randomFromArray(materials)}</li>
                    <li>Available in multiple colors</li>
                    <li>Designed for comfort</li>
                  </ul>`,
      vendor: randomFromArray(brands),
      product_type: randomFromArray(categories),
      created_at: randomDate(),
      handle: productName.toLowerCase().replace(/\s+/g, "-"),
      updated_at: new Date().toISOString(),
      published_at: randomDate(),
      status: randomFromArray(["active", "draft"]),
      published_scope: "web",
      tags: [
        randomFromArray(["new-arrival", "bestseller", "featured"]),
        randomFromArray(["summer", "winter", "spring", "fall"]),
        randomFromArray(["casual", "formal", "sport", "luxury"]),
      ].join(", "),
      variants: sizes.map((size, index) => {
        const variantId = randomId();
        return {
          id: variantId,
          admin_graphql_api_id: `gid://shopify/ProductVariant/${variantId}`,
          product_id: productId,
          title: size,
          price: basePrice.toString(),
          sku: `${productName
            .substring(0, 3)
            .toUpperCase()}${size}-${Math.floor(Math.random() * 1000)}`,
          position: index + 1,
          inventory_policy: randomFromArray(["deny", "continue"]),
          compare_at_price: salePrice,
          inventory_management: "shopify",
          option1: size,
          option2: randomFromArray(colors),
          option3: null,
          created_at: randomDate(),
          updated_at: new Date().toISOString(),
          taxable: true,
          barcode: Math.floor(Math.random() * 1000000000000).toString(),
          grams: Math.floor(Math.random() * 1000),
          image_id: null,
          weight: Math.random() * 2,
          weight_unit: randomFromArray(["kg", "lb"]),
          inventory_item_id: randomId(),
          inventory_quantity: Math.floor(Math.random() * 100),
          old_inventory_quantity: Math.floor(Math.random() * 100),
        };
      }),
      options: [
        {
          id: randomId(),
          product_id: productId,
          name: "Size",
          position: 1,
          values: sizes,
        },
        {
          id: randomId(),
          product_id: productId,
          name: "Color",
          position: 2,
          values: colors,
        },
      ],
      images: Array(Math.floor(Math.random() * 4) + 1)
        .fill(null)
        .map((_, index) => ({
          id: randomId(),
          product_id: productId,
          position: index + 1,
          created_at: randomDate(),
          updated_at: new Date().toISOString(),
          alt: `${productName} - View ${index + 1}`,
          width: 1200,
          height: 1200,
          src: `https://example.com/products/${productId}/image-${
            index + 1
          }.jpg`,
          variant_ids: [],
        })),
      image: {
        id: randomId(),
        product_id: productId,
        position: 1,
        created_at: randomDate(),
        updated_at: new Date().toISOString(),
        alt: `${productName} - Main`,
        width: 1200,
        height: 1200,
        src: `https://example.com/products/${productId}/main.jpg`,
        variant_ids: [],
      },
    },
  };
};
