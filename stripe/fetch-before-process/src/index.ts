import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import Stripe from "stripe";
import { verifyHookdeck } from "./utils/webhooks";

const app = express();
app.use(express.raw({ type: "application/json" }));
const port = process.env.PORT || 3456;

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
if (!STRIPE_API_KEY) {
  throw new Error("Missing STRIPE_API_KEY environment variable");
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error("Missing STRIPE_WEBHOOK_SECRET environment variable");
}

const stripe = new Stripe(STRIPE_API_KEY);

app.post(
  "/api/stripe/invoices",
  verifyHookdeck,
  async (req: Request, res: Response) => {
    try {
      // Check Stripe signature and construct the Stripe event
      const sig = req.headers["stripe-signature"] as string;
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          STRIPE_WEBHOOK_SECRET,
          // Disable timestamp checking since event was already check by Hookdeck
          // This also allows for failed events to be replayed.
          -1
        );
      } catch (err) {
        console.log(`❌ Error:`, err);
        res.status(400).json(err);
        return;
      }

      if (event.type.startsWith("invoice.") === false) {
        res.status(400).send("Unexpected event type");
        return;
      }

      // Initially the webhook contains a snapshot of the invoice
      const invoiceSnapshot = event.data.object as Stripe.Invoice;
      const invoiceId = invoiceSnapshot.id;
      if (!invoiceId) {
        res.status(400).send("Invoice ID is missing");
        return;
      }

      // Retrieve the latest version of the invoice
      // You will not hit the Stripe API rate limit here
      const invoice = await stripe.invoices.retrieve(invoiceId);
      console.log(`Processing event type: ${event.type}`);
      console.log(`Invoice:`, invoice);

      // Now you can process the invoice, knowing it's the latest version
      // ...

      res.sendStatus(200);
    } catch (err) {
      // Handle errors or network issues
      console.error("Error fetching event:", err);
      // Send Stripe error to Hookdeck for full observability
      res.status(500).json(err);
    }
  }
);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
