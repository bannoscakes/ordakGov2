import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as recommendationViewedAction } from "./api.events.recommendation-viewed";

export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, recommendationViewedAction);
}
