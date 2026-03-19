import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const HOOKDECK_SIGNATURE_HEADER = "x-hookdeck-signature";

export async function verifyHookdeckSignature(
  request: NextRequest
): Promise<{ isValid: boolean; errorResponse?: NextResponse; body?: unknown }> {
  const secret = process.env.HOOKDECK_WEBHOOK_SECRET;

  if (!secret) {
    console.error("HOOKDECK_WEBHOOK_SECRET is not set.");
    return {
      isValid: false,
      errorResponse: NextResponse.json(
        { error: "Webhook secret not configured." },
        { status: 500 }
      ),
    };
  }

  const signature = request.headers.get(HOOKDECK_SIGNATURE_HEADER);
  if (!signature) {
    console.warn(`Missing ${HOOKDECK_SIGNATURE_HEADER} header.`);
    return {
      isValid: false,
      errorResponse: NextResponse.json(
        { error: `Missing ${HOOKDECK_SIGNATURE_HEADER} header.` },
        { status: 400 }
      ),
    };
  }

  let requestBodyText: string;
  let parsedBody: unknown;

  try {
    // Clone the request to read the body, as it can only be read once
    const clonedRequest = request.clone();
    parsedBody = await clonedRequest.json();
    // For signature verification, Hookdeck uses the raw string body
    // Re-serializing the parsed JSON is generally safe if the order of keys isn't critical
    // and no transformations happened during parsing that would alter the string representation.
    // However, if Hookdeck signs the exact byte stream, getting the raw text is more robust.
    // NextRequest.text() is the way to get the raw body.
    requestBodyText = await request.text(); // Use the original request for .text()
  } catch (e) {
    console.error("Error reading or parsing request body:", e);
    return {
      isValid: false,
      errorResponse: NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      ),
    };
  }

  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(requestBodyText, "utf-8");
    const expectedSignature = hmac.digest("base64"); // Changed from 'hex' to 'base64'

    // Convert base64 signature strings to buffers for comparison
    const signatureBuffer = Buffer.from(signature, "base64");
    const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64");

    // timingSafeEqual requires buffers of the same length.
    // This check is implicitly done by timingSafeEqual, but an explicit check can be clearer.
    if (signatureBuffer.length !== expectedSignatureBuffer.length) {
      console.warn(
        "Signature length mismatch after base64 decoding. Received length:",
        signatureBuffer.length,
        "Expected length:",
        expectedSignatureBuffer.length
      );
      return {
        isValid: false,
        errorResponse: NextResponse.json(
          { error: "Invalid signature format." },
          { status: 401 }
        ),
      };
    }

    const isValid = crypto.timingSafeEqual(
      signatureBuffer,
      expectedSignatureBuffer
    );

    if (!isValid) {
      console.warn("Invalid webhook signature.");
      return {
        isValid: false,
        errorResponse: NextResponse.json(
          { error: "Invalid signature." },
          { status: 401 }
        ),
      };
    }

    return { isValid: true, body: parsedBody };
  } catch (error) {
    console.error("Error during signature verification:", error);
    return {
      isValid: false,
      errorResponse: NextResponse.json(
        { error: "Error verifying signature." },
        { status: 500 }
      ),
    };
  }
}
