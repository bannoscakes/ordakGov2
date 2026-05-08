import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Default landing for /app/zones/$id with no nested section. Redirects to
// the setup tab so the URL canonicalizes for sharing/bookmarking.
export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Zone id required", { status: 400 });

  // Preserve any incoming query params (e.g. ?from=wizard) so the wizard
  // banner still fires after the redirect.
  const url = new URL(request.url);
  return redirect(`/app/zones/${id}/setup${url.search}`);
}

export default function ZonesIdIndex() {
  return null;
}
