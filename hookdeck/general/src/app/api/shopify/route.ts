import { NextRequest, NextResponse } from "next/server";
import { verifyHookdeckSignature } from "../../../lib/verify-hookdeck";

export async function POST(request: NextRequest) {
  const { isValid, errorResponse } = await verifyHookdeckSignature(request);

  if (!isValid) {
    return errorResponse;
  }

  // Access the verified request body using `body`
  // For example: console.log("Verified Shopify payload:", body);

  return NextResponse.json({
    message:
      "Hello from the Hookdeck demo. Shopify endpoint. Request verified.",
  });
}
