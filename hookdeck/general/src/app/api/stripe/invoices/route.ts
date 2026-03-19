import { NextRequest, NextResponse } from "next/server";
import { verifyHookdeckSignature } from "../../../../lib/verify-hookdeck";

export async function POST(request: NextRequest) {
  const { isValid, errorResponse } = await verifyHookdeckSignature(request);

  if (!isValid) {
    return errorResponse;
  }

  // const body = await request.json();
  // const flarb = body.data.flarb.thing; // will fail
  // console.log("Flarb thing:", flarb);

  // Access the verified request body using `body`
  // For example: console.log("Verified Stripe payload:", body);

  return NextResponse.json({
    message:
      "Hello from the Hookdeck demo. Stripe invoices endpoint. Request verified.",
  });
}
