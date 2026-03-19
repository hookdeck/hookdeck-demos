import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

if (!process.env.HOOKDECK_WEBHOOK_SECRET) {
  throw new Error("HOOKDECK_WEBHOOK_SECRET not set");
}

export const verifyHookdeck = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const hmacHeader = req.get("x-hookdeck-signature");
  const hmacHeader2 = req.get("x-hookdeck-signature-2");

  const hash = crypto
    .createHmac("sha256", process.env.HOOKDECK_WEBHOOK_SECRET as string)
    .update(req.body)
    .digest("base64");

  if (hash === hmacHeader || (hmacHeader2 && hash === hmacHeader2)) {
    next();
  } else {
    console.error("Signature is invalid, rejected");
    res.sendStatus(403);
  }
};
