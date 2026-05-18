import ShopifyOrderCreated from "./shopify/order_created";
import ShopifyOrderUpdated from "./shopify/order_updated";
import ShopifyProductCreated from "./shopify/product_created";
import ShopifyProductUpdated from "./shopify/product_updated";
import BigcommerceOrderCreated from "./bigcommerce/order_created";
import BigcommerceOrderUpdated from "./bigcommerce/order_updated";
import BigcommerceProductCreated from "./bigcommerce/product_created";
import BigcommerceProductUpdated from "./bigcommerce/product_updated";
import WoocommerceOrderCreated from "./woocommerce/order_created";
import WoocommerceOrderUpdated from "./woocommerce/order_updated";
import WoocommerceProductCreated from "./woocommerce/product_created";
import WoocommerceProductUpdated from "./woocommerce/product_updated";
import AttentiveSms from "./attentive/sms_inbound_message";
import WhatsappMessage from "./whatsapp/message";

const TEMPLATES = {
  shopify: [
    {
      data: ShopifyOrderCreated,
      name: "order.created",
      base_rate_seconds: 2,
      signature_header: "x-shopify-hmac-sha256",
    },
    {
      data: ShopifyOrderUpdated,
      name: "order.updated",
      base_rate_seconds: 1,
      signature_header: "x-shopify-hmac-sha256",
    },
    {
      data: ShopifyProductCreated,
      name: "product.created",
      base_rate_seconds: 1,
      signature_header: "x-shopify-hmac-sha256",
    },
    {
      data: ShopifyProductUpdated,
      name: "products.updated",
      base_rate_seconds: 3,
      signature_header: "x-shopify-hmac-sha256",
    },
  ],
  bigcommerce: [
    {
      data: BigcommerceOrderCreated,
      name: "order.created",
      base_rate_seconds: 2,
      signature_header: "x-bc-webhook-signature",
    },
    {
      data: BigcommerceOrderUpdated,
      name: "order.updated",
      base_rate_seconds: 1,
      signature_header: "x-bc-webhook-signature",
    },
    {
      data: BigcommerceProductCreated,
      name: "product.created",
      base_rate_seconds: 1,
      signature_header: "x-bc-webhook-signature",
    },
    {
      data: BigcommerceProductUpdated,
      name: "products.updated",
      base_rate_seconds: 1,
      signature_header: "x-bc-webhook-signature",
    },
  ],
  woocommerce: [
    {
      data: WoocommerceOrderCreated,
      name: "order.created",
      base_rate_seconds: 1,
      signature_header: "x-wc-webhook-signature",
    },
    {
      data: WoocommerceOrderUpdated,
      name: "order.updated",
      base_rate_seconds: 1,
      signature_header: "x-wc-webhook-signature",
    },
    {
      data: WoocommerceProductCreated,
      name: "product.created",
      base_rate_seconds: 1,
      signature_header: "x-wc-webhook-signature",
    },
    {
      data: WoocommerceProductUpdated,
      name: "products.updated",
      base_rate_seconds: 3,
      signature_header: "x-wc-webhook-signature",
    },
  ],
  attentive: [
    {
      data: AttentiveSms,
      name: "sms",
      base_rate_seconds: 2,
      signature_header: "x-attentive-hmac-sha256",
    },
  ],
  whatsapp: [
    {
      data: WhatsappMessage,
      name: "message",
      base_rate_seconds: 2,
      signature_header: "x-hub-signature-256",
    },
  ],
};

export default TEMPLATES;
