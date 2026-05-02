import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as recommendationsLocationsAction } from "./api.recommendations.locations";

export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, recommendationsLocationsAction);
}
