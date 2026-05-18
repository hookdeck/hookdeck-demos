export default () => {
  // Helper function to generate random prices
  const generatePrice = (min: number, max: number) =>
    (Math.random() * (max - min) + min).toFixed(2);

  // Generate base prices
  const itemPrice = generatePrice(50, 300);
  const shippingPrice = generatePrice(5, 15);
  const discountAmount = generatePrice(0, 30);

  // Generate random date within last 30 days
  const randomDate = new Date(
    Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
  );

  return {
    headers: {
      "user-agent": "Shopify/1.0.0",
      "x-shopify-api-version": "2024-10",
      "x-shopify-hmac-sha256": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
      "x-shopify-shop-domain": "shop.myshopify.com",
      "x-shopify-test": "true",
      "x-shopify-topic": "orders/updated",
      "x-shopify-triggered-at": new Date().toISOString(),
      "x-shopify-webhook-id": crypto.randomUUID(),
    },
    body: {
      id: Math.floor(Math.random() * 1000000000000000),
      admin_graphql_api_id: `gid://shopify/Order/${Math.floor(
        Math.random() * 1000000000000000
      )}`,
      app_id: null,
      browser_ip: null,
      buyer_accepts_marketing: true,
      cancel_reason: "customer",
      cancelled_at: "2021-12-31T19:00:00-05:00",
      cart_token: null,
      checkout_id: null,
      checkout_token: null,
      client_details: null,
      closed_at: null,
      confirmation_number: null,
      confirmed: false,
      contact_email: "jon@example.com",
      created_at: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      currency: "USD",
      current_subtotal_price: generatePrice(50, 300),
      current_subtotal_price_set: {
        shop_money: { amount: generatePrice(50, 300), currency_code: "USD" },
        presentment_money: {
          amount: generatePrice(50, 300),
          currency_code: "USD",
        },
      },
      current_total_additional_fees_set: null,
      current_total_discounts: "0.00",
      current_total_discounts_set: {
        shop_money: {
          amount: "0.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "0.00",
          currency_code: "USD",
        },
      },
      current_total_duties_set: null,
      current_total_price: "398.00",
      current_total_price_set: {
        shop_money: {
          amount: "398.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "398.00",
          currency_code: "USD",
        },
      },
      current_total_tax: "0.00",
      current_total_tax_set: {
        shop_money: {
          amount: "0.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "0.00",
          currency_code: "USD",
        },
      },
      customer_locale: "en",
      device_id: null,
      discount_codes: [],
      email: "jon@example.com",
      estimated_taxes: false,
      financial_status: "voided",
      fulfillment_status: "pending",
      landing_site: null,
      landing_site_ref: null,
      location_id: null,
      merchant_of_record_app_id: null,
      name: `#${Math.floor(Math.random() * 10000)}`,
      note: null,
      note_attributes: [],
      number: 234,
      order_number: Math.floor(Math.random() * 10000),
      order_status_url:
        "https://jsmith.myshopify.com/548380009/orders/123456abcd/authenticate?key=abcdefg",
      original_total_additional_fees_set: null,
      original_total_duties_set: null,
      payment_gateway_names: ["visa", "bogus"],
      phone: null,
      po_number: null,
      presentment_currency: "USD",
      processed_at: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      reference: null,
      referring_site: null,
      source_identifier: null,
      source_name: "web",
      source_url: null,
      subtotal_price: "388.00",
      subtotal_price_set: {
        shop_money: {
          amount: "388.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "388.00",
          currency_code: "USD",
        },
      },
      tags: "tag1, tag2",
      tax_exempt: false,
      tax_lines: [],
      taxes_included: false,
      test: true,
      token: "123456abcd",
      total_discounts: generatePrice(0, 30),
      total_discounts_set: {
        shop_money: { amount: generatePrice(0, 30), currency_code: "USD" },
        presentment_money: {
          amount: generatePrice(0, 30),
          currency_code: "USD",
        },
      },
      total_line_items_price: "398.00",
      total_line_items_price_set: {
        shop_money: {
          amount: "398.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "398.00",
          currency_code: "USD",
        },
      },
      total_outstanding: "398.00",
      total_price: "388.00",
      total_price_set: {
        shop_money: {
          amount: "388.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "388.00",
          currency_code: "USD",
        },
      },
      total_shipping_price_set: {
        shop_money: {
          amount: "10.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "10.00",
          currency_code: "USD",
        },
      },
      total_tax: "0.00",
      total_tax_set: {
        shop_money: {
          amount: "0.00",
          currency_code: "USD",
        },
        presentment_money: {
          amount: "0.00",
          currency_code: "USD",
        },
      },
      total_tip_received: "0.00",
      total_weight: 0,
      updated_at: new Date().toISOString(),
      user_id: null,
      billing_address: {
        first_name: "Steve",
        address1: "123 Shipping Street",
        phone: "555-555-SHIP",
        city: "Shippington",
        zip: "40003",
        province: "Kentucky",
        country: "United States",
        last_name: "Shipper",
        address2: null,
        company: "Shipping Company",
        latitude: null,
        longitude: null,
        name: "Steve Shipper",
        country_code: "US",
        province_code: "KY",
      },
      customer: {
        id: Math.floor(Math.random() * 1000000000000000),
        email: `customer${Math.floor(Math.random() * 1000)}@example.com`,
        created_at: null,
        updated_at: null,
        first_name: ["John", "Jane", "Mike", "Sarah", "Chris"][
          Math.floor(Math.random() * 5)
        ],
        last_name: ["Smith", "Johnson", "Williams", "Brown", "Jones"][
          Math.floor(Math.random() * 5)
        ],
        state: "disabled",
        note: null,
        verified_email: true,
        multipass_identifier: null,
        tax_exempt: false,
        phone: null,
        email_marketing_consent: {
          state: "not_subscribed",
          opt_in_level: null,
          consent_updated_at: null,
        },
        sms_marketing_consent: null,
        tags: "",
        currency: "USD",
        tax_exemptions: [],
        admin_graphql_api_id: "gid://shopify/Customer/115310627314723954",
        default_address: {
          id: 715243470612851200,
          customer_id: 115310627314723950,
          first_name: null,
          last_name: null,
          company: null,
          address1: "123 Elm St.",
          address2: null,
          city: "Ottawa",
          province: "Ontario",
          country: "Canada",
          zip: "K2H7A8",
          phone: "123-123-1234",
          name: "",
          province_code: "ON",
          country_code: "CA",
          country_name: "Canada",
          default: true,
        },
      },
      discount_applications: [],
      fulfillments: [],
      line_items: [
        {
          id: Math.floor(Math.random() * 1000000000000000),
          admin_graphql_api_id: `gid://shopify/LineItem/${Math.floor(
            Math.random() * 1000000000000000
          )}`,
          attributed_staffs: [
            {
              id: "gid://shopify/StaffMember/902541635",
              quantity: 1,
            },
          ],
          current_quantity: 1,
          fulfillable_quantity: 1,
          fulfillment_service: "manual",
          fulfillment_status: null,
          gift_card: false,
          grams: 567,
          name: [
            "Premium T-Shirt",
            "Classic Jeans",
            "Wireless Headphones",
            "Smart Watch",
            "Running Shoes",
          ][Math.floor(Math.random() * 5)],
          price: generatePrice(50, 300),
          price_set: {
            shop_money: {
              amount: generatePrice(50, 300),
              currency_code: "USD",
            },
            presentment_money: {
              amount: generatePrice(50, 300),
              currency_code: "USD",
            },
          },
          product_exists: true,
          product_id: 632910392,
          properties: [],
          quantity: Math.floor(Math.random() * 3) + 1,
          requires_shipping: true,
          sku: `SKU${Math.floor(Math.random() * 10000)}`,
          taxable: true,
          title: "IPod Nano - 8GB",
          total_discount: "0.00",
          total_discount_set: {
            shop_money: {
              amount: "0.00",
              currency_code: "USD",
            },
            presentment_money: {
              amount: "0.00",
              currency_code: "USD",
            },
          },
          variant_id: 808950810,
          variant_inventory_management: "shopify",
          variant_title: null,
          vendor: null,
          tax_lines: [],
          duties: [],
          discount_allocations: [],
        },
        {
          id: 141249953214522980,
          admin_graphql_api_id: "gid://shopify/LineItem/141249953214522974",
          attributed_staffs: [],
          current_quantity: 1,
          fulfillable_quantity: 1,
          fulfillment_service: "manual",
          fulfillment_status: null,
          gift_card: false,
          grams: 567,
          name: "IPod Nano - 8GB",
          price: "199.00",
          price_set: {
            shop_money: {
              amount: "199.00",
              currency_code: "USD",
            },
            presentment_money: {
              amount: "199.00",
              currency_code: "USD",
            },
          },
          product_exists: true,
          product_id: 632910392,
          properties: [],
          quantity: 1,
          requires_shipping: true,
          sku: "IPOD2008PINK",
          taxable: true,
          title: "IPod Nano - 8GB",
          total_discount: "0.00",
          total_discount_set: {
            shop_money: {
              amount: "0.00",
              currency_code: "USD",
            },
            presentment_money: {
              amount: "0.00",
              currency_code: "USD",
            },
          },
          variant_id: 808950810,
          variant_inventory_management: "shopify",
          variant_title: null,
          vendor: null,
          tax_lines: [],
          duties: [],
          discount_allocations: [],
        },
      ],
      payment_terms: null,
      refunds: [],
      shipping_address: {
        first_name: "Steve",
        address1: "123 Shipping Street",
        phone: "555-555-SHIP",
        city: "Shippington",
        zip: "40003",
        province: "Kentucky",
        country: "United States",
        last_name: "Shipper",
        address2: null,
        company: "Shipping Company",
        latitude: null,
        longitude: null,
        name: "Steve Shipper",
        country_code: "US",
        province_code: "KY",
      },
      shipping_lines: [
        {
          id: Math.floor(Math.random() * 1000000000000000),
          carrier_identifier: null,
          code: null,
          discounted_price: "10.00",
          discounted_price_set: {
            shop_money: {
              amount: "10.00",
              currency_code: "USD",
            },
            presentment_money: {
              amount: "10.00",
              currency_code: "USD",
            },
          },
          is_removed: false,
          phone: null,
          price: generatePrice(5, 15),
          price_set: {
            shop_money: { amount: generatePrice(5, 15), currency_code: "USD" },
            presentment_money: {
              amount: generatePrice(5, 15),
              currency_code: "USD",
            },
          },
          requested_fulfillment_service_id: null,
          source: "shopify",
          title: [
            "Standard Shipping",
            "Express Delivery",
            "Next Day Air",
            "Ground Shipping",
          ][Math.floor(Math.random() * 4)],
          tax_lines: [],
          discount_allocations: [],
        },
      ],
    },
  };
};
