import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { login } from "../shopify.server";

// `login()` handles both: with a `shop` param it redirects into OAuth/install;
// without one it returns an error object describing what's missing. Real users
// hitting this path is rare (token exchange covers the embedded flow), so we
// don't render a custom form here — just hand whatever login() returns back.
export async function loader({ request }: LoaderFunctionArgs) {
  return login(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return login(request);
}
