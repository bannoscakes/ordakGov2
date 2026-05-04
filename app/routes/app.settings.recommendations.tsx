// Recommendation-engine settings page is hidden in v1 — the scoring
// surface confused merchants. Schema columns stay dormant. Direct visits
// redirect to the new Settings index introduced in D7.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return redirect("/app/settings");
}

export default function RecommendationsRedirect() {
  return null;
}
