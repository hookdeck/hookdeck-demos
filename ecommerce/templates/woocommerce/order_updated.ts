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
  const randomPhone = () =>
    `(${Math.floor(Math.random() * 900) + 100}) ${
      Math.floor(Math.random() * 900) + 100
    }-${Math.floor(Math.random() * 9000) + 1000}`;

  // Data arrays
  const firstNames = [
    "John",
    "Jane",
    "Mike",
    "Sarah",
    "David",
    "Emma",
    "James",
    "Lisa",
    "Robert",
    "Maria",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
  ];
  const cities = [
    "New York",
    "Los Angeles",
    "Chicago",
    "Houston",
    "Phoenix",
    "Philadelphia",
    "San Antonio",
    "San Diego",
  ];
  const states = ["NY", "CA", "IL", "TX", "AZ", "PA", "FL", "OH"];
  const products = [
    { name: "Premium T-Shirt", price: generatePrice(20, 40) },
    { name: "Designer Jeans", price: generatePrice(60, 120) },
    { name: "Leather Wallet", price: generatePrice(30, 80) },
    { name: "Running Shoes", price: generatePrice(80, 150) },
    { name: "Wireless Headphones", price: generatePrice(100, 200) },
  ];
  const paymentMethods = [
    { method: "bacs", title: "Direct Bank Transfer" },
    { method: "stripe", title: "Credit Card (Stripe)" },
    { method: "paypal", title: "PayPal" },
    { method: "cod", title: "Cash on Delivery" },
  ];
  const orderStatuses = [
    "pending",
    "processing",
    "on-hold",
    "completed",
    "refunded",
  ];
  const webhookSources = [
    "https://shop.example.com",
    "https://store.example.com",
    "https://marketplace.example.com",
  ];

  // Generate customer data
  const firstName = randomFromArray(firstNames);
  const lastName = randomFromArray(lastNames);
  const city = randomFromArray(cities);
  const state = randomFromArray(states);
  const payment = randomFromArray(paymentMethods);

  // Generate order items
  const orderItems = Array(Math.floor(Math.random() * 3) + 1)
    .fill(null)
    .map(() => {
      const product = randomFromArray(products);
      const quantity = Math.floor(Math.random() * 3) + 1;
      const subtotal = (Number(product.price) * quantity).toFixed(2);
      const tax = (Number(subtotal) * 0.075).toFixed(2);

      return {
        id: randomId(),
        name: product.name,
        product_id: randomId(),
        variation_id: 0,
        quantity,
        tax_class: "",
        subtotal,
        subtotal_tax: tax,
        total: subtotal,
        total_tax: tax,
        taxes: [
          {
            id: randomId(),
            total: tax,
            subtotal: tax,
          },
        ],
        meta_data: [],
        sku: `SKU-${Math.floor(Math.random() * 10000)}`,
        price: product.price,
      };
    });

  // Calculate order totals
  const subtotal = orderItems
    .reduce((sum, item) => sum + Number(item.subtotal), 0)
    .toFixed(2);
  const tax = orderItems
    .reduce((sum, item) => sum + Number(item.total_tax), 0)
    .toFixed(2);
  const shipping = generatePrice(5, 15);
  const total = (Number(subtotal) + Number(tax) + Number(shipping)).toFixed(2);

  return {
    headers: {
      "x-wc-webhook-delivery-id": randomId().toString(),
      "x-wc-webhook-event": "updated",
      "x-wc-webhook-id": randomId().toString(),
      "x-wc-webhook-resource": "order",
      "x-wc-webhook-signature": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
      "x-wc-webhook-source": randomFromArray(webhookSources),
      "x-wc-webhook-topic": "order.updated",
    },
    body: {
      id: randomId(),
      parent_id: 0,
      number: randomId().toString(),
      order_key: `wc_order_${randomId().toString().substring(0, 13)}`,
      created_via: "rest-api",
      version: "3.0.0",
      status: randomFromArray(orderStatuses),
      currency: "USD",
      date_created: randomDate(),
      date_created_gmt: randomDate(),
      date_modified: new Date().toISOString(),
      date_modified_gmt: new Date().toISOString(),
      discount_total: "0.00",
      discount_tax: "0.00",
      shipping_total: shipping,
      shipping_tax: "0.00",
      cart_tax: tax,
      total,
      total_tax: tax,
      prices_include_tax: false,
      customer_id: randomId(),
      customer_ip_address: `192.168.${Math.floor(
        Math.random() * 256
      )}.${Math.floor(Math.random() * 256)}`,
      customer_user_agent: "Mozilla/5.0",
      customer_note: "",
      billing: {
        first_name: firstName,
        last_name: lastName,
        company: "",
        address_1: `${Math.floor(Math.random() * 9999) + 1} Main St`,
        address_2: "",
        city,
        state,
        postcode: `${Math.floor(Math.random() * 90000) + 10000}`,
        country: "US",
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        phone: randomPhone(),
      },
      shipping: {
        first_name: firstName,
        last_name: lastName,
        company: "",
        address_1: `${Math.floor(Math.random() * 9999) + 1} Main St`,
        address_2: "",
        city,
        state,
        postcode: `${Math.floor(Math.random() * 90000) + 10000}`,
        country: "US",
      },
      payment_method: payment.method,
      payment_method_title: payment.title,
      transaction_id: `txn_${crypto.randomUUID().substring(0, 13)}`,
      date_paid: randomDate(),
      date_paid_gmt: randomDate(),
      date_completed: null,
      date_completed_gmt: null,
      cart_hash: crypto.randomUUID(),
      meta_data: [],
      line_items: orderItems,
      tax_lines: [
        {
          id: randomId(),
          rate_code: "US-STATE TAX",
          rate_id: randomId(),
          label: "State Tax",
          compound: false,
          tax_total: tax,
          shipping_tax_total: "0.00",
          meta_data: [],
        },
      ],
      shipping_lines: [
        {
          id: randomId(),
          method_title: "Flat Rate",
          method_id: "flat_rate",
          total: shipping,
          total_tax: "0.00",
          taxes: [],
          meta_data: [],
        },
      ],
      fee_lines: [],
      coupon_lines: [],
      refunds: [],
    },
  };
};
