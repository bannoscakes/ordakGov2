import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { action as eligibilityAction } from "./api.eligibility.check";

export async function action(args: ActionFunctionArgs) {
  const { session } = await authenticate.public.appProxy(args.request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const original = await args.request.clone().json().catch(() => ({}));
  const replayed = new Request(args.request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...original, shopDomain: session.shop }),
  });
  return eligibilityAction({ ...args, request: replayed });
}
