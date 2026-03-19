import { NextRequest, NextResponse } from "next/server";

export function GET(_request: NextRequest) {
  return NextResponse.json({ message: "Hello from the Hookdeck demo!" });
}
